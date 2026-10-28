import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import type {StudioPaths} from './storage.js';
import type {WorkerClass} from '../shared/pool.js';
import type {LocalWorkerView} from '../shared/local-worker.js';
import {LOCAL_MODEL_IDLE_MINUTES} from '../shared/local-worker.js';
import {LocalRuntime,localRuntimeManifest,type LocalOwnership} from './local-runtime.js';
import type {ImageRequest} from './workflows.js';
import {executionRoute,isVideoWorkflow,MAX_EDIT_IMAGES,QWEN_PROFILE} from '../shared/workflows.js';
import {isResolutionSize} from '../shared/resolution.js';
import {videoProfile} from '../shared/video-settings.js';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Loras} from './loras.js';
import type {LoraSourceManifest} from '../shared/loras.js';
import type {StopRecord,StopOutcome} from './local-shutdown.js';

export type LocalWorkerRecord=LocalWorkerView&{attempt_id?:string;ownership?:LocalOwnership;stop?:StopRecord;interrupted?:boolean;profile?:string;adapter_sources?:LoraSourceManifest[];adapters_ready?:boolean};
export type LocalBoundary={workflow:string;route:string;size:string;aspect:string;duration_seconds?:number;max_references:number;reference_kinds?:string[];reference_roles?:string[];width?:number;height?:number;profile:string};
type Runtime=Pick<LocalRuntime,'installation'|'start'|'stop'|'forceStop'|'close'|'connection'|'alive'|'role'|'ownership'|'recovering'|'workspace'|'prepareAdapters'|'cancelPreparation'|'rememberOwnership'|'ownershipGone'|'prepareStop'>;
const isLocal=(value:unknown):value is LocalWorkerRecord=>Boolean(value&&typeof value==='object'&&'executor'in value&&value.executor==='local');
const stopMessage=(phase?:string)=>phase==='termination_rejected'
  ?'The supervisor refused the stop because another process may still be running. Use Force stop to end it explicitly; the reservation is retained.'
  :phase==='unsupported'?'The local engine revision does not support this shutdown protocol. Run setup again after stopping it; the reservation is retained.'
  :`Local shutdown is waiting (${phase?.replaceAll('_',' ')??'confirmation'}). GPU ownership is retained.`;

/** One durable GPU reservation, held through output acknowledgement. */
export class LocalWorker {
  readonly runtime:Runtime;
  private changing?:Promise<void>;
  private timer?:ReturnType<typeof setInterval>;
  private closing=false;
  private boundaries:LocalBoundary[]=[];
  private imageWorkflows:string[]=[];
  private now:()=>number;
  private injectedBoundaries:boolean;
  private preparingSince?:number;
  private unreachableSince?:number;
  private nextStopCheck=0;
  private stopCheckDelay=1000;
  private loras:Loras;
  constructor(private db:Database.Database,paths:StudioPaths,options:{runtime?:Runtime;now?:()=>number;boundaries?:LocalBoundary[]}={}){
    this.now=options.now??Date.now;
    this.loras=new Loras(paths);
    this.runtime=options.runtime??new LocalRuntime(paths,undefined,ownership=>this.update(record=>{
      record.ownership=ownership;if(record.stop?.receipt&&record.stop.incarnation!==ownership.incarnation)delete record.stop;
    }),
      stop=>this.update(record=>{
        record.stop=stop;record.ready=false;record.state='releasing';
        if(stop.outcome==='stop_pending'){
          record.state='needs_attention';record.issue={code:'local_stop_pending',
            message:stopMessage(stop.phase),retryable:true};
        }
      }));
    this.boundaries=options.boundaries??[];
    this.injectedBoundaries=options.boundaries!==undefined;
    const record=this.get();
    if(record){
      if(record.stop&&!record.stop.receipt&&record.ownership?.owner_pid!==process.pid){
        record.stop={...record.stop,reason:'owner_lost',force:true,outcome:'stop_pending',phase:'termination_unconfirmed'};
      }
      if(record.ownership)this.runtime.rememberOwnership(record.ownership,record.stop);
      else if(record.stop&&!record.stop.receipt)this.runtime.prepareStop(record.stop);
      if(!this.injectedBoundaries)this.loadBoundaries(record.gpu,record.runtime_revision);
      record.workflows=this.workflows();
      // Acquiring a coordinator lock is necessary but is not by itself proof
      // that an old engine died. Preserve the reservation until all owners
      // recorded before execution are gone.
      if(record.ownership){
        record.ready=false;record.state='recovering';record.issue={code:'local_ownership_unknown',message:'Checking whether the previous local worker has stopped. If this check stays blocked, restart Windows to clear the previous engine.',retryable:true};
      }else if(record.current_job_id){record.interrupted=true;record.ready=false;record.state='recovering';}
      else{record.ready=false;record.state=record.enabled&&!record.paused?'sleeping':'disabled';delete record.session_id;}
      this.save(record);
    }
  }
  get():LocalWorkerRecord|null{
    const rows=this.db.prepare("SELECT snapshot_json FROM pool_workers WHERE json_extract(snapshot_json,'$.executor')='local'").all() as {snapshot_json:string}[];
    if(rows.length>1)throw Error('More than one local physical device is recorded.');
    if(!rows[0])return null;const value=JSON.parse(rows[0].snapshot_json);if(!isLocal(value))throw Error('Invalid local worker record.');return value;
  }
  private save(record:LocalWorkerRecord){this.db.prepare('INSERT INTO pool_workers(id,snapshot_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(record.id,JSON.stringify(record));}
  private loadBoundaries(gpu:string,revision:string){
    const qualified=JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../worker/local-qualified.json'),'utf8'));
    this.boundaries=qualified.runtime_revision===revision&&qualified.gpu===gpu?qualified.boundaries:[];
    this.imageWorkflows=qualified.runtime_revision===revision&&qualified.gpu===gpu
      ?(qualified.enabled_image_workflows??[]).filter((workflow:string)=>['text-to-image','image-to-image'].includes(workflow)):[];
  }
  private workflows(){return [...new Set([...this.imageWorkflows,...this.boundaries.map(item=>item.workflow)])];}
  private update(change:(record:LocalWorkerRecord)=>void){const record=this.get();if(!record)return;change(record);this.save(record);return record;}
  recordServiceStop(){
    try{
      const record=this.update(record=>{record.stop={stop_id:record.stop&&!record.stop.receipt?record.stop.stop_id:randomUUID(),
        incarnation:record.ownership?.incarnation,reason:'service_stop',requested_at:new Date(this.now()).toISOString()};});
      if(record?.stop)this.runtime.prepareStop(record.stop);
      return true;
    }catch{return false;}
  }
  private requireStopped(outcome:StopOutcome|void){
    if(outcome?.outcome==='stop_pending'){
      this.update(record=>{record.ready=false;record.state='needs_attention';record.issue={code:'local_stop_pending',
        message:stopMessage(outcome.phase),retryable:true};});
      throw Error('Local shutdown is still pending. GPU ownership is retained.');
    }
  }
  private stopped(){
    this.nextStopCheck=0;this.stopCheckDelay=1000;
    this.update(record=>{record.ready=false;delete record.ownership;delete record.session_id;delete record.idle_deadline;
      if(record.issue&&['local_stop_pending','local_runtime_failed','local_ownership_unknown'].includes(record.issue.code))delete record.issue;
      record.interrupted=Boolean(record.current_job_id);
      record.state=record.current_job_id?'recovering':record.enabled&&!record.paused?'sleeping':'disabled';});
  }
  private boundary(request:ImageRequest,dimensions?:{width:number;height:number}){
    if(request.loras?.length){
      if(request.workflow!=='text-to-image')return undefined;
      const available=this.loras.manifestSources('image');
      if(request.loras.some(selected=>!available.some(source=>source.id===selected.id&&source.revision===selected.revision)))return undefined;
    }
    // Image availability is independent of the experimental video benchmark list.
    // Requests still pass the normal workflow/model validation before execution.
    if(this.imageWorkflows.includes(request.workflow)&&isResolutionSize('image',request.output.size)&&request.output.duration_seconds===undefined){
      const references=request.references??[];
      if(request.workflow==='text-to-image'&&!references.length&&['16:9','9:16'].includes(request.output.aspect))
        return {workflow:request.workflow,route:'image',size:request.output.size,aspect:request.output.aspect,max_references:0,profile:'krea-turbo-int8-v1'};
      if(request.workflow==='image-to-image'&&request.output.aspect==='source'&&references.length>0&&references.length<=MAX_EDIT_IMAGES&&
        references.filter(reference=>reference.role==='source').length===1&&references.every(reference=>reference.kind==='image'&&['source','reference'].includes(reference.role))&&
        dimensions&&[dimensions.width,dimensions.height].every(value=>Number.isSafeInteger(value)&&value>=32&&value%32===0))
        return {workflow:request.workflow,route:'image-edit',size:request.output.size,aspect:'source',max_references:MAX_EDIT_IMAGES,profile:QWEN_PROFILE};
    }
    return this.boundaries.find(boundary=>boundary.workflow===request.workflow&&boundary.route===executionRoute(request)&&boundary.size===request.output.size&&boundary.aspect===request.output.aspect&&
      (!isVideoWorkflow(request.workflow)||boundary.profile===videoProfile(request,true))&&
      boundary.duration_seconds===request.output.duration_seconds&&(request.references?.length??0)<=boundary.max_references&&
      (request.references??[]).every(reference=>boundary.reference_kinds?.includes(reference.kind)&&(!boundary.reference_roles||boundary.reference_roles.includes(reference.role)))&&
      (request.output.aspect!=='source'||Boolean(boundary.width&&boundary.height))&&
      (boundary.width===undefined||boundary.width===dimensions?.width&&boundary.height===dimensions?.height));
  }
  supports(request:ImageRequest,dimensions?:{width:number;height:number}){return Boolean(this.boundary(request,dimensions));}
  async enable(enabled:boolean){
    if(this.changing)throw Error('Wait for the local worker operation to finish.');
    let record=this.get();
    if(enabled){
      if(record?.stop&&!record.stop.receipt||record?.issue?.code==='local_stop_pending'||record?.issue?.code==='local_ownership_unknown')throw Error('Wait for local shutdown to finish before enabling it.');
      const installed=await this.runtime.installation(),image=installed?.roles.image;
      if(!installed||!image)throw Error('Finish local worker setup before enabling it.');
      if(!this.injectedBoundaries){
        this.loadBoundaries(image.gpu,installed.revision);
      }
      if(!record){record={executor:'local',id:'local-'+image.gpu_uuid,enabled:true,paused:false,state:'sleeping',gpu:image.gpu,vram_gb:image.vram_bytes/1024**3,
        worker_class:'image',workflows:this.workflows(),installed_loras:[],ready:false,created_at:new Date(this.now()).toISOString(),runtime_revision:localRuntimeManifest().revision};}
      if(record.id!=='local-'+image.gpu_uuid)throw Error('This profile belongs to a different GPU. Review the local installation.');
      record.enabled=true;record.paused=false;delete record.quit_mode;
      record.workflows=this.workflows();
      if(!record.current_job_id){record.state=this.runtime.alive?'ready':'sleeping';delete record.issue;}
      this.save(record);
    }else if(record){record.enabled=false;record.paused=true;this.save(record);if(!record.current_job_id)await this.sleep();}
    return this.get();
  }
  claim(job:string,request:ImageRequest,dimensions?:{width:number;height:number}):LocalWorkerRecord|null{
    if(this.closing||this.changing||!this.supports(request,dimensions))return null;
    return this.db.transaction(()=>{
      const record=this.get();if(!record||!record.enabled||record.paused||record.current_job_id||record.stop&&!record.stop.receipt||!['sleeping','ready'].includes(record.state))return null;
      const role:WorkerClass=request.workflow.endsWith('image')?'image':'video';
      const selected=request.loras??[],available=selected.length?this.loras.manifestSources('image'):[];
      record.adapter_sources=selected.map(selection=>available.find(source=>source.id===selection.id&&source.revision===selection.revision)!);
      if(record.adapter_sources.some(source=>!source))throw Error('A selected LoRA source changed. Review the request before retrying.');
      record.adapters_ready=!record.adapter_sources.length;
      delete record.adapter_download;
      const attempt=randomUUID(),profile=this.boundary(request,dimensions)!.profile;
      this.db.prepare('INSERT INTO job_attempts VALUES (?,?,?,?,?)').run(attempt,job,record.id,'active',JSON.stringify({id:attempt,job_id:job,worker_id:record.id,executor:'local',role,profile,runtime_revision:record.runtime_revision,created_at:new Date(this.now()).toISOString()}));
      record.current_job_id=job;record.attempt_id=attempt;record.profile=profile;
      // Keep the previous ownership record until the runtime proves every old
      // member gone. A new incarnation replaces it only after that check.
      record.ready=this.runtime.alive&&this.runtime.role===role&&!this.runtime.recovering&&record.adapters_ready;
      record.worker_class=role;record.state=!record.adapters_ready?'preparing':record.ready?'generating':'starting';delete record.idle_deadline;
      this.save(record);return record;
    })();
  }
  start(){this.timer=setInterval(()=>void this.tick(),1000);void this.tick();}
  private cancelled(job:string){return Boolean(this.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(job));}
  async cancelPreparation(job:string){
    if(this.get()?.current_job_id!==job)return;
    await this.runtime.cancelPreparation();
    await this.changing;
  }
  async tick(){
    if(this.closing||this.changing)return;
    const record=this.get();if(!record)return;
    if(record.issue?.code==='local_ownership_unknown'||record.issue?.code==='local_stop_pending'||record.stop&&!record.stop.receipt||
      record.stop?.outcome==='stopped'&&record.ownership&&!this.runtime.alive&&!this.runtime.ownership){
      if(this.now()<this.nextStopCheck)return;
      this.nextStopCheck=this.now()+this.stopCheckDelay;this.stopCheckDelay=Math.min(30000,this.stopCheckDelay*2);
      const task=(async()=>{const outcome=await this.runtime.stop();if(outcome?.outcome!=='stop_pending')this.stopped();})()
        .catch(()=>{if(!this.closing)this.update(value=>{value.ready=false;value.state='needs_attention';value.issue={code:'local_ownership_unknown',message:'Seed could not verify the previous local engine. Check the local runtime installation, then retry recovery.',retryable:true};});})
        .finally(()=>{if(this.changing===task)this.changing=undefined;});
      this.changing=task;await task;return;
    }
    if(record.issue)return;
    // Jobs can finish saving while a status/capability/download request is in
    // flight. Only the same reservation may consume that asynchronous result.
    const sameAssignment=(value:LocalWorkerRecord)=>value.current_job_id===record.current_job_id&&value.attempt_id===record.attempt_id;
    const stillAssigned=()=>{if(this.closing)return false;const current=this.get();return !!current&&sameAssignment(current);};
    const updateAssignment=(change:(value:LocalWorkerRecord)=>void)=>{if(!this.closing)this.update(value=>{if(sameAssignment(value))change(value);});};
    const task=(async()=>{
      if(record.current_job_id){
        if(!record.adapters_ready&&record.adapter_sources?.length&&this.cancelled(record.current_job_id))return;
        if(!record.interrupted&&!record.adapters_ready&&record.adapter_sources?.length){
          updateAssignment(value=>{value.ready=false;value.state='preparing';value.current_activity='Preparing selected LoRAs';});
          try{
            const inventory=await this.runtime.prepareAdapters(record.adapter_sources,progress=>updateAssignment(value=>{
              value.adapter_download=progress;value.current_activity=progress.phase;
            }));
            updateAssignment(value=>{
              const installed=record.adapter_sources!.map(source=>({id:source.id,revision:source.revision,route:source.route,name:source.name,
                filename:inventory.find(item=>item.sha256===source.sha256&&item.routes.includes(source.route))!.filename,sha256:source.sha256}));
              value.installed_loras=[...value.installed_loras.filter(item=>!installed.some(next=>next.id===item.id)),...installed];
              value.adapters_ready=true;delete value.adapter_download;delete value.current_activity;
            });
          }catch(error){
            if(this.cancelled(record.current_job_id)||this.closing||this.get()?.quit_mode==='now')return;
            updateAssignment(value=>{value.ready=false;value.state='needs_attention';value.issue={code:'local_adapter_failed',
              message:error instanceof Error?error.message:'LoRA preparation failed. Retry the download.',retryable:true};});
            return;
          }
          if(this.closing||this.get()?.quit_mode==='now'||this.cancelled(record.current_job_id)||!stillAssigned())return;
        }
        if(!this.runtime.alive||this.runtime.role!==record.worker_class||this.runtime.recovering!==Boolean(record.interrupted)){
          if(record.ownership&&this.runtime.ownership&&!this.runtime.alive)updateAssignment(value=>{value.interrupted=true;value.state='recovering';});
          const current=this.get()!;
          await this.runtime.start(current.worker_class,Boolean(current.interrupted));
          if(!stillAssigned())return;
          this.preparingSince=this.now();
          updateAssignment(value=>{value.ownership=this.runtime.ownership;});
        }
        const status=await this.runtime.connection().status({fresh:true});
        if(!stillAssigned())return;
        if(!status){
          this.unreachableSince??=this.now();
          if(this.now()-this.unreachableSince<30000)return;
          throw Error('The local gateway could not be reached for 30 seconds. Its assignment is preserved; retry recovery.');
        }
        this.unreachableSince=undefined;
        if(status.terminal_error)throw Error(status.terminal_error.message);
        if(status.state==='preparing'&&!this.get()?.interrupted&&this.preparingSince!==undefined&&this.now()-this.preparingSince>180000){
          this.requireStopped(await this.runtime.stop());
          throw Error('The local engine did not become ready within three minutes. Inspect its engine log, then retry recovery.');
        }
        if(status.state!=='preparing'&&!this.get()?.interrupted){
          const capability=await this.runtime.connection().json('/comfy/capabilities');
          if(!stillAssigned())return;
          if(capability.engine_session_id!==status.engine_session_id||capability.workspace_id!==status.workspace_id||!capability.ready)
            throw Error(capability.hardware?.error??'Local models or native kernels are not ready. Run setup again.');
        }
        updateAssignment(value=>{
          value.session_id=status.engine_session_id??undefined;
          value.ready=status.state!=='preparing';
          value.state=value.interrupted?'recovering':value.ready?(value.state==='saving'?'saving':'generating'):'preparing';
          const activity=status.execution_activity;
          value.current_activity=activity?({loading:'Loading models',editing:'Generating',saving:'Saving output'}[activity.phase]??activity.phase)+(Number.isFinite(activity.percent)?` · ${activity.percent}%`:''):undefined;
          if(value.ready)value.ready_at??=new Date(this.now()).toISOString();
        });
      }else if((!this.runtime.alive&&record.ownership)||this.runtime.alive&&(!record.enabled||record.paused||(record.idle_deadline&&Date.parse(record.idle_deadline)<=this.now())))await this.sleep();
    })().catch(error=>{updateAssignment(value=>{value.ready=false;value.state='needs_attention';if(value.issue?.code!=='local_stop_pending')value.issue={code:'local_runtime_failed',message:error instanceof Error?error.message:'Local worker failed.',retryable:true};});}).finally(()=>{if(this.changing===task)this.changing=undefined;});
    this.changing=task;await task;
  }
  saving(job:string){this.update(record=>{if(record.current_job_id===job)record.state='saving';});}
  replay(job:string,persist:(attempt:string)=>void){
    const record=this.get();
    if(!record||record.current_job_id!==job||!record.interrupted||!record.attempt_id||!this.runtime.recovering)throw Error('The prior local executor has not been fenced.');
    let files:string[]=[];
    try{files=readdirSync(path.join(this.runtime.workspace,'.seed/spool/outputs/seed',record.attempt_id));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(files.some(file=>!file.endsWith('.part')&&!file.endsWith('.tmp')))throw Error('An output file exists without its terminal receipt. Review it before retrying.');
    this.db.transaction(()=>{
      this.db.prepare("UPDATE job_attempts SET state='interrupted' WHERE worker_id=? AND state='active'").run(record.id);
      const attempt=randomUUID();
      this.db.prepare('INSERT INTO job_attempts VALUES (?,?,?,?,?)').run(attempt,job,record.id,'active',JSON.stringify({id:attempt,job_id:job,worker_id:record.id,executor:'local',role:record.worker_class,profile:record.profile,runtime_revision:record.runtime_revision,created_at:new Date(this.now()).toISOString()}));
      record.attempt_id=attempt;record.interrupted=false;record.ready=false;record.state='starting';delete record.session_id;
      this.save(record);persist(attempt);
    })();
  }
  complete(job:string){
    const record=this.get();if(record?.current_job_id!==job)return;
    this.db.transaction(()=>{
      this.db.prepare("UPDATE job_attempts SET state='finished' WHERE job_id=? AND state='active'").run(job);
      delete record.current_job_id;delete record.attempt_id;delete record.interrupted;
      delete record.adapter_sources;delete record.adapters_ready;delete record.adapter_download;delete record.current_activity;
      if(record.issue?.code==='local_adapter_failed')delete record.issue;
      record.state=this.runtime.alive?'ready':record.enabled&&!record.paused?'sleeping':'disabled';
      record.idle_deadline=new Date(this.now()+LOCAL_MODEL_IDLE_MINUTES*60_000).toISOString();this.save(record);
    })();
  }
  async pause(){this.update(record=>{record.paused=true;record.quit_mode='finish';});if(!this.get()?.current_job_id)await this.sleep();return this.get();}
  async recover(){
    if(this.changing)throw Error('Wait for the local worker operation to finish.');
    const record=this.get();if(!record)return;
    if(!record.issue&&!record.interrupted)throw Error('This local worker does not need recovery.');
    if(record.issue?.code==='local_adapter_failed'){
      this.update(value=>{delete value.issue;value.ready=false;value.state='preparing';});
      await this.tick();return this.get();
    }
    const owner=record.ownership;
    if(owner&&owner.owner_pid!==process.pid&&!await this.runtime.ownershipGone(owner))
      throw Error('Seed cannot verify that the previous local engine has stopped. Close any other Seed instance, or restart Windows before retrying recovery.');
    this.requireStopped(await this.runtime.stop());
    if(owner&&!await this.runtime.ownershipGone(owner))throw Error('Prior local executor termination is not confirmed.');
    this.update(value=>{delete value.issue;value.ready=false;value.interrupted=Boolean(value.current_job_id);value.state=value.current_job_id?'recovering':value.enabled&&!value.paused?'sleeping':'disabled';});
    await this.tick();return this.get();
  }
  async cancelNow(cancel:(id:string)=>void,force=false){
    const record=this.get();if(!record)return;
    this.update(value=>{value.paused=true;value.quit_mode='now';value.state='releasing';});
    try{
      await this.runtime.cancelPreparation();
      const stop=()=>force?this.runtime.forceStop():this.runtime.stop(false,{reason:'user_cancel'});
      this.requireStopped(await stop());await this.changing;
      this.requireStopped(await stop());
    }catch(error){
      this.update(value=>{value.ready=false;value.state='needs_attention';value.issue={code:'local_stop_pending',
        message:error instanceof Error?error.message:'Local stopping is not confirmed. The assignment is retained.',retryable:true};});
      throw error;
    }
    cancel(record.id);
    this.update(value=>{value.ready=false;value.state='disabled';delete value.session_id;delete value.ownership;delete value.issue;});
    return this.get();
  }
  async sleep(){
    if(this.get()?.current_job_id)throw Error('The GPU is reserved until its output is saved and acknowledged.');
    this.requireStopped(await this.runtime.stop());
    this.update(record=>{record.ready=false;record.state=record.enabled&&!record.paused?'sleeping':'disabled';delete record.session_id;delete record.ownership;delete record.idle_deadline;});
  }
  async close(){
    this.closing=true;clearInterval(this.timer);
    const outcome=await this.runtime.close();
    if(outcome?.outcome==='stop_pending'){
      this.update(record=>{if(record.stop){record.stop.outcome='stop_pending';record.stop.phase=outcome.phase;}});
    }else this.stopped();
  }
}
