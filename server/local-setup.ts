import {spawn,type ChildProcess} from 'node:child_process';
import {open,readFile,mkdir,writeFile,rename,statfs,realpath,lstat,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {StudioPaths} from './storage.js';
import {localLease} from '../scripts/local-lock.mjs';
import {engineSpec,hardwareProfile,hardwareProfiles} from './hardware.js';
import {credential} from './credential-store.js';

const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
type Model={path:string;size:number;sha256:string};
/** Explicit installation only; observing setup never starts a download or GPU. */
export class LocalSetup {
  readonly root:string;
  private child?:ChildProcess;
  private task?:Promise<void>;
  private starting=false;
  private closing=false;
  private progress:{state:'idle'|'running'|'failed'|'complete';phase:string;error?:string;note?:string}={state:'idle',phase:'Not set up'};
  private readonly paths:StudioPaths;
  constructor(paths:StudioPaths,root?:string){
    this.paths=paths;
    this.root=path.resolve(root??process.env.SEED_LOCAL_ROOT??path.join(paths.data,'local-worker'));
    try{this.progress=JSON.parse(readFileSync(path.join(this.root,'setup-status.json'),'utf8'));}catch{}
    if(this.progress.state==='running')this.progress={state:'failed',phase:'Setup interrupted',error:'Resume setup to verify existing files and continue downloads.'};
  }
  private async models():Promise<Model[]>{
    const read=async(name:string)=>JSON.parse(await readFile(path.join(packageRoot,'worker',name),'utf8'));
    // The detected GPU picks the profile once the runtime exists; until then show the first estimate.
    let gpu:string|undefined;
    try{gpu=JSON.parse(await readFile(path.join(this.root,'runtime-ready.json'),'utf8')).gpu;}catch{}
    const profile=gpu===undefined?hardwareProfiles()[0]:hardwareProfile(gpu);
    const files:Model[]=[...await read('models-image.json'),...(profile?await read(profile.manifest):[]),...(await read('qwen-model.json')).files];
    return [...new Map(files.map(file=>[file.path,file])).values()];
  }
  /** FLUX 3 Image Klein is optional: gated on Hugging Face, so it needs the owner's saved token and accepted licence. */
  private async klein(){
    const spec=JSON.parse(await readFile(path.join(packageRoot,'worker','klein-model.json'),'utf8')) as {files:Model[];total_bytes:number};
    let complete=0;
    for(const model of spec.files){try{const file=await open(path.join(this.root,'models',model.path));try{if((await file.stat()).size===model.size)complete++;}finally{await file.close();}}catch{}}
    let token=false;try{token=Boolean(credential(this.paths,'huggingFaceToken'));}catch{}
    return {installed:complete===spec.files.length,bytes_total:spec.total_bytes,token};
  }
  private async persist(){
    const file=path.join(this.root,'setup-status.json');
    await writeFile(file+'.tmp',JSON.stringify(this.progress));await rename(file+'.tmp',file);
  }
  async status(){
    const models=await this.models();let bytes=0,complete=0;
    for(const model of models){
      for(const suffix of ['','.part']){
        let file;
        try{file=await open(path.join(this.root,'models',model.path+suffix));const stat=await file.stat();bytes+=Math.min(stat.size,model.size);if(!suffix&&stat.size===model.size)complete++;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}finally{await file?.close();}
      }
    }
    let runtime=false,verified=false;
    try{
      runtime=JSON.parse(await readFile(path.join(this.root,'runtime-ready.json'),'utf8')).revision===engineSpec().revision;
      const saved=JSON.parse(await readFile(path.join(this.root,'models-verified.json'),'utf8'));
      verified=models.every(model=>saved.files?.some((entry:Model)=>entry.path===model.path&&entry.sha256===model.sha256&&entry.size===model.size));
    }catch{}
    let disk:number|undefined,candidate=this.root;
    for(;;){try{const space=await statfs(candidate);disk=space.bavail*space.bsize;break;}catch{const parent=path.dirname(candidate);if(parent===candidate)break;candidate=parent;}}
    return {supported:process.platform==='win32',installed:runtime&&verified&&complete===models.length,...this.progress,klein:await this.klein(),
      disk_free_bytes:disk,required_additional_bytes:Math.max(0,models.reduce((sum,file)=>sum+file.size,0)-bytes)+(runtime?2:36)*1024**3,
      bytes_done:bytes,bytes_total:models.reduce((sum,file)=>sum+file.size,0),files_done:complete,files_total:models.length};
  }
  async start(){
    if(this.closing)throw Error('Seed is closing.');if(process.platform!=='win32')throw Error('Local workers currently require Windows.');
    if(this.task||this.starting)return this.status();
    this.starting=true;
    try{
    const status=await this.status();
    if(this.closing)throw Error('Seed is closing.');
    if(status.disk_free_bytes===undefined)throw Error('Cannot determine free disk space for local setup.');
    if(status.disk_free_bytes<status.required_additional_bytes)throw Error(`Local setup needs ${Math.ceil(status.required_additional_bytes/1024**3)} GiB more free space. Free disk space and resume setup.`);
    await mkdir(this.root,{recursive:true});
    this.progress={state:'running',phase:'Installing native runtime'};
    await this.persist();
    this.task=(async()=>{
      const klein=await this.klein();
      for(const mode of ['runtime','models',...(!klein.installed&&klein.token?['klein']:[])]){
        if(this.closing)throw Error('Setup interrupted by shutdown.');
        this.progress.phase=mode==='runtime'?'Installing native runtime':mode==='klein'?'Downloading FLUX 3 Image Klein':'Downloading and verifying models';
        await this.persist();
        try{await new Promise<void>((resolve,reject)=>{
          const child=spawn(process.execPath,[path.join(packageRoot,'scripts/setup-local-worker.mjs'),mode],{windowsHide:true,stdio:['pipe','pipe','pipe'],
            env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)&&!key.startsWith('T3_'))),SEED_LOCAL_ROOT:this.root,SEED_SETUP_PARENT:String(process.pid)}});
          this.child=child;let stderr='';
          child.stdin?.on('error',()=>{});
          // The gated download reads the token from its first stdin line; the pipe stays open as the parent lifeline.
          if(mode==='klein')child.stdin?.write(credential(this.paths,'huggingFaceToken')+'\n');
          child.stderr?.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-4000);});
          child.stdout?.on('data',()=>{});
          child.on('error',reject);child.on('exit',code=>{if(this.child===child)this.child=undefined;code===0?resolve():reject(Error('Local '+mode+' setup failed. Retry to resume verified downloads. '+stderr.slice(-500)));});
        });}catch(error){
          // Klein is optional: the PC works without it, so its failure is a note, not a failed setup.
          if(mode!=='klein')throw error;
          this.progress.note='FLUX 3 Image Klein did not download. Accept its licence on Hugging Face with the account of your saved token, then set up again.';
        }
        if(this.closing)throw Error('Setup interrupted by shutdown.');
      }
      this.progress={state:'complete',phase:'Ready to enable',...(this.progress.note?{note:this.progress.note}:{})};
    })().catch(error=>{this.progress={state:'failed',phase:'Setup needs attention',error:error instanceof Error?error.message:'Setup failed.'};})
      .finally(async()=>{try{await this.persist();}catch{this.progress.error='Could not save setup status. Check the local installation directory.';}finally{this.task=undefined;}});
    return this.status();
    }finally{this.starting=false;}
  }
  async cleanup(kind:'models'|'runtime'|'all'){
    if(this.task||this.starting||this.closing)throw Error('Wait for setup to stop before removing local files.');
    if(!['models','runtime','all'].includes(kind))throw Error('Choose models, runtime, or all.');
    await mkdir(this.root,{recursive:true});const release=await localLease(this.root);
    try{
      const root=await realpath(this.root);
      const names=[...(kind!=='runtime'?['models','models-verified.json']:[]),...(kind!=='models'?['engine','image','video','python','tools','cache','downloads','runtime-ready.json']:[])];
      // A fixed allowlist excludes the durable workspace, Library, receipts and
      // diagnostic logs. Refuse redirected targets.
      for(const name of names){
        const target=path.resolve(root,name);const relative=path.relative(root,target);
        if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Cleanup target leaves the managed installation.');
        try{if((await lstat(target)).isSymbolicLink()||path.resolve(await realpath(target)).toLowerCase()!==target.toLowerCase())throw Error('Cleanup refuses a redirected path: '+name);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      }
      for(const name of names)await rm(path.join(root,name),{recursive:true,force:true});
      this.progress={state:'idle',phase:'Local files removed'};await writeFile(path.join(root,'setup-status.json'),JSON.stringify(this.progress));
      return this.status();
    }finally{await release();}
  }
  async close(){
    this.closing=true;
    if(this.child?.pid&&this.child.exitCode===null){
      const pid=this.child.pid;
      await new Promise<void>(resolve=>{const killer=spawn('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>resolve());killer.on('exit',()=>resolve());});
    }
    await this.task;
  }
}
