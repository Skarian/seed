import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {LocalWorker} from '../server/local-worker.js';
import type {ImageRequest} from '../server/workflows.js';
import {fakePool} from './fake-pool.js';
import {Jobs} from '../server/jobs.js';
import {bindExecutor} from '../server/executors.js';
import {Loras} from '../server/loras.js';

function catalog(paths:any,letters:string[]){
  writeFileSync(path.join(paths.config,'loras.json'),JSON.stringify(letters.map(letter=>({id:letter,name:`LoRA ${letter}`,revision:letter.repeat(64),route:'image',format:'lora',compatibility:'untested',
    source:{provider:'civitai',model_id:1,version_id:2,file_id:3,url:'https://civitai.com/api/download/models/2',sha256:letter.repeat(64),size_bytes:100}}))));
  return new Loras(paths).manifestSources('image').map(source=>({id:source.id,revision:source.revision,scale:.8}));
}

async function fixture(run:(context:any)=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/local-worker-'));
  const paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data);
  let now=Date.now(),alive=false;
  const connection={status:vi.fn(async()=>({state:'ready',engine_session_id:'engine',worker_class:'all'})),json:vi.fn(async()=>({ready:true,engine_session_id:'engine'}))};
  const runtime={
    installation:vi.fn(async()=>({revision:'seed-engine-v2',gpu_uuid:'11111111-1111-1111-1111-111111111111',gpu:'NVIDIA GeForce RTX 5090',vram_bytes:32*1024**3})),
    start:vi.fn(async(recover=false)=>{alive=true;runtime.recovering=recover;return connection;}),stop:vi.fn(async()=>{alive=false;return {outcome:'stopped'};}),close:vi.fn(async()=>{alive=false;return {outcome:'stopped'};}),
    connection:()=>connection,get alive(){return alive;},recovering:false,workspace:path.join(paths.data,'local-workspace'),keepAwake:vi.fn(),
    prepareAdapters:vi.fn(async(sources:any[],progress:any)=>{progress({phase:'Downloading fixture LoRA',bytes_done:5,bytes_total:10});return sources.map(source=>({filename:`seed-${source.sha256}.safetensors`,sha256:source.sha256,routes:[source.route]}));}),
    cancelPreparation:vi.fn(async()=>{}),
  };
  const local=new LocalWorker(db,paths,{runtime:runtime as any,now:()=>now});
  const request:ImageRequest={workflow:'text-to-image',prompt:'fixture',mode:'sfw',output:{size:'image-768',aspect:'16:9'},seed:'1',count:1};
  const insert=()=>{const id=randomUUID(),date=new Date(now).toISOString();db.prepare('INSERT INTO jobs(id,workflow,state,snapshot_json,created_at,updated_at,submission_id,submission_index) VALUES (?,?,?,?,?,?,?,?)').run(id,'text-to-image','queued','{}',date,date,id,0);return id;};
  try{await run({db,paths,local,runtime,request,job:insert,crash:()=>alive=false,advance:(ms:number)=>now+=ms});}
  finally{await local.close();db.close();rmSync(root,{recursive:true,force:true});}
}
it('does not install, start, or reserve a device before explicit enablement',()=>fixture(async({local,runtime,request,job}:any)=>{
  expect(local.get()).toBeNull();expect(local.claim(job(),request)).toBeNull();await local.tick();
  expect(runtime.start).not.toHaveBeenCalled();expect(runtime.installation).not.toHaveBeenCalled();
}));
it('treats a job from a previous coordinator as interrupted without starting generation',()=>fixture(async({local,db,paths,runtime,request,job}:any)=>{
  await local.enable(true);const id=job();local.claim(id,request);
  const legacy=local.get();legacy.ownership={incarnation:'old'};legacy.stop={stop_id:'old'};legacy.issue={code:'local_ownership_unknown',message:'old',retryable:true};
  db.prepare('UPDATE pool_workers SET snapshot_json=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
  const restored=new LocalWorker(db,paths,{runtime});
  expect(restored.get()).toMatchObject({current_job_id:id,interrupted:true,state:'recovering'});expect(restored.get()?.issue).toBeUndefined();
  await restored.tick();expect(runtime.start).toHaveBeenLastCalledWith(true);
}));
it('keeps a stopping engine reserved until its exit is confirmed',()=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);
  const first=job();local.claim(first,request);await local.tick();local.complete(first);
  runtime.stop.mockResolvedValueOnce({outcome:'stop_pending'});
  await expect(local.sleep()).rejects.toThrow('stopping');
  expect(local.get().issue.code).toBe('local_stop_pending');
  expect(local.claim(job(),request)).toBeNull();
  await expect(local.enable(true)).rejects.toThrow('shutdown');
  await local.tick();expect(local.get().issue.code).toBe('local_stop_pending');
  await runtime.stop();await local.tick();
  expect(local.get().issue).toBeUndefined();expect(local.get().state).toBe('sleeping');
}));
it('unloads through the normal stop only while no job runs',()=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);const id=job();local.claim(id,request);await local.tick();
  await expect(local.unload()).rejects.toThrow('reserved');expect(runtime.stop).not.toHaveBeenCalled();
  local.complete(id);expect(local.get().state).toBe('ready');
  await local.unload();
  expect(runtime.stop).toHaveBeenCalledOnce();expect(local.get()).toMatchObject({state:'sleeping',ready:false});expect(local.get().idle_deadline).toBeUndefined();
}));
it('keeps Windows awake only while a job is assigned',()=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);await local.tick();expect(runtime.keepAwake).toHaveBeenLastCalledWith(false);
  const id=job();local.claim(id,request);await local.tick();expect(runtime.keepAwake).toHaveBeenLastCalledWith(true);
  local.complete(id);await local.tick();expect(runtime.keepAwake).toHaveBeenLastCalledWith(false);
}));
it('runs every video setting on a GPU with a hardware profile',()=>fixture(async({local,request,job}:any)=>{
  await local.enable(true);
  const video={...request,workflow:'text-to-video',output:{size:'768p',aspect:'16:9',duration_seconds:15}};
  for(const steps of [10,15,20,30])for(const detail of ['standard','full'])expect(local.supports({...video,steps,detail})).toBe(true);
  expect(local.claim(job(),{...video,steps:15,detail:'full'})?.profile).toBe('h3-full-15');
}));
it('runs video LoRAs for their own route and never for image editing',()=>fixture(async({local,paths,request,job}:any)=>{
  await local.enable(true);
  const source=(id:string,route:string,sha:string)=>({id,name:id,revision:sha,route,format:'lora',compatibility:'untested',
    source:{provider:'civitai',model_id:1,version_id:2,file_id:3,url:'https://civitai.com/api/download/models/2',sha256:sha,size_bytes:100}});
  const fl=source('fl','fl','a'.repeat(64)),ref=source('ref','ref','b'.repeat(64));
  writeFileSync(path.join(paths.config,'loras.json'),JSON.stringify([fl,ref]));
  const select=(entry:any)=>[{id:entry.id,revision:entry.revision,scale:.8}];
  const video={...request,workflow:'text-to-video',output:{size:'768p',aspect:'16:9',duration_seconds:5}};
  const reference={...video,workflow:'reference-to-video',references:[{id:'r',asset_id:'asset',kind:'image',role:'reference'}]};
  expect(local.supports({...video,loras:select(fl)})).toBe(true);
  expect(local.supports({...reference,loras:select(ref)})).toBe(true);
  expect(local.supports({...video,loras:select(ref)})).toBe(false);
  expect(local.supports({...reference,loras:select(fl)})).toBe(false);
  expect(local.supports({...request,workflow:'image-to-image',output:{size:'image-768',aspect:'source'},loras:select(fl)})).toBe(false);
  const claimed=local.claim(job(),{...video,loras:select(fl)});
  expect(claimed?.state).toBe('preparing');expect(claimed?.worker_class).toBe('video');
  expect(claimed?.adapter_sources.map((item:any)=>item.route)).toEqual(['fl']);
}));
it('offers images only on a GPU without a hardware profile and refreshes saved capabilities',()=>fixture(async({db,paths,runtime,request,job}:any)=>{
  runtime.installation.mockResolvedValue({revision:'seed-engine-v2',gpu_uuid:'11111111-1111-1111-1111-111111111111',gpu:'NVIDIA Fixture GPU',vram_bytes:48*1024**3});
  const local=new LocalWorker(db,paths,{runtime});
  await local.enable(true);
  expect(local.get()?.workflows).toEqual(['text-to-image','image-to-image']);
  for(const size of ['image-480','image-768','2mp','image-1440','0.5mp','1mp'])
    for(const aspect of ['16:9','9:16'])expect(local.supports({...request,output:{size,aspect}})).toBe(true);
  expect(local.supports({...request,workflow:'image-to-image',output:{size:'image-768',aspect:'source'},references:[{id:'source',asset_id:'asset',kind:'image',role:'source'}]})).toBe(true);
  for(const workflow of ['text-to-video','reference-to-video'])
    expect(local.supports({...request,workflow,output:{size:'480p',aspect:'16:9',duration_seconds:5}})).toBe(false);
  expect(local.claim(job(),request)?.profile).toBe('krea-turbo-int8-v1');
  const record=local.get()!;record.workflows=[];
  db.prepare('UPDATE pool_workers SET snapshot_json=? WHERE id=?').run(JSON.stringify(record),record.id);
  const restored=new LocalWorker(db,paths,{runtime});
  expect(restored.get()?.workflows).toEqual(['text-to-image','image-to-image']);
}));
it('routes Auto to existing rentals first, uses local capacity when busy, and respects overrides',()=>fixture(async({local,db,paths,request,job}:any)=>{
  const cloud=fakePool(db,paths);cloud.pool.local=local;
  try{
    await local.enable(true);const [rental]=await cloud.ready();
    expect(cloud.pool.claimExecutor(job(),request,[],new Date().toISOString())?.id).toBe(rental!.id);
    const second=job();expect(cloud.pool.claimExecutor(second,request,[],new Date().toISOString())?.id).toBe(local.get().id);
    local.complete(second);expect(cloud.pool.claimExecutor(job(),{...request,target:'cloud'},[],new Date().toISOString())).toBeNull();
    expect(cloud.pool.claimExecutor(job(),{...request,target:'local'},[],new Date().toISOString())?.id).toBe(local.get().id);
    expect(cloud.providers.vast.create).toHaveBeenCalledOnce();expect(cloud.providers.runpod.create).not.toHaveBeenCalled();
  }finally{await cloud.pool.close();}
}));

async function jobsFixture(run:(context:any)=>Promise<void>){return fixture(async context=>{
  const {db,paths,local,runtime}=context,cloud=fakePool(db,paths);cloud.pool.local=local;
  vi.spyOn(cloud.pool,'executionDriver').mockImplementation(worker=>bindExecutor(cloud.worker as any,worker));
  const jobs=new Jobs(db,paths,cloud.pool);
  const settle=async()=>{for(let i=0;i<8;i++){await local.tick();await jobs.reconcile();}};
  try{await local.enable(true);await run({...context,...cloud,jobs,settle});}
  finally{await jobs.close();await jobs.media.close();await cloud.pool.close();}
});}
it('downloads selected LoRAs added after enablement, including additions while the image engine is warm',()=>jobsFixture(async f=>{
  const loras=catalog(f.paths,['a']);
  const {jobs:[first]}=await f.jobs.submit({...f.request,target:'local',loras},'new-local-lora-first');await f.settle();
  expect(f.jobs.get(first.id).state).toBe('completed');
  expect(f.worker.submit.mock.calls[0][1].loras).toMatchObject([{filename:`seed-${'a'.repeat(64)}.safetensors`,strength_model:.8}]);
  const all=catalog(f.paths,['a','b','c']);
  const {jobs:[second]}=await f.jobs.submit({...f.request,target:'local',loras:all},'three-local-loras');await f.settle();
  expect(f.jobs.get(second.id).state).toBe('completed');expect(f.runtime.prepareAdapters).toHaveBeenCalledTimes(2);
  expect(f.runtime.prepareAdapters.mock.calls[1][0]).toHaveLength(3);expect(f.runtime.start).toHaveBeenCalledOnce();
  expect(f.local.get().installed_loras).toHaveLength(3);
}));
it('keeps failed LoRA downloads retryable without submitting or replacing the image attempt',()=>jobsFixture(async f=>{
  const loras=catalog(f.paths,['a']);f.runtime.prepareAdapters.mockRejectedValueOnce(Error('HTTP 401: check the Civitai key'));
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local',loras},'retry-local-lora');await f.settle();
  const attempt=f.jobs.get(job.id).worker.execution_id;
  expect(f.jobs.get(job.id)).toMatchObject({state:'needs_attention',error:expect.stringContaining('401')});
  expect(f.runtime.start).not.toHaveBeenCalled();expect(f.worker.submit).not.toHaveBeenCalled();
  await f.local.recover();await f.settle();
  expect(f.jobs.get(job.id)).toMatchObject({state:'completed',worker:{execution_id:attempt}});
  expect(f.worker.submit).toHaveBeenCalledOnce();
}));
it.each(['auto','local'])('explains local LoRA preparation for queued %s requests',target=>jobsFixture(async f=>{
  const loras=catalog(f.paths,['a']);
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  await f.jobs.submit({...f.request,target:'local',loras},'local-lora-occupies-worker');await f.settle();
  const {jobs:[queued]}=await f.jobs.submit({...f.request,target,loras},'local-lora-waits');await f.jobs.reconcile();
  expect(f.jobs.get(queued.id)).toMatchObject({state:'queued',waiting_reason:expect.stringContaining('Missing LoRAs download automatically')});
  expect(f.jobs.get(queued.id).waiting_reason).not.toContain('Start a new worker');
  await f.local.pause();await f.jobs.reconcile();
  expect(f.jobs.get(queued.id).waiting_reason).toBe('Resume This PC in Workers to run this request.');
}));
it('cancels an active LoRA download before releasing its reservation and never starts the engine',()=>jobsFixture(async f=>{
  const loras=catalog(f.paths,['a']);let rejectDownload!:(error:Error)=>void;
  f.runtime.prepareAdapters.mockImplementation(()=>new Promise((_resolve,reject)=>{rejectDownload=reject;}));
  f.runtime.cancelPreparation.mockImplementation(async()=>{rejectDownload?.(Error('cancelled'));});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local',loras},'cancel-local-lora');await f.jobs.reconcile();
  const downloading=f.local.tick();await vi.waitFor(()=>expect(rejectDownload).toBeTypeOf('function'));
  f.jobs.stopJobs([job.id]);await f.jobs.reconcile();await downloading;
  expect(f.jobs.get(job.id).state).toBe('cancelled');expect(f.local.get().current_job_id).toBeUndefined();
  expect(f.runtime.start).not.toHaveBeenCalled();expect(f.worker.submit).not.toHaveBeenCalled();
}));
it('never force-stops: cancellation keeps the job until the engine confirms its exit',()=>fixture(async f=>{
  await f.local.enable(true);const id=f.job();f.local.claim(id,f.request);await f.local.tick();
  f.runtime.stop.mockResolvedValueOnce({outcome:'stop_pending'});
  const cancel=vi.fn(()=>f.local.complete(id));
  await expect(f.local.cancelNow(cancel)).rejects.toThrow('stopping');
  expect(f.local.get()).toMatchObject({current_job_id:id,state:'needs_attention',issue:{code:'local_stop_pending'}});
  expect(cancel).not.toHaveBeenCalled();
  await f.local.cancelNow(cancel);
  expect(cancel).toHaveBeenCalledOnce();
  expect(f.local.get()).toMatchObject({paused:true,state:'disabled'});expect(f.local.get().current_job_id).toBeUndefined();
}));
it('recovers completed local output after engine death before considering replay',()=>jobsFixture(async f=>{
  const submit=f.worker.submit.getMockImplementation();f.worker.submit.mockImplementationOnce(async(...args:any[])=>{await submit(...args);throw Error('lost response');});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local'},'local-completed-recovery');
  await f.jobs.reconcile();await f.local.tick();await f.jobs.reconcile();f.crash();await f.settle();
  expect(f.jobs.get(job.id)).toMatchObject({state:'completed',worker:{executor:'local'}});expect(f.worker.submit).toHaveBeenCalledOnce();expect(f.worker.acknowledge).toHaveBeenCalledOnce();
  expect(f.local.get().current_job_id).toBeUndefined();expect(f.runtime.start.mock.calls.some((call:any[])=>call[0]===true)).toBe(true);
}));
it('requires an explicit retry after every interrupted local attempt and preserves its seed',()=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local'},'local-interrupted-replay');await f.settle();
  const first=f.jobs.get(job.id).worker.execution_id;f.crash();await f.settle();
  expect(f.worker.submit).toHaveBeenCalledOnce();
  expect(f.jobs.publicJob(f.jobs.get(job.id))).toMatchObject({state:'needs_attention',recovery:{action:'retry_local'}});
  f.jobs.recover(job.id);await f.settle();
  const retried=f.jobs.get(job.id);expect(retried.seed).toBe(job.seed);expect(retried.worker.execution_id).not.toBe(first);expect(retried.worker.local_retry_count).toBe(1);
  expect(f.worker.submit).toHaveBeenCalledTimes(2);expect(f.worker.submit.mock.calls.map((call:any[])=>call[1].prompt_id)).toEqual([first,retried.worker.execution_id]);
  f.crash();await f.settle();expect(f.jobs.get(job.id).state).toBe('needs_attention');expect(f.worker.submit).toHaveBeenCalledTimes(2);
}));
it.each([
  ['local_adapter_failed','local_preparation_failed'],
  ['local_stop_pending','local_stop_pending'],
])('describes %s without claiming the engine was interrupted',(code,reason)=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local'},'local-issue-'+code);await f.settle();
  const record=f.local.get();record.issue={code,message:'Synthetic fixture',retryable:true};
  f.db.prepare('UPDATE pool_workers SET snapshot_json=? WHERE id=?').run(JSON.stringify(record),record.id);
  const publicJob=f.jobs.publicJob({...f.jobs.get(job.id),state:'needs_attention'});
  expect(publicJob.recovery).toMatchObject({reason});expect(publicJob.recovery.action).toBeUndefined();
}));
it('does not replay a cancelled or deterministically failed local attempt',()=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[cancelled]}=await f.jobs.submit({...f.request,target:'local'},'local-cancelled-replay');await f.settle();f.jobs.stopJobs([cancelled.id]);f.crash();await f.settle();
  expect(f.jobs.get(cancelled.id).state).toBe('cancelled');expect(f.worker.submit).toHaveBeenCalledOnce();
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'},manifest:{state:'failed',outputs:[],error:'CUDA out of memory'},manifest_digest:'failed'});throw Error('lost response');});
  const {jobs:[failed]}=await f.jobs.submit({...f.request,target:'local'},'local-oom-no-replay');await f.jobs.reconcile();await f.local.tick();await f.jobs.reconcile();f.crash();await f.settle();
  expect(f.jobs.get(failed.id).state).toBe('failed');expect(f.worker.submit).toHaveBeenCalledTimes(2);
}));
it.each([false,true])('preserves a non-user cancelled attempt and handles orphan output: %s',orphan=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local'},'unrequested-cancel-'+orphan);await f.settle();
  const attempt=f.jobs.get(job.id).worker.execution_id;
  f.receipts.set(attempt,{submission:{engine_session_id:'engine'},manifest:{state:'cancelled',outputs:[],error:null},manifest_digest:'cancelled'});
  const directory=path.join(f.runtime.workspace,'.seed/spool/outputs/seed',attempt);
  if(orphan){mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'output.png'),'retained synthetic output');}
  f.crash();await f.settle();
  expect(f.jobs.publicJob(f.jobs.get(job.id))).toMatchObject({state:'needs_attention',recovery:{action:'retry_local'}});
  expect(f.worker.acknowledge).not.toHaveBeenCalled();expect(f.worker.submit).toHaveBeenCalledOnce();
  f.jobs.recover(job.id);await f.settle();
  expect(f.worker.acknowledge).not.toHaveBeenCalled();
  expect(f.worker.submit).toHaveBeenCalledTimes(orphan?1:2);
  if(orphan){expect(readFileSync(path.join(directory,'output.png'),'utf8')).toBe('retained synthetic output');expect(f.jobs.get(job.id).worker.execution_id).toBe(attempt);}
  else expect(f.jobs.get(job.id).worker.execution_id).not.toBe(attempt);
  expect(f.receipts.has(attempt)).toBe(true);
}));
it('preserves an orphan output and refuses replay when its terminal receipt is missing',()=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local'},'local-orphan-output');await f.settle();
  const attempt=f.jobs.get(job.id).worker.execution_id,directory=path.join(f.runtime.workspace,'.seed/spool/outputs/seed',attempt);mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'output.png'),'unacknowledged');
  f.crash();await f.settle();expect(f.worker.submit).toHaveBeenCalledOnce();expect(f.local.get().current_job_id).toBe(job.id);
  f.jobs.recover(job.id);await f.settle();
  expect(f.worker.submit).toHaveBeenCalledOnce();expect(f.jobs.get(job.id).worker.execution_id).toBe(attempt);
  expect(f.jobs.get(job.id).state).toBe('needs_attention');
  expect(f.local.get().current_job_id).toBe(job.id);
  expect(readFileSync(path.join(directory,'output.png'),'utf8')).toBe('unacknowledged');
}));
it.each(['cancel','not_recovery_only','receipt_error'])('does not replay when explicit retry preconditions change: %s',mode=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local'},'local-retry-race-'+mode);await f.settle();
  const attempt=f.jobs.get(job.id).worker.execution_id;f.crash();await f.settle();
  if(mode==='not_recovery_only'){
    f.runtime.recovering=false;
    expect(()=>f.jobs.recover(job.id)).toThrow();
  }else{
    let finish:(value:any)=>void=()=>{};
    const receipt=new Promise(resolve=>finish=resolve);
    f.worker.receipt.mockImplementationOnce(()=>mode==='receipt_error'?Promise.reject(Error('Synthetic receipt failure')):receipt);
    f.jobs.recover(job.id);
    if(mode==='cancel'){f.jobs.stopJobs([job.id]);finish({submission:{engine_session_id:'engine'}});}
    await f.settle();
  }
  expect(f.jobs.get(job.id).worker.execution_id).toBe(attempt);
  expect(f.worker.submit).toHaveBeenCalledOnce();
}));
it('recovers a terminal receipt found during explicit local retry without generating again',()=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[job]}=await f.jobs.submit({...f.request,target:'local'},'local-late-terminal');await f.settle();
  const attempt=f.jobs.get(job.id).worker.execution_id;f.crash();await f.settle();
  f.receipts.set(attempt,{submission:{engine_session_id:'engine'},manifest:{state:'failed',outputs:[],error:'Synthetic fixture failure'},manifest_digest:'failed'});
  f.jobs.recover(job.id);await f.settle();
  expect(f.jobs.get(job.id).state).toBe('failed');expect(f.worker.submit).toHaveBeenCalledOnce();
  expect(f.jobs.get(job.id).worker.execution_id).toBe(attempt);
}));
it('schedules an older video before a newer image',()=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[first]}=await f.jobs.submit({...f.request,target:'local'},'local-fifo-first-image');await f.settle();
  const {jobs:[video]}=await f.jobs.submit({...f.request,target:'local',workflow:'text-to-video',audio:{output:'generated'},output:{size:'480p',aspect:'16:9',duration_seconds:5}},'local-fifo-older-video');
  await f.jobs.submit({...f.request,target:'local'},'local-fifo-newer-image');
  f.jobs.stopJobs([first.id]);await f.settle();expect(f.local.get()).toMatchObject({current_job_id:video.id,worker_class:'video'});
}));
it('cloud-wide quit preserves the running local reservation and local-only queue',()=>jobsFixture(async f=>{
  f.worker.submit.mockImplementation(async(_worker:any,body:any)=>{f.receipts.set(body.prompt_id,{submission:{engine_session_id:'engine'}});});
  const {jobs:[running]}=await f.jobs.submit(f.request,'local-survives-cloud-quit');await f.settle();
  const {jobs:[queued]}=await f.jobs.submit({...f.request,target:'local'},'local-queue-survives-quit');
  const {jobs:[cloud]}=await f.jobs.submit({...f.request,target:'cloud'},'cloud-queue-quit');
  await f.ready();await f.pool.actionAll('quit');
  expect(f.jobs.get(running.id).state).toBe('running');expect(f.local.get().current_job_id).toBe(running.id);expect(f.runtime.alive).toBe(true);
  expect(f.jobs.get(queued.id).state).toBe('queued');expect(f.jobs.get(cloud.id).state).toBe('cancelled');
}));
it('reserves the physical device before startup and holds it through saving',()=>fixture(async({local,runtime,request,job,advance,db}:any)=>{
  await local.enable(true);const first=job(),second=job();
  const reserved=local.claim(first,request);expect(reserved.state).toBe('starting');expect(runtime.start).not.toHaveBeenCalled();
  expect(local.claim(second,request)).toBeNull();await local.tick();local.saving(first);advance(300000);await local.tick();
  expect(runtime.stop).not.toHaveBeenCalled();expect(db.prepare("SELECT COUNT(*) n FROM job_attempts WHERE state='active'").get().n).toBe(1);
  local.complete(first);advance(20*60_000-1);await local.tick();expect(runtime.stop).not.toHaveBeenCalled();
  advance(1);await local.tick();expect(runtime.stop).toHaveBeenCalledOnce();expect(local.get().state).toBe('sleeping');
  expect(local.claim(second,request).id).toBe(reserved.id);
}));
it.each(['status','capabilities'])('ignores a late %s response after the output releases its reservation',stage=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);const first=job(),second=job();local.claim(first,request);await local.tick();
  let release!:(value:unknown)=>void;
  const pending=new Promise(resolve=>{release=resolve;});
  const connection=runtime.connection();
  if(stage==='status')connection.status.mockReturnValueOnce(pending);
  else connection.json.mockReturnValueOnce(pending);
  const polling=local.tick();
  await vi.waitFor(()=>expect(stage==='status'?connection.status:connection.json).toHaveBeenCalledTimes(2));
  local.saving(first);local.complete(first);
  const deadline=local.get().idle_deadline;
  release(stage==='status'?{state:'busy',active_prompt_id:'old-attempt',engine_session_id:'engine',execution_activity:{phase:'editing',percent:99}}:{ready:true,engine_session_id:'engine'});
  await polling;
  expect(local.get()).toMatchObject({state:'ready',ready:true,idle_deadline:deadline});
  expect(local.get().current_job_id).toBeUndefined();expect(local.get().current_activity).toBeUndefined();
  expect(local.claim(second,request)?.current_job_id).toBe(second);
}));
it('ignores a late status error after the output has already completed',()=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);const first=job();local.claim(first,request);await local.tick();
  let reject!:(error:Error)=>void;
  runtime.connection().status.mockReturnValueOnce(new Promise((_resolve,rejectPromise)=>{reject=rejectPromise;}));
  const polling=local.tick();local.complete(first);reject(Error('old request failed'));await polling;
  expect(local.get()).toMatchObject({state:'ready',ready:true});expect(local.get().issue).toBeUndefined();
}));
it('serves image and video from one engine without a restart',()=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);const first=job(),second=job();local.claim(first,request);await local.tick();
  const video={...request,workflow:'text-to-video',output:{size:'480p',aspect:'16:9',duration_seconds:5}};
  expect(local.claim(second,video)).toBeNull();local.complete(first);expect(local.claim(second,video).state).toBe('generating');await local.tick();
  expect(runtime.start).toHaveBeenCalledOnce();expect(runtime.stop).not.toHaveBeenCalled();
}));
it('pauses after the current output',()=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);
  const first=job();local.claim(first,request);await local.tick();await local.pause();expect(runtime.stop).not.toHaveBeenCalled();
  local.complete(first);await local.tick();expect(local.get().state).toBe('disabled');expect(local.claim(job(),request)).toBeNull();
}));
it('keeps local device rows out of rental recovery and billing',()=>fixture(async({local,db,paths}:any)=>{
  await local.enable(true);const cloud=fakePool(db,paths);try{
    expect(cloud.pool.all()).toEqual([]);expect(cloud.pool.get(local.get().id)).toBeNull();await cloud.pool.tick();
    expect(cloud.providers.vast.find).not.toHaveBeenCalled();expect(cloud.providers.runpod.find).not.toHaveBeenCalled();expect(cloud.pool.snapshot().summary.hourly).toBe(0);
  }finally{await cloud.pool.close();}
}));
it('keeps the assignment during brief gateway loss and requires recovery after prolonged loss',()=>fixture(async({local,runtime,request,job,advance}:any)=>{
  await local.enable(true);const id=job();local.claim(id,request);await local.tick();
  runtime.connection().status.mockResolvedValue(null);await local.tick();advance(29000);await local.tick();
  expect(local.get().issue).toBeUndefined();expect(local.get().current_job_id).toBe(id);
  advance(1000);await local.tick();expect(local.get().state).toBe('needs_attention');
  expect(local.get().current_job_id).toBe(id);expect(runtime.stop).not.toHaveBeenCalled();
}));
it('times only continuous preparation, so a ready engine survives a brief preparing status',()=>fixture(async({local,runtime,request,job,advance}:any)=>{
  await local.enable(true);const id=job();local.claim(id,request);await local.tick();
  advance(1200000);await local.tick();
  runtime.connection().status.mockResolvedValue({state:'preparing',engine_session_id:null});await local.tick();
  expect(runtime.stop).not.toHaveBeenCalled();expect(local.get().current_job_id).toBe(id);
  advance(179000);await local.tick();expect(runtime.stop).not.toHaveBeenCalled();
  advance(2000);await local.tick();expect(runtime.stop).toHaveBeenCalledOnce();
}));
it('stops an engine that never becomes ready while preserving its assignment for recovery',()=>fixture(async({local,runtime,request,job,advance}:any)=>{
  runtime.connection().status.mockResolvedValue({state:'preparing',engine_session_id:null});
  await local.enable(true);const id=job();local.claim(id,request);await local.tick();advance(180001);await local.tick();
  expect(runtime.stop).toHaveBeenCalledOnce();expect(local.get()).toMatchObject({state:'needs_attention',current_job_id:id,ready:false});
}));

it('shows the engine phase of its own attempt only',()=>fixture(async({local,runtime,request,job}:any)=>{
  await local.enable(true);const id=job();local.claim(id,request);const attempt=local.get().attempt_id;
  const status=runtime.connection().status;
  status.mockResolvedValue({state:'busy',active_prompt_id:attempt,engine_session_id:'engine',execution_activity:{phase:'generating',percent:42}});
  await local.tick();
  expect(local.get()).toMatchObject({current_phase:{phase:'generating',percent:42},current_activity:'Generating · 42%'});
  status.mockResolvedValue({state:'busy',active_prompt_id:attempt,engine_session_id:'engine',execution_activity:{phase:'finishing'}});
  await local.tick();
  expect(local.get()).toMatchObject({current_phase:{phase:'finishing'},current_activity:'Finishing'});
  status.mockResolvedValue({state:'busy',active_prompt_id:'another-attempt',engine_session_id:'engine',execution_activity:{phase:'generating',percent:99}});
  await local.tick();
  expect(local.get().current_phase).toBeUndefined();expect(local.get().current_activity).toBeUndefined();
}));
