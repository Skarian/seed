import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,cp,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import type {WorkerClass} from '../shared/pool.js';
import type {StudioPaths} from './storage.js';
import {WorkerConnection} from './worker.js';
import {drainLocalEngine,type StopIntent,type StopOutcome,type StopRecord,type StopReceipt} from './local-shutdown.js';
import {boundedLocalClose} from './service-close.js';
import {localLease} from '../scripts/local-lock.mjs';
import {prepareLocalAdapters,type AdapterInventory,type AdapterProgress} from './local-adapters.js';
import type {LoraSourceManifest} from '../shared/loras.js';

type InstalledRole = {source:string;python:string;base_python:string;gpu:string;gpu_uuid:string;vram_bytes:number;device_count:number;torch:string;kitchen:string;aimdo:string};
export type LocalInstallation = {revision:string;roles:Partial<Record<WorkerClass,InstalledRole>>};
export type LocalMember={pid:number;created:string};
export type LocalOwnership = {incarnation:string;owner_pid:number;owner_created?:string;supervisor_pid:number;supervisor_created?:string;gateway_pid?:number;engine_pid?:number;members?:LocalMember[];containment?:'windows-nested-jobs-v2';role:WorkerClass;runtime_revision:string};
type Session = {ownership?:LocalOwnership;process:ChildProcessWithoutNullStreams;connection:WorkerConnection;role:WorkerClass;recoverOnly:boolean;
  directory:string;origin:string;comfyOrigin:string;pinsDigest:string;pairingSecret:string;members:LocalMember[];exited:boolean;
  termination?:{stop_id:string|null;mode:string;reason:string;at:number};sentStopId?:string;intent?:StopIntent;forceReason?:string;
  terminationMode?:StopReceipt['result'];ack?:import('./local-shutdown.js').EngineAck;
  engineSession?:string;error?:Error;paired:boolean;launched:boolean;terminationRejected?:boolean;stop?:Promise<StopOutcome>};

const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const execute=promisify(execFile);
const ffmpeg=createRequire(import.meta.url)('ffmpeg-static') as string|null;
export const localRuntimeManifest=()=>JSON.parse(requireText('worker/local-runtime.json')) as {revision:string;torch:string;roles:Record<WorkerClass,{kitchen:string;aimdo:string;flags:string[];quiesce:unknown}>};
function requireText(relative:string){return readFileSync(path.join(packageRoot,relative),'utf8');}
function childEnvironment(){return Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)&&!key.startsWith('T3_')));}
async function availablePort(){
  const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;
}
export function processGone(pid?:number){
  if(typeof pid!=='number'||!Number.isSafeInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
}

/** Owns one engine incarnation; reservations and idle policy belong to LocalWorker. */
export class LocalRuntime {
  private current?:Session;
  private changing?:Promise<WorkerConnection>;
  private closing=false;
  private priorOwnership?:LocalOwnership;
  private priorStop?:StopRecord;
  private release?:()=>Promise<void>;
  private adapterTransfer?:{controller:AbortController;task:Promise<AdapterInventory>};
  readonly root:string;
  readonly workspace:string;
  constructor(private paths:StudioPaths,root?:string,private onOwnership?:(owner:LocalOwnership)=>void,private onStop?:(record:StopRecord)=>void){
    this.root=path.resolve(root??process.env.SEED_LOCAL_ROOT??path.join(paths.data,'local-worker'));
    this.workspace=path.join(paths.data,'local-workspace');
  }
  async installation():Promise<LocalInstallation|null>{
    try{
      const value=JSON.parse(await readFile(path.join(this.root,'runtime-ready.json'),'utf8')) as LocalInstallation;
      const manifest=localRuntimeManifest();
      if(value.revision!==manifest.revision)throw Error('Local runtime revision changed. Run setup again.');
      for(const [role,entry] of Object.entries(value.roles)){
        if(!['image','video'].includes(role)||!entry||entry.device_count!==1||entry.torch!==manifest.torch||
          entry.kitchen!==manifest.roles[role as WorkerClass].kitchen||entry.aimdo!==manifest.roles[role as WorkerClass].aimdo||
          !/^[\da-f-]{36}$/i.test(entry.gpu_uuid))throw Error('Local runtime metadata does not match the release.');
        for(const file of [entry.python,entry.base_python,entry.source]){
          const relative=path.relative(this.root,path.resolve(file));
          if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Local runtime path leaves its managed directory.');
        }
      }
      const {stdout}=await execute('nvidia-smi.exe',['--query-gpu=uuid','--format=csv,noheader'],{windowsHide:true,timeout:10000,env:childEnvironment()});
      const devices=stdout.trim().split(/\r?\n/).map(value=>value.trim().replace(/^GPU-/i,''));
      if(devices.length!==1||Object.values(value.roles).some(role=>role!.gpu_uuid.toLowerCase()!==devices[0]!.toLowerCase()))
        throw Error('The installed local runtime belongs to different GPU hardware. Run setup again.');
      return value;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  get role(){return this.current?.role;}
  get alive(){return Boolean(this.current&&!this.current.exited);}
  get ownership(){return this.current?.ownership;}
  get recovering(){return this.current?.recoverOnly??false;}
  rememberOwnership(owner:LocalOwnership,stop?:StopRecord){this.priorOwnership=owner;this.priorStop=stop;}
  prepareStop(intent:StopIntent){if(this.current)this.current.intent??=intent;else this.priorStop=intent;}
  async ownershipGone(owner:LocalOwnership){
    if(!/^[\da-f-]{36}$/i.test(owner.incarnation))return false;
    const directory=path.join(this.root,'instances',owner.incarnation);
    let members:LocalMember[],journalPresent=false;
    try{members=JSON.parse(await readFile(path.join(directory,'members.json'),'utf8'));journalPresent=true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;members=owner.members??[];}
    let unresolved:Array<number|{pid:number;created:null;first_seen:string}>=[];
    try{unresolved=JSON.parse(await readFile(path.join(directory,'unresolved-members.json'),'utf8'));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(!Array.isArray(members)||!Array.isArray(unresolved)||unresolved.some(value=>typeof value==='number'?!Number.isSafeInteger(value)||value<=0:
      !value||!Number.isSafeInteger(value.pid)||value.pid<=0||value.created!==null||typeof value.first_seen!=='string'||!/^\d{1,20}$/.test(value.first_seen)))return false;
    // Empty v2 members means no child could have run: the gateway is persisted
    // while suspended. The launch authorization marker alone changes no state.
    const installed=JSON.parse(await readFile(path.join(this.root,'runtime-ready.json'),'utf8')) as LocalInstallation;
    const python=installed.roles[owner.role]?.base_python;if(!python)return false;
    const relative=path.relative(this.root,path.resolve(python));
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return false;
    const identities=[...members,...unresolved.map(value=>typeof value==='number'?{pid:value,created:null}:value),
      {pid:owner.supervisor_pid,created:owner.supervisor_created??null},
      ...(owner.owner_pid===process.pid?[]:[{pid:owner.owner_pid,created:owner.owner_created??null}])];
    const prior=path.join(directory,'prior-check.json');await writeFile(prior,JSON.stringify(identities),{flush:true});
    const {stdout}=await execute(python,['-m','worker.local_members','--prior',prior,'--boot-file',path.join(directory,'boot.json')],{cwd:packageRoot,env:{...childEnvironment(),PYTHONPATH:packageRoot},windowsHide:true,timeout:10000});
    const proof=JSON.parse(stdout);
    return proof.gone===true&&(owner.containment==='windows-nested-jobs-v2'&&journalPresent||proof.rebooted===true);
  }
  private async launchAborted(owner:LocalOwnership){
    if(owner.containment!=='windows-nested-jobs-v2'||!/^[\da-f-]{36}$/i.test(owner.incarnation))return false;
    try{const members=JSON.parse(await readFile(path.join(this.root,'instances',owner.incarnation,'members.json'),'utf8'));
      return Array.isArray(members)&&members.length===0;
    }catch{return false;}
  }
  async prepareAdapters(sources:LoraSourceManifest[],onProgress:(progress:AdapterProgress)=>void){
    if(this.closing)throw Error('Local worker is closing.');
    if(this.adapterTransfer)throw Error('A local LoRA download is already running.');
    const controller=new AbortController();
    const task=(async()=>{
      const installed=await this.installation(),python=installed?.roles.image?.base_python;
      controller.signal.throwIfAborted();
      if(this.closing)throw Error('Local worker is closing.');
      if(!python)throw Error('Set up the local image runtime before downloading LoRAs.');
      return prepareLocalAdapters({python,workspace:this.workspace,packageRoot,paths:this.paths,sources,onProgress,signal:controller.signal});
    })();
    const transfer={controller,task};this.adapterTransfer=transfer;
    try{return await task;}finally{if(this.adapterTransfer===transfer)this.adapterTransfer=undefined;}
  }
  async cancelPreparation(){
    const transfer=this.adapterTransfer;if(!transfer)return;
    transfer.controller.abort();await transfer.task.catch(()=>{});
  }
  async start(role:WorkerClass,recoverOnly=false):Promise<WorkerConnection>{
    if(this.closing)throw Error('Local worker is closing.');
    if(this.changing)return this.changing;
    const task=this.launch(role,recoverOnly).finally(()=>{if(this.changing===task)this.changing=undefined;});
    this.changing=task;return task;
  }
  private async launch(role:WorkerClass,recoverOnly:boolean){
    if(this.current&&!this.current.exited&&this.current.role===role&&this.current.recoverOnly===recoverOnly){
      if(this.current.error)throw this.current.error;return this.current.connection;
    }
    const previous=await this.stop();
    if(previous.outcome!=='stopped')throw Error('Local shutdown is still pending. GPU ownership is retained.');
    if(this.closing)throw Error('Local worker is closing.');
    if(process.platform!=='win32')throw Error('Local workers currently require Windows.');
    const installed=await this.installation(),runtime=installed?.roles[role];
    if(!installed||!runtime)throw Error('Set up this local worker role first.');
    this.release=await localLease(this.root);
    try {
    const incarnation=randomUUID(),directory=path.join(this.root,'instances',incarnation);
    await mkdir(directory,{recursive:true});await mkdir(this.workspace,{recursive:true});
    const site=path.resolve(path.dirname(runtime.python),'../Lib/site-packages'),pins=path.join(directory,'quiesce-pins.json');
    await writeFile(pins,JSON.stringify(localRuntimeManifest().roles[role].quiesce),{flush:true});
    let pinsDigest='';
    if(!recoverOnly){
      try{const result=await execute(runtime.base_python,['-m','worker.local_revision','--source',runtime.source,'--site',site,'--pins',pins],
        {cwd:packageRoot,env:{...childEnvironment(),PYTHONPATH:packageRoot},windowsHide:true,timeout:10000});
        pinsDigest=JSON.parse(result.stdout).pins_digest;}
      catch{throw Error('Local engine revision does not match its shutdown protocol. Run setup again.');}
    }
    if(!recoverOnly){
      // Record the starting conditions. Fixed free-memory thresholds have not
      // been validated for this workload and must not veto execution.
      try{
        const {stdout}=await execute(runtime.base_python,['-c','from worker.local_metrics import host_memory; import json; print(json.dumps(host_memory()))'],{cwd:packageRoot,env:{...childEnvironment(),PYTHONPATH:packageRoot},windowsHide:true,timeout:10000});
        await writeFile(path.join(directory,'host-memory-start.json'),stdout);
      }catch{ /* Memory telemetry is diagnostic, not an admission requirement. */ }
    }
    if(!recoverOnly){
      await cp(path.join(packageRoot,'worker/comfy_seed'),path.join(runtime.source,'custom_nodes/comfy_seed'),{recursive:true,filter:source=>!source.includes('__pycache__')});
      await cp(path.join(packageRoot,'worker/spool.py'),path.join(runtime.source,'custom_nodes/comfy_seed/spool.py'));
    }
    const port=await availablePort();let enginePort=await availablePort();
    while(enginePort===port)enginePort=await availablePort();
    const origin='http://127.0.0.1:'+port,comfyOrigin='http://127.0.0.1:'+enginePort,pairingSecret=randomBytes(32).toString('base64url');
    const config=path.join(directory,'launch.json');
    await writeFile(config,JSON.stringify({role,workspace:this.workspace,runtime:directory,models:path.join(this.root,'models'),source:runtime.source,
      python:runtime.python,site,pins,origin,comfy_origin:comfyOrigin,pairing_secret:pairingSecret,start_engine:!recoverOnly,
      flags:localRuntimeManifest().roles[role].flags}),{flag:'wx',mode:0o600});
    if(this.closing)throw Error('Local worker is closing.');
    const processChild=spawn(runtime.base_python,['-m','worker.local_supervisor','--parent-pid',String(process.pid),'--device-id',runtime.gpu_uuid,
      '--cwd',packageRoot,'--log',path.join(directory,'gateway.log'),'--diagnostics',directory,
      '--venv-python',runtime.python,'--await-owner',
      ...(!recoverOnly?['--metrics',path.join(directory,'metrics.jsonl'),'--system-required']:['--gateway-only']),
      '--',runtime.base_python,'-m','worker.local_run','--config',config],{
      cwd:packageRoot,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...childEnvironment(),PYTHONUNBUFFERED:'1',
        PYTHONPATH:packageRoot,PATH:path.dirname(ffmpeg!)+path.delimiter+(process.env.PATH??'')},
    });
    const session:Session={process:processChild,connection:new WorkerConnection({...this.paths,config:directory},origin),role,recoverOnly,
      directory,origin,comfyOrigin,pinsDigest,pairingSecret,members:[],exited:false,paired:false,launched:false};
    this.current=session;
    let buffer='',stderr='';
    processChild.stdin.on('error',()=>{});
    processChild.on('error',error=>{session.error=error;session.exited=true;});
    processChild.on('close',()=>{session.exited=true;});
    processChild.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-4000);});
    processChild.stdout.on('data',(chunk:Buffer)=>{
      buffer+=chunk.toString();let end;
      if(buffer.length>128000){buffer='';session.error=Error('Invalid local supervisor response. GPU ownership is retained.');return;}
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try{
          const value=JSON.parse(line);
          if(value.event==='contained'&&value.containment==='windows-nested-jobs-v2'&&value.supervisor_pid===processChild.pid){
            if(![value.owner_created,value.supervisor_created].every(time=>typeof time==='string'&&/^\d{1,20}$/.test(time)))throw Error('Missing process identities');
            session.ownership={incarnation,owner_pid:process.pid,owner_created:value.owner_created,supervisor_pid:value.supervisor_pid,supervisor_created:value.supervisor_created,role,runtime_revision:installed.revision,members:[],containment:'windows-nested-jobs-v2'};
            this.onOwnership?.(session.ownership);
            if(!session.launched&&!this.closing&&!session.intent){session.launched=true;processChild.stdin.write('launch\n');}
          }else if(value.event==='member'&&Number.isSafeInteger(value.pid)&&typeof value.created==='string'&&/^\d{1,20}$/.test(value.created)){
            if(!session.members.some(member=>member.pid===value.pid&&member.created===value.created))session.members.push({pid:value.pid,created:value.created});
            if(session.ownership){session.ownership.gateway_pid??=value.pid;session.ownership.members=[...session.members];this.onOwnership?.(session.ownership);}
          }else if(value.event==='started'&&value.containment==='windows-nested-jobs-v2'&&Number.isSafeInteger(value.pid)&&Number.isSafeInteger(value.supervisor_pid)){
            session.ownership={...session.ownership!,incarnation,owner_pid:process.pid,gateway_pid:value.pid,members:[...session.members],supervisor_pid:value.supervisor_pid,role,runtime_revision:installed.revision,containment:'windows-nested-jobs-v2'};
            this.onOwnership?.(session.ownership);
          }else if(value.event==='terminated'&&value.terminated===true&&Number.isFinite(value.at)&&
            ((value.stop_id===session.sentStopId&&['quiesced','forced','no_engine'].includes(value.mode))||
             value.stop_id===null&&value.reason==='engine_exited'))session.termination={stop_id:value.stop_id,mode:value.mode,reason:value.reason,at:value.at};
          else if(value.event==='rejected'&&value.stop_id===session.sentStopId&&value.reason==='engine_member_present'){
            session.terminationRejected=true;
          }else if(value.event==='gateway_exit'){
            session.error=Error('Local gateway stopped unexpectedly. GPU ownership is retained for recovery.');
            if(!session.intent)void this.stop(false,{reason:'gateway_lost'}).catch(()=>{});
          }
        }catch{session.error=Error('Invalid local supervisor response. GPU ownership is retained.');}
      }
    });
    const deadline=Date.now()+30000;
    try{
      while(Date.now()<deadline){
        if(session.exited)throw session.error??Error(stderr.includes('already belongs')?'This GPU belongs to another Seed profile.':'The local worker could not start. Inspect its local log.');
        if(session.ownership){
          try{const response=await fetch(origin+'/worker/v1/status',{signal:AbortSignal.timeout(1000),redirect:'error'});await response.body?.cancel();if(response.status===401)break;}catch{}
        }
        await delay(100);
      }
      if(!session.ownership||session.exited)throw Error('Local worker ownership was not established.');
      const headers={'Content-Type':'application/json',Origin:origin};
      const unlock=await fetch(origin+'/worker/v1/unlock',{method:'POST',headers,body:JSON.stringify({pairing_secret:pairingSecret}),signal:AbortSignal.timeout(5000),redirect:'error'});
      if(!unlock.ok){await unlock.body?.cancel();throw Error('Local worker authentication failed.');}
      const cookie=unlock.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');await unlock.body?.cancel();
      const mint=await fetch(origin+'/worker/v1/pairing-codes',{method:'POST',headers:{...headers,Cookie:cookie},body:'{}',signal:AbortSignal.timeout(5000),redirect:'error'});
      if(!mint.ok){await mint.body?.cancel();throw Error('Local worker pairing failed.');}
      const body=await mint.json() as {connection_code:string};await session.connection.pair(body.connection_code);
      session.paired=true;return session.connection;
    }catch(error){await this.stop(false,{reason:'startup_failed'});throw error;}
    } catch(error) {if(!this.current){await this.release?.();this.release=undefined;}throw error;}
  }
  connection(){
    const current=this.current;
    if(!current||current.exited||!current.paired||current.error)throw current?.error??Error('Local worker is asleep or unavailable.');
    return current.connection;
  }
  async forceStop(reason='explicit_emergency'){
    const current=this.current;
    if(current?.intent){this.onStop?.({...current.intent,force:true,reason});}
    if(current)current.forceReason=reason;
    if(current?.stop){
      const result=await current.stop.catch(()=>undefined);
      if(this.current!==current)return result??{outcome:'stopped' as const};
    }
    return this.stop(true,{reason});
  }
  async stop(force=false,options:{reason?:string;timeout?:number;terminationTimeout?:number}={}):Promise<StopOutcome>{
    const current=this.current;if(!current){
      const prior=this.priorOwnership;
      if(prior){
        const gone=await this.ownershipGone(prior);
        if(this.priorOwnership!==prior)return {outcome:'stopped'};
        if(!gone)return {outcome:'stop_pending',since:new Date().toISOString(),phase:'termination_unconfirmed'};
        const intent=this.priorStop??{stop_id:randomUUID(),incarnation:prior.incarnation,requested_at:new Date().toISOString(),reason:'owner_lost'};
        if(!intent.receipt){
          const aborted=await this.launchAborted(prior);
          if(this.priorOwnership!==prior)return {outcome:'stopped'};
          delete intent.phase;
          this.onStop?.({...intent,outcome:'stopped',receipt:{...intent,result:aborted?'no_engine':'forced',reason:aborted?'launch_aborted':'owner_lost',faults:[],terminated_at:new Date().toISOString()}});
        }
        this.priorOwnership=undefined;this.priorStop=undefined;
      }else if(this.priorStop&&!this.priorStop.receipt){
        this.onStop?.({...this.priorStop,outcome:'stopped',receipt:{...this.priorStop,result:'no_engine',faults:[],terminated_at:new Date().toISOString()}});
        this.priorStop=undefined;
      }
      await this.release?.();this.release=undefined;return {outcome:'stopped'};
    }
    if(force)current.forceReason=options.reason??'explicit_emergency';
    if(options.reason==='user_cancel'&&current.intent&&!current.sentStopId&&!current.termination){
      current.intent.reason='user_cancel';current.intent.cancel_running=true;
      this.onStop?.(current.intent); // Escalation is durable before joining an in-flight drain.
    }
    if(current.stop)return current.stop;
    const task=(async():Promise<StopOutcome>=>{
      const intent=current.intent??={stop_id:randomUUID(),incarnation:current.ownership?.incarnation,reason:options.reason??'normal',requested_at:new Date().toISOString()};
      intent.cancel_running??=intent.reason==='user_cancel';
      this.onStop?.(intent); // Synchronous durable SQLite intent precedes any await.
      const pending=(phase:NonNullable<StopIntent['phase']>):StopOutcome=>{
        intent.phase=phase;this.onStop?.({...intent,outcome:'stop_pending'});
        return {outcome:'stop_pending',since:intent.requested_at,phase};
      };
      let ack=current.ack;
      if(current.terminationRejected&&!current.forceReason)return pending('termination_rejected');
      const noEngine=current.recoverOnly||current.launched===false;
      let result:StopReceipt['result']=current.terminationMode??(noEngine?'no_engine':'engine_exited');
      if(current.exited&&!current.termination&&!noEngine){
        result='forced';intent.force=true;intent.reason='supervisor_lost';this.onStop?.(intent);
      }
      if(!current.forceReason&&!current.exited&&!noEngine&&!current.termination&&!current.sentStopId){
        const drained=await drainLocalEngine({intent,session:current.engineSession,gatewayPid:current.ownership?.gateway_pid,pinsDigest:current.pinsDigest,
          members:()=>current.members,force:()=>!!current.forceReason||!!current.termination||current.exited,timeout:options.timeout,
          request:async known=>{
            let engine=known;
            if(!engine){
              const response=await fetch(current.comfyOrigin+'/studio/session',{redirect:'error',signal:AbortSignal.timeout(1000)});
              if(!response.ok){await response.body?.cancel();throw Error('Engine identity unavailable');}
              const identity=await response.json() as {engine_session_id:string;pid:number};
              if(!current.members.some(member=>member.pid===identity.pid)||identity.pid===current.ownership?.gateway_pid)throw Error('Engine identity is not owned');
              engine=identity.engine_session_id;current.engineSession=engine;
            }
            if(current.paired&&!current.error){
              try{return await current.connection.json('/comfy/quiesce',{method:'POST',body:{stop_id:intent.stop_id,cancel_running:intent.cancel_running},session:engine,signal:AbortSignal.timeout(1000)});}catch{}
            }
            const response=await fetch(current.comfyOrigin+'/studio/quiesce',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Engine-Session':engine!},
              body:JSON.stringify({stop_id:intent.stop_id,cancel_running:intent.cancel_running}),redirect:'error',signal:AbortSignal.timeout(1000)});
            if(!response.ok){await response.body?.cancel();throw Error('Engine quiesce unavailable');}return response.json();
          },onPhase:phase=>{intent.phase=phase;this.onStop?.(intent);}});
        if('pending' in drained)return pending(drained.pending!);
        if('ack' in drained){ack=current.ack=drained.ack;result='quiesced';}
      }
      if(current.forceReason){
        intent.force=true;intent.reason=current.forceReason;this.onStop?.(intent);result='forced';
        await appendFile(path.join(current.directory,'lifecycle.jsonl'),JSON.stringify({at:Date.now()/1000,event:'forced_stop_intent',stop_id:intent.stop_id,reason:intent.reason,phase:intent.phase})+'\n',{flush:true});
      }
      if(!current.exited&&!current.termination){
        if(!current.forceReason&&!noEngine&&!ack)return pending('identity_lost');
        current.sentStopId=intent.stop_id;
        current.terminationMode=result;
        current.terminationRejected=false;
        current.process.stdin.write(JSON.stringify({op:'terminate',stop_id:intent.stop_id,mode:result,reason:intent.reason})+'\n');
      }
      const deadline=Date.now()+(options.terminationTimeout??30000);
      while(!current.exited&&!current.terminationRejected&&Date.now()<deadline)await delay(50);
      if(current.terminationRejected)return pending('termination_rejected');
      if(!current.exited)return pending('termination_unconfirmed');
      if(!current.termination&&current.launched!==false&&(!current.ownership||!await this.ownershipGone(current.ownership)))return pending('termination_unconfirmed');
      if(current.termination?.reason==='engine_exited')result='engine_exited';
      else if(current.termination&&['quiesced','forced','no_engine'].includes(current.termination.mode))result=current.termination.mode as StopReceipt['result'];
      else if(current.ownership&&await this.launchAborted(current.ownership)){result='no_engine';intent.reason='launch_aborted';}
      delete intent.phase;
      const receipt:StopReceipt={...intent,result,faults:ack?.faults?.map(fault=>fault.kind).filter(kind=>['terminal_persistence','cancel_persistence'].includes(kind))??[],
        ...(ack?{engine_session_id:ack.engine_session_id,engine_pid:ack.pid,parked_at:new Date(ack.phases.parked!*1000).toISOString()}:{}),terminated_at:new Date().toISOString()};
      this.onStop?.({...intent,outcome:'stopped',receipt}); // Receipt commits before the lease is released.
      await this.release?.();this.release=undefined;
      if(this.current===current)this.current=undefined;
      this.priorOwnership=undefined;
      return {outcome:'stopped',receipt};
    })().finally(()=>{if(current.stop===task)current.stop=undefined;});current.stop=task;return task;
  }
  async close(){
    this.closing=true;
    void this.cancelPreparation().catch(()=>{});
    return boundedLocalClose(()=>this.stop(false,{reason:'service_stop',timeout:90000}),()=>this.forceStop('service_stop_deadline'),()=>{
      const intent=this.current?.intent??this.priorStop;
      if(intent)this.onStop?.({...intent,force:true,reason:'service_stop_deadline',phase:'termination_unconfirmed',outcome:'stop_pending'});
      return {outcome:'stop_pending',since:intent?.requested_at??new Date().toISOString(),phase:'termination_unconfirmed'};
    });
  }
}
