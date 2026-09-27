import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {Jobs} from '../server/jobs.js';
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {fakePool} from './fake-pool.js';
import {WorkerHttpError} from '../server/worker-transfer.js';
type JobsFixture=ReturnType<typeof fakePool>&{jobs:Jobs;db:ReturnType<typeof openDatabase>;paths:ReturnType<typeof resolvePaths>;request:any;settle:()=>Promise<void>};
async function fixture(run:(f:JobsFixture)=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/pool-jobs-')),paths=resolvePaths(root);prepareStorage(paths);
  const db=openDatabase(paths.data),fake=fakePool(db,paths),jobs=new Jobs(db,paths,fake.pool);
  const request={workflow:'text-to-image',prompt:'A forest',mode:'sfw',output:{aspect:'16:9',size:'1mp'},seed:'42',count:1};
  const settle=async()=>{for(let i=0;i<8;i++){await jobs.reconcile();await new Promise(resolve=>setTimeout(resolve,2));}};
  try{await run({...fake,jobs,db,paths,request,settle});}finally{await jobs.close();await fake.pool.close();await jobs.media.close();db.close();rmSync(root,{recursive:true,force:true});}
}
it('accepts requests without workers or generation-price approval and waits without acquiring resources',async()=>fixture(async f=>{
  const {jobs:[job]}=await f.jobs.submit(f.request,'waiting-request-fixture');await f.settle();
  expect(f.jobs.get(job!.id)!.state).toBe('queued');expect(f.worker.submit).not.toHaveBeenCalled();expect(f.providers.vast.create).not.toHaveBeenCalled();expect(f.providers.runpod.create).not.toHaveBeenCalled();
}));
it('saves validated output locally and idempotently deduplicates user submissions',async()=>fixture(async f=>{
  await f.ready();const first=await f.jobs.submit(f.request,'dedup-request-fixture');await f.settle();
  const completed=f.jobs.get(first.jobs[0]!.id)!;expect(completed.state).toBe('completed');expect(completed.outputs).toHaveLength(1);expect(f.jobs.media.get(completed.outputs[0]!)).toBeTruthy();expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);
  expect((await f.jobs.submit(f.request,'dedup-request-fixture')).submission_id).toBe(first.submission_id);await f.settle();expect(f.worker.submit).toHaveBeenCalledTimes(1);
  await expect(f.jobs.submit({...f.request,prompt:'Other'},'dedup-request-fixture')).rejects.toThrow('different settings');
}));
it('fans quantity four across available compatible workers with stable distinct seeds',async()=>fixture(async f=>{
  await f.ready('image',4);const batch=await f.jobs.submit({...f.request,count:4},'fanout-request-fixture');await f.jobs.reconcile(true);await f.settle();
  expect(batch.jobs.map(job=>job.seed)).toEqual(['42','43','44','45']);expect(f.worker.submit).toHaveBeenCalledTimes(4);expect(new Set(f.worker.submit.mock.calls.map(([worker])=>worker.id)).size).toBe(4);expect(f.jobs.all().every(job=>job.state==='completed')).toBe(true);
}));
it('never assigns image work to a video worker and runs quantities sequentially on one image worker',async()=>fixture(async f=>{
  await f.ready('video');await f.jobs.submit({...f.request,count:3},'class-request-fixture');await f.jobs.reconcile();expect(f.worker.submit).not.toHaveBeenCalled();
  await f.ready('image');await f.settle();expect(f.worker.submit).toHaveBeenCalledTimes(3);expect(f.worker.submit.mock.calls.every(([worker])=>worker.worker_class==='image')).toBe(true);expect(new Set(f.worker.submit.mock.calls.map(([worker])=>worker.id)).size).toBe(1);
}));
it('keeps an ambiguous submission on its worker without blind replay or blocking other workers',async()=>fixture(async f=>{
  await f.ready('image',2);const original=f.worker.submit.getMockImplementation()!;let first=true;
  f.worker.submit.mockImplementation(async(...args)=>{if(first){first=false;throw Error('response lost');}return original(...args);});
  const batch=await f.jobs.submit({...f.request,count:2},'ambiguous-request-fixture');await f.settle();
  expect(f.worker.submit).toHaveBeenCalledTimes(2);expect(f.jobs.get(batch.jobs[1]!.id)!.state).toBe('completed');expect(f.jobs.get(batch.jobs[0]!.id)!.state).not.toBe('completed');
}));
it('retries local saving without generating a second output',async()=>fixture(async f=>{
  await f.ready();f.worker.download.mockRejectedValueOnce(Object.assign(Error('disk full'),{code:'ENOSPC'}));const {jobs:[job]}=await f.jobs.submit(f.request,'save-retry-fixture');await f.settle();
  expect(f.jobs.get(job!.id)!.recovery_blocked).toBe(true);expect(f.worker.acknowledge).not.toHaveBeenCalled();
  f.jobs.retrySave(job!.id);await f.settle();expect(f.jobs.get(job!.id)!.state).toBe('completed');expect(f.worker.submit).toHaveBeenCalledTimes(1);expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);
}));
it('cancels unsent work without contacting the worker or changing other requests',async()=>fixture(async f=>{
  const first=await f.jobs.submit(f.request,'cancel-first-fixture'),second=await f.jobs.submit(f.request,'cancel-second-fixture');
  f.jobs.stopJobs([first.jobs[0]!.id]);expect(f.jobs.get(first.jobs[0]!.id)!.state).toBe('cancelled');expect(f.jobs.get(second.jobs[0]!.id)!.state).toBe('queued');expect(f.worker.cancel).not.toHaveBeenCalled();
}));
it('rejects hidden adapters at admission and waits for the exact installed LoRA revision',async()=>fixture(async f=>{
  const sha='a'.repeat(64);f.jobs.loras.applySources('private-group',[{name:'adapter.safetensors',route:'image',source:{provider:'civitai',model_id:5,version_id:10,file_id:20,url:'https://civitai.com/api/download/models/10',sha256:sha,size_bytes:1000}}],{name:'Private',description:'Style',default_scale:1,trigger_words:[],availability:'spicy',enabled:true});
  const entry=f.jobs.loras.all()[0]!,request={...f.request,loras:[{id:entry.id,revision:entry.revision,scale:1}]};await expect(f.jobs.submit(request,'private-rejected-fixture')).rejects.toThrow('unavailable');
  f.jobs.loras.setAvailability(entry.id,'all');await f.ready();
  const {jobs:[job]}=await f.jobs.submit(request,'installed-adapter-fixture');await f.settle();expect(f.jobs.get(job!.id)!.state).toBe('completed');expect(f.worker.upload).not.toHaveBeenCalled();
}));
it('keeps unresolved historical fal jobs visible without replaying them on a worker',async()=>fixture(async f=>{
  const at=new Date().toISOString(),old={id:'historical-fal',state:'running',submission_id:'old-submission',submission_index:0,request:f.request,seed:'42',fal:{receipt:{request_id:'old-receipt'},loras:[]},outputs:[],error:null,created_at:at,updated_at:at};
  f.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)').run(old.id,'text-to-image','running',JSON.stringify(old),at,at,old.submission_id,0);
  const restarted=new Jobs(f.db,f.paths,f.pool);try{await f.ready();for(let i=0;i<3;i++)await restarted.reconcile();expect(restarted.get(old.id)).toBeTruthy();expect(f.worker.submit).not.toHaveBeenCalled();}finally{await restarted.close();}
}));

it('recovers an accepted submission after restart using its durable receipt without another POST',async()=>fixture(async f=>{
  await f.ready();const submit=f.worker.submit.getMockImplementation()!;f.worker.submit.mockImplementationOnce(async(...args)=>{await submit(...args);throw Error('response lost after worker accepted');});
  const {jobs:[job]}=await f.jobs.submit(f.request,'restart-receipt-fixture');await f.jobs.reconcile();expect(f.jobs.get(job!.id)!.submission_pending).toBe(true);await f.jobs.close();
  const restarted=new Jobs(f.db,f.paths,f.pool);try{for(let i=0;i<4;i++)await restarted.reconcile();expect(restarted.get(job!.id)!.state).toBe('completed');expect(f.worker.submit).toHaveBeenCalledTimes(1);expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);}finally{await restarted.close();await restarted.media.close();}
}));
it('cancels only its running request and acknowledges the terminal receipt before reusing the worker',async()=>fixture(async f=>{
  await f.ready();f.worker.submit.mockImplementation(async(_worker,body)=>{f.receipts.set(String(body.prompt_id),{submission:{graph_digest:'fixture'}});});
  const {jobs:[job]}=await f.jobs.submit(f.request,'running-cancel-fixture');await f.jobs.reconcile();expect(f.jobs.get(job!.id)!.state).toBe('running');
  f.jobs.stopJobs([job!.id]);await f.settle();expect(f.jobs.get(job!.id)!.state).toBe('cancelled');expect(f.worker.cancel).toHaveBeenCalledTimes(1);expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);expect(f.pool.all()[0]!.current_job_id).toBeUndefined();
}));
it('executes image and video work concurrently in separate worker classes',async()=>fixture(async f=>{
  await f.ready('image');await f.ready('video');const submit=f.worker.submit.getMockImplementation()!;
  f.worker.submit.mockImplementation(async(worker,body)=>{if(worker.worker_class==='video')f.receipts.set(String(body.prompt_id),{submission:{graph_digest:'video-fixture'}});else await submit(worker,body);});
  await f.jobs.submit(f.request,'parallel-image-fixture');await f.jobs.submit({...f.request,workflow:'text-to-video',output:{aspect:'16:9',size:'768p',duration_seconds:5},audio:{output:'generated'}},'parallel-video-fixture');
  await f.jobs.reconcile(true);await f.settle();expect(new Set(f.worker.submit.mock.calls.map(([worker])=>worker.worker_class))).toEqual(new Set(['image','video']));expect(f.jobs.all().find(job=>job.request.workflow==='text-to-image')!.state).toBe('completed');expect(f.jobs.all().find(job=>job.request.workflow==='text-to-video')!.state).toBe('running');
}));

async function eventually(check:()=>boolean){for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Fixture operation did not settle.');}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}
it('recovers a durable claim when the process stopped before the job snapshot recorded its worker',async()=>fixture(async f=>{
  await f.ready('image',2);const {jobs:[job]}=await f.jobs.submit(f.request,'claim-crash-fixture');
  const claimed=f.pool.claim(job!.id,'image',[],job!.created_at)!;expect(f.jobs.get(job!.id)!.worker!.id).toBeUndefined();
  await f.settle();expect(f.jobs.get(job!.id)!.state).toBe('completed');expect(f.worker.submit).toHaveBeenCalledTimes(1);expect(f.worker.submit.mock.calls[0]![0].id).toBe(claimed.id);
  expect((f.db.prepare('SELECT COUNT(*) AS n FROM job_attempts WHERE job_id=?').get(job!.id) as {n:number}).n).toBe(1);
}));
it('Finish jobs retains its rental until local saving and worker acknowledgement both finish',async()=>fixture(async f=>{
  await f.ready();const download=gate(),ack=gate(),save=f.worker.download.getMockImplementation()!;
  f.worker.download.mockImplementation(async(...args)=>{await download.promise;return save(...args);});f.worker.acknowledge.mockImplementation(async()=>{await ack.promise;});
  const {jobs:[job]}=await f.jobs.submit(f.request,'finish-save-ack-fixture');const worker=f.pool.all()[0]!;
  try{
    await f.jobs.reconcile(true);await eventually(()=>f.worker.download.mock.calls.length===1);await f.pool.action(worker.id,'finish');await f.pool.tick();
    expect(f.jobs.get(job!.id)!.state).toBe('copying');expect(f.providers.vast.destroy).not.toHaveBeenCalled();
    download.release();await eventually(()=>f.worker.acknowledge.mock.calls.length===1);await f.pool.tick();
    expect(f.jobs.get(job!.id)!.state).toBe('completed');expect(f.pool.get(worker.id)!.current_job_id).toBe(job!.id);expect(f.providers.vast.destroy).not.toHaveBeenCalled();
    ack.release();await f.settle();await f.pool.tick();await eventually(()=>f.pool.get(worker.id)!.state==='released');
    expect(f.jobs.get(job!.id)!.outputs).toHaveLength(1);expect(f.providers.vast.destroy).toHaveBeenCalledTimes(1);
  }finally{download.release();ack.release();}
}));
it('Quit now during submission releases immediately and a late response cannot revive the request',async()=>fixture(async f=>{
  await f.ready();const held=gate(),submit=f.worker.submit.getMockImplementation()!;
  f.worker.submit.mockImplementation(async(...args)=>{await held.promise;return submit(...args);});
  const {jobs:[job]}=await f.jobs.submit(f.request,'quit-late-submit-fixture');const worker=f.pool.all()[0]!;
  try{
    await f.jobs.reconcile(true);await eventually(()=>f.worker.submit.mock.calls.length===1);await f.pool.action(worker.id,'quit');await eventually(()=>f.pool.get(worker.id)!.state==='released');
    expect(f.jobs.get(job!.id)!.state).toBe('cancelled');held.release();await f.settle();
    expect(f.jobs.get(job!.id)).toMatchObject({state:'cancelled',outputs:[],worker:{quit_now:true}});expect(f.worker.download).not.toHaveBeenCalled();expect(f.worker.acknowledge).not.toHaveBeenCalled();expect(f.worker.submit).toHaveBeenCalledTimes(1);
  }finally{held.release();}
}));
it('Quit now during saving preserves cancellation when a late download arrives',async()=>fixture(async f=>{
  await f.ready();const held=gate(),download=f.worker.download.getMockImplementation()!;
  f.worker.download.mockImplementation(async(...args)=>{await held.promise;return download(...args);});
  const {jobs:[job]}=await f.jobs.submit(f.request,'quit-late-save-fixture');const worker=f.pool.all()[0]!;
  try{
    await f.jobs.reconcile(true);await eventually(()=>f.worker.download.mock.calls.length===1);await f.pool.action(worker.id,'quit');await eventually(()=>f.pool.get(worker.id)!.state==='released');
    held.release();await f.settle();expect(f.jobs.get(job!.id)).toMatchObject({state:'cancelled',outputs:[],worker:{quit_now:true}});expect(f.jobs.media.get(job!.id+'-0')).toBeNull();expect(f.worker.acknowledge).not.toHaveBeenCalled();
  }finally{held.release();}
}));

it('accepted cancellation during saving never publishes the late output',async()=>fixture(async f=>{
  await f.ready();const held=gate(),download=f.worker.download.getMockImplementation()!;
  f.worker.download.mockImplementation(async(...args)=>{await held.promise;return download(...args);});
  const {jobs:[job]}=await f.jobs.submit(f.request,'cancel-late-save-fixture');
  try{
    await f.jobs.reconcile(true);await eventually(()=>f.worker.download.mock.calls.length===1);
    expect((await f.jobs.cancel(job!.id)).state).toBe('cancel_requested');
    held.release();await f.settle();
    expect(f.jobs.get(job!.id)).toMatchObject({state:'cancelled',outputs:[]});
    expect(f.jobs.media.get(job!.id+'-0')).toBeNull();
    expect(existsSync(path.join(f.paths.data,'media/outputs',job!.id+'-0.png'))).toBe(false);
    expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);
    expect(f.pool.all()[0]!.current_job_id).toBeUndefined();
  }finally{held.release();}
}));

it('cancellation wins when the worker already completed but its receipt arrives late',async()=>fixture(async f=>{
  await f.ready();const held=gate(),receipt=f.worker.receipt.getMockImplementation()!;
  f.worker.receipt.mockImplementation(async(...args)=>{const result=await receipt(...args);await held.promise;return result;});
  const {jobs:[job]}=await f.jobs.submit(f.request,'cancel-late-receipt-fixture');
  try{
    await f.jobs.reconcile(true);await eventually(()=>f.worker.receipt.mock.calls.length===1);
    await f.jobs.cancel(job!.id);held.release();await f.settle();
    expect(f.jobs.get(job!.id)).toMatchObject({state:'cancelled',outputs:[]});
    expect(f.worker.download).not.toHaveBeenCalled();expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);
  }finally{held.release();}
}));

it('cancellation releases a save-blocked request without requiring Retry saving',async()=>fixture(async f=>{
  await f.ready();f.worker.download.mockRejectedValueOnce(Object.assign(Error('disk full'),{code:'ENOSPC'}));
  const {jobs:[job]}=await f.jobs.submit(f.request,'cancel-blocked-save-fixture');await f.settle();
  expect(f.jobs.get(job!.id)!.recovery_blocked).toBe(true);
  await f.jobs.cancel(job!.id);await f.settle();
  expect(f.jobs.get(job!.id)).toMatchObject({state:'cancelled',outputs:[],recovery_blocked:false});
  expect(f.worker.download).toHaveBeenCalledTimes(1);expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);
  expect(f.pool.all()[0]!.current_job_id).toBeUndefined();
}));

it('retains accepted cancellation across restart when terminal acknowledgement was lost',async()=>fixture(async f=>{
  await f.ready();const held=gate(),download=f.worker.download.getMockImplementation()!;
  f.worker.download.mockImplementation(async(...args)=>{await held.promise;return download(...args);});
  f.worker.acknowledge.mockRejectedValue(Error('acknowledgement response lost'));
  const {jobs:[job]}=await f.jobs.submit(f.request,'cancel-ack-restart-fixture');
  try{
    await f.jobs.reconcile(true);await eventually(()=>f.worker.download.mock.calls.length===1);
    await f.jobs.cancel(job!.id);held.release();await f.settle();await f.jobs.close();
    expect(f.jobs.get(job!.id)).toMatchObject({state:'cancelled',outputs:[]});
    f.worker.acknowledge.mockResolvedValue(undefined);
    const restarted=new Jobs(f.db,f.paths,f.pool);
    try{
      await restarted.reconcile();
      expect(restarted.get(job!.id)).toMatchObject({state:'cancelled',outputs:[],worker:{acknowledged:true}});
      expect(f.worker.submit).toHaveBeenCalledTimes(1);expect(f.worker.download).toHaveBeenCalledTimes(1);
      expect(f.pool.all()[0]!.current_job_id).toBeUndefined();
    }finally{await restarted.close();await restarted.media.close();}
  }finally{held.release();}
}));

async function unknownSubmission(f:JobsFixture,request=f.request){
  if(!f.pool.all().length)await f.ready();
  f.worker.submit.mockRejectedValueOnce(new DOMException('Synthetic response timeout','TimeoutError'));
  const {jobs:[created]}=await f.jobs.submit(request,'unknown-recovery-fixture');
  await f.jobs.reconcile();
  const job=f.jobs.get(created!.id)!;
  expect(job).toMatchObject({state:'needs_attention',submission_pending:true});
  expect(f.receipts.has(job.id)).toBe(false);
  expect(f.worker.submit).toHaveBeenCalledTimes(1);
  return {job,worker:f.pool.get(job.worker!.id!)!,body:structuredClone(f.worker.submit.mock.calls[0]![1])};
}

it.each(['image','video'] as const)('retries the original %s envelope and seed on the same worker only after a fresh read-only probe',async role=>fixture(async f=>{
  await f.ready(role);
  const request=role==='image'?f.request:{...f.request,workflow:'text-to-video',output:{aspect:'16:9',size:'768p',duration_seconds:5},audio:{output:'generated'}};
  const {job,worker,body}=await unknownSubmission(f,request),prepareCalls=f.worker.prepare.mock.calls.length;
  // Nonterminal acceptance avoids fabricating a video output with the image fixture.
  f.worker.submit.mockImplementation(async(record,replayed)=>{f.receipts.set(String(replayed.prompt_id),{submission:{job_id:job.id,engine_session_id:record.session_id,workspace_id:'workspace-'+record.id}});});
  const pending=f.jobs.recover(job.id);
  expect(pending.recovery).toMatchObject({pending:true,worker_id:worker.id});
  expect(f.jobs.isInFlight(job.id)).toBe(true);
  await f.jobs.reconcile();
  expect(f.worker.probe).toHaveBeenCalled();
  expect(f.worker.prepare).toHaveBeenCalledTimes(prepareCalls);
  expect(f.worker.submit).toHaveBeenCalledTimes(2);
  expect(f.worker.submit.mock.calls[1]![0].id).toBe(worker.id);
  expect(f.worker.submit.mock.calls[1]![1]).toEqual(body);
  expect(body).toMatchObject({prompt_id:job.id,route:role==='image'?'image':'fl',...(role==='video'?{video_profile:'h3-high-v1'}:{})});
  expect(f.jobs.get(job.id)).toMatchObject({state:'running',seed:'42',submission_pending:false});
  expect(f.jobs.all()).toHaveLength(1);
  expect((f.db.prepare('SELECT COUNT(*) AS n FROM job_attempts WHERE job_id=?').get(job.id) as {n:number}).n).toBe(1);
  expect(f.providers.vast.create).toHaveBeenCalledTimes(1);
}));

it('recovers a newly visible receipt without submitting the request again',async()=>fixture(async f=>{
  const accepted=f.worker.submit.getMockImplementation()!,{job,worker,body}=await unknownSubmission(f);
  await accepted(worker,body);
  f.jobs.recover(job.id);await f.jobs.reconcile();
  expect(f.jobs.get(job.id)).toMatchObject({state:'completed',worker:{acknowledged:true}});
  expect(f.worker.submit).toHaveBeenCalledTimes(1);
  expect(f.worker.download).toHaveBeenCalledTimes(1);
  expect(f.pool.get(worker.id)!.current_job_id).toBeUndefined();
}));

it('coalesces duplicate recovery clicks with background reconciliation while the probe is pending',async()=>fixture(async f=>{
  const {job}=await unknownSubmission(f),held=gate(),probe=f.worker.probe.getMockImplementation()!;
  f.worker.probe.mockImplementation(async record=>{await held.promise;return probe(record);});
  try{
    expect(f.jobs.recover(job.id).recovery?.pending).toBe(true);
    expect(f.jobs.recover(job.id).recovery?.pending).toBe(true);
    await f.jobs.reconcile(true);await eventually(()=>f.worker.probe.mock.calls.length===1);
    expect(f.worker.submit).toHaveBeenCalledTimes(1);
    held.release();await f.jobs.reconcile();
    expect(f.worker.probe).toHaveBeenCalledTimes(1);
    expect(f.worker.submit).toHaveBeenCalledTimes(2);
    expect(f.jobs.get(job.id)!.state).toBe('completed');
  }finally{held.release();}
}));

it.each(['cancel','quit'] as const)('does not replay when %s is accepted during a pending recovery probe',async action=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f),held=gate(),probe=f.worker.probe.getMockImplementation()!;
  f.worker.probe.mockImplementation(async record=>{await held.promise;return probe(record);});
  try{
    f.jobs.recover(job.id);await eventually(()=>f.worker.probe.mock.calls.length===1);
    if(action==='cancel')f.jobs.stopJobs([job.id]);else await f.pool.action(worker.id,'quit');
    held.release();await f.jobs.reconcile();
    expect(f.worker.submit).toHaveBeenCalledTimes(1);
    expect(f.jobs.get(job.id)!.state).toBe(action==='cancel'?'cancel_requested':'cancelled');
    expect(f.jobs.publicJob(f.jobs.get(job.id)!).recovery?.action).toBeUndefined();
  }finally{held.release();}
}));

it.each(['cancel','quit'] as const)('fences the actual recovery POST when %s arrives during transport preflight',async action=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f),held=gate();let admitted=false;
  f.worker.submit.mockImplementation(async(_record,_body,options)=>{
    await held.promise;options?.beforePost?.();admitted=true;
  });
  try{
    f.jobs.recover(job.id);await eventually(()=>f.worker.submit.mock.calls.length===2);
    if(action==='cancel')f.jobs.stopJobs([job.id]);else await f.pool.action(worker.id,'quit');
    held.release();await f.jobs.reconcile();
    expect(admitted).toBe(false);
    expect(f.jobs.get(job.id)!.state).toBe(action==='cancel'?'cancel_requested':'cancelled');
    expect(f.receipts.has(job.id)).toBe(false);
    expect(f.jobs.publicJob(f.jobs.get(job.id)!).recovery?.action).toBeUndefined();
  }finally{held.release();}
}));

it.each(['unreachable','busy','preparing','no session'] as const)('keeps an unknown request reserved when a fresh probe is %s',async outcome=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f),probe=await f.worker.probe.getMockImplementation()!(worker);
  if(outcome==='unreachable')f.worker.probe.mockRejectedValue(new DOMException('Synthetic probe timeout','TimeoutError'));
  else f.worker.probe.mockResolvedValue({...probe,...(outcome==='busy'?{state:'busy' as const,active_job_id:'another-synthetic-job'}:outcome==='preparing'?{state:'preparing' as const}:{session_id:null})});
  f.jobs.recover(job.id);await f.jobs.reconcile();
  expect(f.worker.submit).toHaveBeenCalledTimes(1);
  expect(f.jobs.get(job.id)!.state).toBe('needs_attention');
  expect(f.pool.get(worker.id)!.current_job_id).toBe(job.id);
  expect(f.jobs.isInFlight(job.id)).toBe(false);
}));

it.each(['recovery','reconciliation'] as const)('does not mistake an old engine acceptance for running work during %s',async entry=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f),probe=await f.worker.probe.getMockImplementation()!(worker);
  f.receipts.set(job.id,{submission:{job_id:job.id,engine_session_id:worker.session_id,workspace_id:probe.workspace_id}});
  f.worker.probe.mockResolvedValue({...probe,session_id:'restarted-engine'});
  if(entry==='recovery')f.jobs.recover(job.id);
  await f.jobs.reconcile();await f.jobs.reconcile();
  expect(f.jobs.publicJob(f.jobs.get(job.id)!)).toMatchObject({state:'needs_attention',worker:{interruption:'engine_interrupted'},recovery:{pending:false,reason:'engine_interrupted'}});
  expect(f.jobs.publicJob(f.jobs.get(job.id)!).recovery?.action).toBeUndefined();
  expect(()=>f.jobs.recover(job.id)).toThrow('cannot be retried safely');
  expect(f.worker.submit).toHaveBeenCalledTimes(1);
  expect(f.pool.get(worker.id)!.current_job_id).toBe(job.id);
}));

it('keeps a recorded acceptance unknown while its current engine identity is unavailable',async()=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f),probe=await f.worker.probe.getMockImplementation()!(worker);
  f.receipts.set(job.id,{submission:{job_id:job.id,engine_session_id:worker.session_id,workspace_id:probe.workspace_id}});
  f.worker.probe.mockResolvedValue({...probe,session_id:null});
  f.jobs.recover(job.id);await f.jobs.reconcile();await f.jobs.reconcile();
  expect(f.jobs.get(job.id)).toMatchObject({state:'needs_attention'});
  expect(f.jobs.get(job.id)!.worker!.interruption).toBeUndefined();
  expect(f.worker.submit).toHaveBeenCalledTimes(1);
  expect(f.pool.get(worker.id)!.current_job_id).toBe(job.id);
}));

it.each(['saved envelope','known legacy graph','unsupported legacy graph'] as const)('preserves the exact selected LoRA and original graph for a %s',async format=>fixture(async f=>{
  f.jobs.loras.applySources('synthetic-recovery-style',[{name:'style.safetensors',route:'image',source:{provider:'civitai',model_id:5,version_id:10,file_id:20,url:'https://civitai.com/api/download/models/10',sha256:'a'.repeat(64),size_bytes:1000}}],{name:'Synthetic style',description:'Synthetic test adapter',default_scale:1,trigger_words:[],availability:'all',enabled:true});
  const lora=f.jobs.loras.all()[0]!;await f.ready();
  const {job,body}=await unknownSubmission(f,{...f.request,loras:[{id:lora.id,revision:lora.revision,scale:0.75}]});
  expect(body.loras).toEqual([expect.objectContaining({strength_model:0.75,sha256:'a'.repeat(64)})]);
  if(format!=='saved envelope'){
    delete job.worker!.submission;
    if(format==='unsupported legacy graph')delete (job.worker!.graph as Record<string,unknown>)['1'];
    f.jobs.save(job);
  }
  if(format==='unsupported legacy graph'){
    expect(f.jobs.publicJob(f.jobs.get(job.id)!).recovery).toMatchObject({reason:'submission_unavailable'});
    expect(()=>f.jobs.recover(job.id)).toThrow('cannot be retried safely');
    expect(f.worker.submit).toHaveBeenCalledTimes(1);
  }else{
    f.jobs.recover(job.id);await f.jobs.reconcile();
    expect(f.worker.submit).toHaveBeenCalledTimes(2);
    expect(f.worker.submit.mock.calls[1]![1]).toEqual(body);
    expect(f.jobs.get(job.id)!.state).toBe('completed');
  }
}));

it.each(['cancelled','released','unassigned','missing graph','closed app'] as const)('does not start recovery for a %s request',async condition=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f);
  if(condition==='cancelled')f.jobs.stopJobs([job.id]);
  else if(condition==='released'){await f.pool.action(worker.id,'quit');await f.pool.tick();}
  else if(condition==='unassigned')f.pool.complete(job.id);
  else if(condition==='missing graph'){delete job.worker!.graph;f.jobs.save(job);}
  else await f.jobs.close();
  if(condition==='released')expect(f.jobs.recover(job.id).recovery?.action).toBeUndefined();
  else expect(()=>f.jobs.recover(job.id)).toThrow('cannot be retried safely');
  expect(f.worker.probe).not.toHaveBeenCalled();
  expect(f.worker.submit).toHaveBeenCalledTimes(1);
}));

it('keeps unknown work available for explicit recovery across restart without automatic replay',async()=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f);await f.jobs.close();
  const restarted=new Jobs(f.db,f.paths,f.pool);
  try{
    for(let i=0;i<3;i++)await restarted.reconcile();
    expect(restarted.publicJob(restarted.get(job.id)!)).toMatchObject({state:'needs_attention',recovery:{pending:false,action:'retry'}});
    expect(f.worker.submit).toHaveBeenCalledTimes(1);
    expect(f.worker.probe).not.toHaveBeenCalled();
    expect(f.pool.get(worker.id)!.current_job_id).toBe(job.id);
  }finally{await restarted.close();await restarted.media.close();}
}));

it('preserves durable cancellation when a pending recovery probe fails afterward',async()=>fixture(async f=>{
  const {job}=await unknownSubmission(f),held=gate();
  f.worker.probe.mockImplementation(async()=>{await held.promise;throw new DOMException('Synthetic late timeout','TimeoutError');});
  try{
    f.jobs.recover(job.id);await eventually(()=>f.worker.probe.mock.calls.length===1);
    f.jobs.stopJobs([job.id]);held.release();await f.jobs.reconcile();
    expect(f.jobs.get(job.id)!.state).toBe('cancel_requested');
    expect(f.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(job.id)).toEqual({id:job.id});
    expect(f.jobs.publicJob(f.jobs.get(job.id)!).recovery?.action).toBeUndefined();
    expect(f.worker.submit).toHaveBeenCalledTimes(1);
  }finally{held.release();}
}));

it('keeps a recovery POST conflict unknown and reserved rather than treating it as initial rejection',async()=>fixture(async f=>{
  const {job,worker}=await unknownSubmission(f);
  f.worker.submit.mockRejectedValueOnce(new WorkerHttpError(409));
  f.jobs.recover(job.id);await f.jobs.reconcile();
  expect(f.jobs.get(job.id)!.state).toBe('needs_attention');
  expect(f.pool.get(worker.id)!.current_job_id).toBe(job.id);
  expect(f.worker.submit).toHaveBeenCalledTimes(2);
}));

it('offers Retry saving after recovering a completed receipt with a local write failure',async()=>fixture(async f=>{
  const accepted=f.worker.submit.getMockImplementation()!,{job,worker,body}=await unknownSubmission(f);
  await accepted(worker,body);f.worker.download.mockRejectedValueOnce(Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'}));
  f.jobs.recover(job.id);await f.jobs.reconcile();
  expect(f.jobs.get(job.id)).toMatchObject({recovery_blocked:true,worker:{receipt:{manifest:{state:'completed'}}}});
  expect(f.worker.acknowledge).not.toHaveBeenCalled();
  f.jobs.retrySave(job.id);await f.jobs.reconcile();
  expect(f.jobs.get(job.id)!.state).toBe('completed');
  expect(f.worker.submit).toHaveBeenCalledTimes(1);
  expect(f.worker.acknowledge).toHaveBeenCalledTimes(1);
}));
