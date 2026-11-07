import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import type {StudioPaths} from './storage.js';
import type {WorkerClass} from '../shared/pool.js';
import type {LocalWorkerView} from '../shared/local-worker.js';
import {LOCAL_MODEL_IDLE_MINUTES} from '../shared/local-worker.js';
import {enginePhase,workerPhaseLabel} from '../shared/generation-progress.js';
import {LocalRuntime,type StopOutcome} from './local-runtime.js';
import {engineSpec,hardwareProfile} from './hardware.js';
import type {ImageRequest} from './workflows.js';
import {capabilityFor,executionProfile,loraRoute,KLEIN_CAPABILITY} from '../shared/workflows.js';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Loras} from './loras.js';
import type {LoraSourceManifest} from '../shared/loras.js';

export type LocalWorkerRecord=LocalWorkerView&{attempt_id?:string;interrupted?:boolean;profile?:string;adapter_sources?:LoraSourceManifest[];adapters_ready?:boolean};
type Runtime=Pick<LocalRuntime,'installation'|'start'|'stop'|'close'|'connection'|'alive'|'recovering'|'workspace'|'prepareAdapters'|'cancelPreparation'|'keepAwake'>;
const isLocal=(value:unknown):value is LocalWorkerRecord=>Boolean(value&&typeof value==='object'&&'executor'in value&&value.executor==='local');
// FLUX 3 Image Klein is optional (its weights are gated): offered once all of its pinned files are in place.
const kleinFiles=(JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','worker/klein-model.json'),'utf8')) as {files:Array<{path:string;size:number}>}).files;
const kleinInstalled=(root?:string)=>Boolean(root)&&kleinFiles.every(file=>{try{return statSync(path.join(root!,'models',file.path)).size===file.size;}catch{return false;}});
const workflowsFor=(gpu:string,root?:string)=>['text-to-image','image-to-image',...(kleinInstalled(root)?[KLEIN_CAPABILITY]:[]),...(hardwareProfile(gpu)?['text-to-video','reference-to-video']:[])];
const STOP_PENDING='The local engine has not finished stopping. Retry in a moment, or restart Seed if it stays stuck.';

/** One durable GPU reservation, held through output acknowledgement. */
export class LocalWorker {
  readonly runtime:Runtime;
  private changing?:Promise<void>;
  private timer?:ReturnType<typeof setInterval>;
  private closing=false;
  private now:()=>number;
  private preparingSince?:number;
  private unreachableSince?:number;
  private loras:Loras;
  private root(){return (this.runtime as {root?:string}).root;}
  constructor(private db:Database.Database,paths:StudioPaths,options:{runtime?:Runtime;now?:()=>number}={}){
    this.now=options.now??Date.now;
    this.loras=new Loras(paths);
    this.runtime=options.runtime??new LocalRuntime(paths);
    const record=this.get();
    if(record){
      // Containment ended any engine from a previous coordinator.
      record.workflows=workflowsFor(record.gpu,this.root());record.ready=false;delete record.session_id;
      if(record.issue?.code!=='local_adapter_failed')delete record.issue;
      if(record.current_job_id){record.interrupted=true;record.state='recovering';}
      else record.state=record.enabled&&!record.paused?'sleeping':'disabled';
      this.save(record);
    }
  }
  get():LocalWorkerRecord|null{
    const rows=this.db.prepare("SELECT snapshot_json FROM pool_workers WHERE json_extract(snapshot_json,'$.executor')='local'").all() as {snapshot_json:string}[];
    if(rows.length>1)throw Error('More than one local physical device is recorded.');
    if(!rows[0])return null;const value=JSON.parse(rows[0].snapshot_json);if(!isLocal(value))throw Error('Invalid local worker record.');return value;
  }
  private save(record:LocalWorkerRecord){this.db.prepare('INSERT INTO pool_workers(id,snapshot_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(record.id,JSON.stringify(record));}
  private update(change:(record:LocalWorkerRecord)=>void){const record=this.get();if(!record)return;change(record);this.save(record);return record;}
  private restingState(record:LocalWorkerRecord){return record.current_job_id?'recovering' as const:record.enabled&&!record.paused?'sleeping' as const:'disabled' as const;}
  private requireStopped(outcome:StopOutcome){
    if(outcome.outcome==='stop_pending'){
      this.update(record=>{record.ready=false;record.state='needs_attention';record.issue={code:'local_stop_pending',message:STOP_PENDING,retryable:true};});
      throw Error(STOP_PENDING);
    }
  }
  private stopped(){
    this.update(record=>{record.ready=false;delete record.session_id;delete record.idle_deadline;
      if(record.issue&&['local_stop_pending','local_runtime_failed'].includes(record.issue.code))delete record.issue;
      record.interrupted=Boolean(record.current_job_id);record.state=this.restingState(record);});
  }
  private adapterSources(request:ImageRequest){
    const route=loraRoute(request);
    return this.loras.manifestSources(route==='image'?'image':'video').filter(source=>source.route===route);
  }
  supports(request:ImageRequest){
    if(request.loras?.length){
      if(request.workflow==='image-to-image')return false;
      const available=this.adapterSources(request);
      if(request.loras.some(selected=>!available.some(source=>source.id===selected.id&&source.revision===selected.revision)))return false;
    }
    return Boolean(this.get()?.workflows.includes(capabilityFor(request)));
  }
  async enable(enabled:boolean){
    if(this.changing)throw Error('Wait for the local worker operation to finish.');
    let record=this.get();
    if(enabled){
      if(record?.issue?.code==='local_stop_pending')throw Error('Wait for local shutdown to finish before enabling it.');
      const installed=await this.runtime.installation();
      if(!installed)throw Error('Finish local worker setup before enabling it.');
      record??={executor:'local',id:'local-'+installed.gpu_uuid,enabled:true,paused:false,state:'sleeping',gpu:installed.gpu,vram_gb:installed.vram_bytes/1024**3,
        worker_class:'image',workflows:[],installed_loras:[],ready:false,created_at:new Date(this.now()).toISOString(),runtime_revision:engineSpec().revision};
      if(record.id!=='local-'+installed.gpu_uuid)throw Error('This profile belongs to a different GPU. Review the local installation.');
      record.enabled=true;record.paused=false;delete record.quit_mode;
      record.workflows=workflowsFor(installed.gpu,this.root());record.runtime_revision=installed.revision;
      if(!record.current_job_id){record.state=this.runtime.alive?'ready':'sleeping';delete record.issue;}
      this.save(record);
    }else if(record){record.enabled=false;record.paused=true;this.save(record);if(!record.current_job_id)await this.sleep();}
    return this.get();
  }
  claim(job:string,request:ImageRequest):LocalWorkerRecord|null{
    if(this.closing||this.changing||!this.supports(request))return null;
    return this.db.transaction(()=>{
      const record=this.get();if(!record||!record.enabled||record.paused||record.current_job_id||!['sleeping','ready'].includes(record.state))return null;
      const role:WorkerClass=request.workflow.endsWith('image')?'image':'video';
      const selected=request.loras??[],available=selected.length?this.adapterSources(request):[];
      record.adapter_sources=selected.map(selection=>available.find(source=>source.id===selection.id&&source.revision===selection.revision)!);
      if(record.adapter_sources.some(source=>!source))throw Error('A selected LoRA source changed. Review the request before retrying.');
      record.adapters_ready=!record.adapter_sources.length;
      delete record.adapter_download;
      const attempt=randomUUID(),profile=executionProfile(request);
      this.db.prepare('INSERT INTO job_attempts VALUES (?,?,?,?,?)').run(attempt,job,record.id,'active',JSON.stringify({id:attempt,job_id:job,worker_id:record.id,executor:'local',role,profile,runtime_revision:record.runtime_revision,created_at:new Date(this.now()).toISOString()}));
      record.current_job_id=job;record.attempt_id=attempt;record.profile=profile;
      if(!this.runtime.alive)delete record.session_id;
      record.ready=this.runtime.alive&&!this.runtime.recovering&&record.adapters_ready;
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
    this.runtime.keepAwake(Boolean(record.current_job_id));
    if(record.issue?.code==='local_stop_pending'&&!this.runtime.alive)this.stopped();
    if(this.get()?.issue)return;
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
        if(!this.runtime.alive||this.runtime.recovering!==Boolean(record.interrupted)){
          // The engine served this assignment and then disappeared: its output
          // can only be recovered, never regenerated without being asked.
          if(record.session_id&&!record.interrupted&&!this.runtime.alive)updateAssignment(value=>{value.interrupted=true;value.state='recovering';});
          const current=this.get()!;
          await this.runtime.start(Boolean(current.interrupted));
          if(!stillAssigned())return;
          this.preparingSince=this.now();
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
        if(status.state!=='preparing')this.preparingSince=undefined;
        else this.preparingSince??=this.now();
        if(status.state==='preparing'&&!this.get()?.interrupted&&this.now()-this.preparingSince!>180000){
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
          const phase=status.active_prompt_id===value.attempt_id?enginePhase(status.execution_activity):undefined;
          value.current_activity=workerPhaseLabel(phase);
          if(phase)value.current_phase=phase;else delete value.current_phase;
          if(value.ready)value.ready_at??=new Date(this.now()).toISOString();
        });
      }else if(record.state==='ready'&&!this.runtime.alive||this.runtime.alive&&(!record.enabled||record.paused||(record.idle_deadline&&Date.parse(record.idle_deadline)<=this.now())))await this.sleep();
    })().catch(error=>{updateAssignment(value=>{value.ready=false;value.state='needs_attention';if(value.issue?.code!=='local_stop_pending')value.issue={code:'local_runtime_failed',message:error instanceof Error?error.message:'Local worker failed.',retryable:true};});}).finally(()=>{if(this.changing===task)this.changing=undefined;});
    this.changing=task;await task;
  }
  saving(job:string){this.update(record=>{if(record.current_job_id===job)record.state='saving';});}
  replay(job:string,persist:(attempt:string)=>void){
    const record=this.get();
    if(!record||record.current_job_id!==job||!record.interrupted||!record.attempt_id||!this.runtime.recovering)throw Error('The prior local executor has not stopped.');
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
      delete record.adapter_sources;delete record.adapters_ready;delete record.adapter_download;delete record.current_activity;delete record.current_phase;
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
    this.requireStopped(await this.runtime.stop());
    this.update(value=>{delete value.issue;value.ready=false;value.interrupted=Boolean(value.current_job_id);value.state=this.restingState(value);});
    await this.tick();return this.get();
  }
  async cancelNow(cancel:(id:string)=>void){
    const record=this.get();if(!record)return;
    this.update(value=>{value.paused=true;value.quit_mode='now';value.state='releasing';});
    await this.runtime.cancelPreparation();
    this.requireStopped(await this.runtime.stop());await this.changing;
    this.requireStopped(await this.runtime.stop());
    cancel(record.id);
    this.update(value=>{value.ready=false;value.state='disabled';delete value.session_id;delete value.issue;});
    return this.get();
  }
  async unload(){
    if(this.changing)throw Error('Wait for the local worker operation to finish.');
    await this.sleep();return this.get();
  }
  async sleep(){
    if(this.get()?.current_job_id)throw Error('The GPU is reserved until its output is saved and acknowledged.');
    this.update(record=>{record.ready=false;record.state='releasing';});
    this.requireStopped(await this.runtime.stop());
    this.update(record=>{record.ready=false;record.state=this.restingState(record);delete record.session_id;delete record.idle_deadline;});
  }
  async close(){
    this.closing=true;clearInterval(this.timer);
    await this.runtime.close();
    this.stopped();
  }
}
