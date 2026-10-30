import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import type {StudioPaths} from './storage.js';
import {WorkerConnection} from './worker.js';
import {engineSpec} from './hardware.js';
import {localLease} from '../scripts/local-lock.mjs';
import {prepareLocalAdapters,type AdapterInventory,type AdapterProgress} from './local-adapters.js';
import type {LoraSourceManifest} from '../shared/loras.js';

export type LocalInstallation={revision:string;source:string;python:string;base_python:string;gpu:string;gpu_uuid:string;vram_bytes:number;device_count:number;torch:string;kitchen:string;aimdo:string};
export type StopOutcome={outcome:'stopped'|'stop_pending'};
type Session={process:ChildProcessWithoutNullStreams;connection:WorkerConnection;recoverOnly:boolean;comfyOrigin:string;engineToken:string;
  started:boolean;exited:boolean;paired:boolean;error?:Error;keepAwake?:boolean;stop?:Promise<StopOutcome>};

const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const execute=promisify(execFile);
const ffmpeg=createRequire(import.meta.url)('ffmpeg-static') as string|null;
const STOP_TIMEOUT=120000;
function childEnvironment(){return Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)&&!key.startsWith('T3_')));}
async function availablePort(){
  const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;
}
export function processGone(pid?:number){
  if(typeof pid!=='number'||!Number.isSafeInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
}

/** Owns one engine process; reservations and idle policy belong to LocalWorker. */
export class LocalRuntime {
  private current?:Session;
  private changing?:Promise<WorkerConnection>;
  private closing=false;
  private release?:()=>Promise<void>;
  private adapterTransfer?:{controller:AbortController;task:Promise<AdapterInventory>};
  readonly root:string;
  readonly workspace:string;
  constructor(private paths:StudioPaths,root?:string){
    this.root=path.resolve(root??process.env.SEED_LOCAL_ROOT??path.join(paths.data,'local-worker'));
    this.workspace=path.join(paths.data,'local-workspace');
  }
  async installation():Promise<LocalInstallation|null>{
    try{
      const value=JSON.parse(await readFile(path.join(this.root,'runtime-ready.json'),'utf8')) as LocalInstallation;
      const spec=engineSpec();
      if(value.revision!==spec.revision)throw Error('The local engine changed. Run setup again.');
      if(value.device_count!==1||value.torch!==spec.packages.torch||value.kitchen!==spec.packages['comfy-kitchen']||value.aimdo!==spec.packages['comfy-aimdo']||
        !/^[\da-f-]{36}$/i.test(value.gpu_uuid))throw Error('Local runtime metadata does not match the release.');
      for(const file of [value.python,value.base_python,value.source]){
        const relative=path.relative(this.root,path.resolve(file));
        if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Local runtime path leaves its managed directory.');
      }
      const {stdout}=await execute('nvidia-smi.exe',['--query-gpu=uuid','--format=csv,noheader'],{windowsHide:true,timeout:10000,env:childEnvironment()});
      const devices=stdout.trim().split(/\r?\n/).map(item=>item.trim().replace(/^GPU-/i,''));
      if(devices.length!==1||value.gpu_uuid.toLowerCase()!==devices[0]!.toLowerCase())
        throw Error('The installed local runtime belongs to different GPU hardware. Run setup again.');
      return value;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  get alive(){return Boolean(this.current&&!this.current.exited);}
  get recovering(){return this.current?.recoverOnly??false;}
  async prepareAdapters(sources:LoraSourceManifest[],onProgress:(progress:AdapterProgress)=>void){
    if(this.closing)throw Error('Local worker is closing.');
    if(this.adapterTransfer)throw Error('A local LoRA download is already running.');
    const controller=new AbortController();
    const task=(async()=>{
      const python=(await this.installation())?.base_python;
      controller.signal.throwIfAborted();
      if(this.closing)throw Error('Local worker is closing.');
      if(!python)throw Error('Set up the local runtime before downloading LoRAs.');
      return prepareLocalAdapters({python,workspace:this.workspace,packageRoot,paths:this.paths,sources,onProgress,signal:controller.signal});
    })();
    const transfer={controller,task};this.adapterTransfer=transfer;
    try{return await task;}finally{if(this.adapterTransfer===transfer)this.adapterTransfer=undefined;}
  }
  async cancelPreparation(){
    const transfer=this.adapterTransfer;if(!transfer)return;
    transfer.controller.abort();await transfer.task.catch(()=>{});
  }
  async start(recoverOnly=false):Promise<WorkerConnection>{
    if(this.closing)throw Error('Local worker is closing.');
    if(this.changing)return this.changing;
    const task=this.launch(recoverOnly).finally(()=>{if(this.changing===task)this.changing=undefined;});
    this.changing=task;return task;
  }
  private async launch(recoverOnly:boolean){
    const running=this.current;
    if(running&&!running.exited&&running.recoverOnly===recoverOnly){
      if(running.error)throw running.error;return running.connection;
    }
    const previous=await this.stop();
    if(previous.outcome!=='stopped')throw Error('The local engine is still stopping.');
    if(this.closing)throw Error('Local worker is closing.');
    if(process.platform!=='win32')throw Error('Local workers currently require Windows.');
    const installed=await this.installation();
    if(!installed)throw Error('Set up this local worker first.');
    this.release=await localLease(this.root);
    try{
      const directory=path.join(this.root,'instances',randomUUID());
      await mkdir(directory,{recursive:true});await mkdir(this.workspace,{recursive:true});
      if(!recoverOnly){
        await cp(path.join(packageRoot,'worker/comfy_seed'),path.join(installed.source,'custom_nodes/comfy_seed'),{recursive:true,filter:source=>!source.includes('__pycache__')});
        await cp(path.join(packageRoot,'worker/spool.py'),path.join(installed.source,'custom_nodes/comfy_seed/spool.py'));
      }
      const port=await availablePort();let enginePort=await availablePort();
      while(enginePort===port)enginePort=await availablePort();
      const origin='http://127.0.0.1:'+port,comfyOrigin='http://127.0.0.1:'+enginePort;
      const pairingSecret=randomBytes(32).toString('base64url'),engineToken=randomBytes(32).toString('base64url');
      const config=path.join(directory,'launch.json');
      await writeFile(config,JSON.stringify({workspace:this.workspace,runtime:directory,models:path.join(this.root,'models'),source:installed.source,
        python:installed.python,origin,comfy_origin:comfyOrigin,pairing_secret:pairingSecret,engine_token:engineToken,start_engine:!recoverOnly}),{flag:'wx',mode:0o600});
      if(this.closing)throw Error('Local worker is closing.');
      const child=spawn(installed.base_python,['-m','worker.local_supervisor','--device-id',installed.gpu_uuid,'--cwd',packageRoot,
        '--log',path.join(directory,'gateway.log'),'--venv-python',installed.python,'--',installed.base_python,'-m','worker.run','--config',config],{
        cwd:packageRoot,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...childEnvironment(),PYTHONUNBUFFERED:'1',
          PYTHONPATH:packageRoot,PATH:path.dirname(ffmpeg!)+path.delimiter+(process.env.PATH??'')},
      });
      const session:Session={process:child,connection:new WorkerConnection({...this.paths,config:directory},origin),recoverOnly,comfyOrigin,engineToken,started:false,exited:false,paired:false};
      this.current=session;
      let buffer='',stderr='';
      child.stdin.on('error',()=>{});
      child.on('error',error=>{session.error=error;session.exited=true;});
      child.on('close',()=>{session.exited=true;});
      child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-4000);});
      child.stdout.on('data',(chunk:Buffer)=>{
        buffer+=chunk.toString();let end;
        while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
          try{
            const value=JSON.parse(line);
            if(value.event==='started')session.started=true;
            else if(value.event==='gateway_exit'&&!session.stop){
              session.error=Error('The local gateway stopped unexpectedly.');
              void this.stop().catch(()=>{});
            }
          }catch{session.error=Error('Invalid local supervisor response.');}
        }
      });
      try{
        const deadline=Date.now()+30000;
        for(;;){
          if(session.exited)throw session.error??Error(stderr.includes('already belongs')?'This GPU belongs to another Seed profile.':'The local worker could not start. Inspect its local log.');
          if(Date.now()>=deadline)throw Error('The local worker did not start in time.');
          if(session.started){
            try{const response=await fetch(origin+'/worker/v1/status',{signal:AbortSignal.timeout(1000),redirect:'error'});await response.body?.cancel();if(response.status===401)break;}catch{}
          }
          await delay(100);
        }
        const headers={'Content-Type':'application/json',Origin:origin};
        const unlock=await fetch(origin+'/worker/v1/unlock',{method:'POST',headers,body:JSON.stringify({pairing_secret:pairingSecret}),signal:AbortSignal.timeout(5000),redirect:'error'});
        if(!unlock.ok){await unlock.body?.cancel();throw Error('Local worker authentication failed.');}
        const cookie=unlock.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');await unlock.body?.cancel();
        const mint=await fetch(origin+'/worker/v1/pairing-codes',{method:'POST',headers:{...headers,Cookie:cookie},body:'{}',signal:AbortSignal.timeout(5000),redirect:'error'});
        if(!mint.ok){await mint.body?.cancel();throw Error('Local worker pairing failed.');}
        const body=await mint.json() as {connection_code:string};await session.connection.pair(body.connection_code);
        session.paired=true;return session.connection;
      }catch(error){await this.stop();throw error;}
    }catch(error){if(!this.current){await this.release?.();this.release=undefined;}throw error;}
  }
  connection(){
    const current=this.current;
    if(!current||current.exited||!current.paired||current.error)throw current?.error??Error('Local worker is asleep or unavailable.');
    return current.connection;
  }
  keepAwake(wanted:boolean){
    const current=this.current;
    if(!current||current.exited||current.keepAwake===wanted)return;
    current.keepAwake=wanted;current.process.stdin.write('keep_awake '+(wanted?'on':'off')+'\n');
  }
  /** Asks the engine to end any job, free the GPU and exit, then waits for that exit. */
  async stop(timeout=STOP_TIMEOUT):Promise<StopOutcome>{
    const current=this.current;
    if(!current){await this.release?.();this.release=undefined;return {outcome:'stopped'};}
    return current.stop??=this.finish(current,timeout).finally(()=>{current.stop=undefined;});
  }
  private async finish(current:Session,timeout:number):Promise<StopOutcome>{
    // A recovery gateway loaded no GPU work; closing its pipe ends it.
    if(current.recoverOnly)current.process.stdin.end();
    const deadline=Date.now()+timeout;
    while(!current.exited&&Date.now()<deadline){
      if(!current.recoverOnly)await fetch(current.comfyOrigin+'/studio/stop',{method:'POST',headers:{'X-Studio-Engine-Token':current.engineToken},
        redirect:'error',signal:AbortSignal.timeout(1000)}).then(response=>response.body?.cancel()).catch(()=>{});
      await delay(250);
    }
    if(!current.exited)return {outcome:'stop_pending'};
    if(this.current===current)this.current=undefined;
    await this.release?.();this.release=undefined;
    return {outcome:'stopped'};
  }
  async close(){
    this.closing=true;
    void this.cancelPreparation().catch(()=>{});
    return this.stop();
  }
}
