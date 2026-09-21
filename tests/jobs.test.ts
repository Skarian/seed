import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Jobs } from '../server/jobs.js';
import { FalError } from '../server/fal.js';
import { openDatabase } from '../server/db.js';
import { resolvePaths, prepareStorage } from '../server/storage.js';
import { fakeFal } from './fake-fal.js';
async function fixture(run: (f: any) => Promise<void>) {
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/fal-jobs-')),paths=resolvePaths(root);prepareStorage(paths);
  const db=openDatabase(paths.data),fal=fakeFal(),jobs=new Jobs(db,paths,fal);
  const request={workflow:'text-to-image',prompt:'A forest',mode:'sfw',output:{aspect:'16:9',size:'1mp'},seed:'42',count:1};
  try {await run({jobs,db,fal,paths,request});}finally{await jobs.close();await jobs.media.close();db.close();rmSync(root,{recursive:true,force:true});}
}
it('saves outputs and deduplicates submissions',async()=>fixture(async({jobs,fal,request})=>{
  const first=await jobs.submit(request,'a-submission-key-123');await jobs.reconcile();await jobs.reconcile();
  expect(jobs.get(first.jobs[0].id)).toMatchObject({state:'completed',outputs:[first.jobs[0].id+'-0']});
  expect((await jobs.submit(request,'a-submission-key-123')).submission_id).toBe(first.submission_id);await jobs.reconcile();expect(fal.submit).toHaveBeenCalledTimes(1);
  await expect(jobs.submit({...request,prompt:'Other'},'a-submission-key-123')).rejects.toThrow('different settings');
}));
it('enforces LoRA mode at admission and again before queued jobs can spend credits',async()=>fixture(async({jobs,fal,paths,request})=>{
  const entry={id:'private',name:'Private adapter',revision:'v1',route:'image',availability:'spicy',format:'lora',compatibility:'untested',file:'not-needed.safetensors'};
  const catalog=path.join(paths.config,'loras.json');writeFileSync(catalog,JSON.stringify([entry]));
  const selected={...request,loras:[{id:'private',revision:'v1',scale:1.5}]};
  expect(jobs.loras.list('sfw')).toEqual([]);expect(jobs.loras.list('nsfw')).toHaveLength(1);
  await expect(jobs.submit(selected,'private-standard-rejection')).rejects.toThrow('unavailable');expect(fal.submit).not.toHaveBeenCalled();
  jobs.loras.setAvailability('private','all');const accepted=await jobs.submit(selected,'queued-availability-change');
  jobs.loras.setAvailability('private','spicy');await jobs.reconcile();
  expect(jobs.get(accepted.jobs[0].id).state).toBe('failed');expect(fal.submit).not.toHaveBeenCalled();
  expect(()=>jobs.loras.resolve(selected.loras,'image','nsfw')).not.toThrow();
}));
it('never retries an ambiguous POST',async()=>fixture(async({jobs,fal,request})=>{
  fal.submit.mockRejectedValueOnce(Error('timeout'));const {jobs:[job]}=await jobs.submit(request,'ambiguous-paid-job');await jobs.reconcile();await jobs.reconcile();
  expect(jobs.get(job.id).state).toBe('needs_attention');expect(fal.submit).toHaveBeenCalledTimes(1);
  await expect(jobs.submit(request,'another-paid-job-key')).rejects.toThrow('interrupted');
}));
it('recovers output saves without resubmitting',async()=>fixture(async({jobs,fal,request})=>{
  const {jobs:[job]}=await jobs.submit(request,'save-failure-key-123');await jobs.reconcile();
  fal.download.mockRejectedValueOnce(Error('disk full'));await jobs.reconcile();expect(jobs.get(job.id)).toMatchObject({recovery_blocked:true,state:'copying'});
  jobs.retrySave(job.id);await jobs.reconcile();expect(jobs.get(job.id).state).toBe('completed');expect(fal.submit).toHaveBeenCalledTimes(1);
}));
it('limits concurrency and honours cancellation',async()=>fixture(async({jobs,fal,request})=>{
  fal.status.mockResolvedValue({status:'IN_PROGRESS'});const batch=await jobs.submit({...request,count:4},'batch-request-key-123');await jobs.reconcile();expect(fal.submit).toHaveBeenCalledTimes(2);
  jobs.stopJobs(batch.jobs.map((j:any)=>j.id));await jobs.reconcile();expect(jobs.all().every((j:any)=>j.state==='cancelled')).toBe(true);expect(fal.submit).toHaveBeenCalledTimes(2);
}));
it('does not retry a definite rejection',async()=>fixture(async({jobs,fal,request})=>{
  fal.submit.mockRejectedValue(new FalError(422));await jobs.submit(request,'rejected-request-key');await jobs.reconcile();await jobs.reconcile();expect(jobs.all()[0].state).toBe('failed');expect(fal.submit).toHaveBeenCalledTimes(1);
}));
it('holds unsent outputs on exhausted credits and never retries its rejected POST',async()=>fixture(async({jobs,fal,request})=>{
  fal.submit.mockRejectedValue(new FalError(403,{detail:'User is locked. Reason: Exhausted balance'}));await jobs.submit({...request,count:4},'empty-balance-batch');await jobs.reconcile();await jobs.reconcile();
  expect(fal.submit).toHaveBeenCalledTimes(1);expect(jobs.all().filter((j:any)=>j.state==='blocked')).toHaveLength(3);expect(jobs.all().find((j:any)=>j.state==='failed')).toMatchObject({submission_pending:false,provider_issue:{code:'insufficient_funds'}});
}));
it('records a completed model failure without retrying the paid request',async()=>fixture(async({jobs,fal,request})=>{
  fal.status.mockResolvedValue({status:'COMPLETED',error:'private provider text',error_type:'no_media_generated'});const {jobs:[job]}=await jobs.submit(request,'completed-failure-id');await jobs.reconcile();await jobs.reconcile();
  expect(jobs.get(job.id)).toMatchObject({state:'failed',provider_issue:{code:'no_output'}});expect(jobs.get(job.id).error).not.toContain('private provider text');expect(fal.submit).toHaveBeenCalledTimes(1);expect(fal.result).not.toHaveBeenCalled();
}));
it('keeps the dispatcher responsive while a submission is in flight',async()=>fixture(async({jobs,fal,request})=>{
  let release!:()=>void;const wait=new Promise<void>(r=>release=r);const receipt={request_id:'id',status_url:'https://queue.fal.run/status',response_url:'https://queue.fal.run/result',cancel_url:'https://queue.fal.run/cancel'};
  fal.submit.mockImplementation(async()=>{await wait;return receipt;});const batch=await jobs.submit(request,'background-paid-key');
  await jobs.reconcile(true);await jobs.reconcile(true);expect(fal.submit).toHaveBeenCalledTimes(1);expect(jobs.get(batch.jobs[0].id).state).toBe('submitting');
  jobs.interrupt(batch.jobs[0].id);expect(jobs.get(batch.jobs[0].id).state).toBe('cancel_requested');release();await new Promise(r=>setTimeout(r,0));
  await jobs.reconcile();expect(jobs.get(batch.jobs[0].id).state).toBe('cancelled');
}));

it('continues only the selected request and never silently retries rejected outputs',async()=>fixture(async({jobs,fal,request})=>{
  const originalSubmit=fal.submit.getMockImplementation();
  fal.submit.mockRejectedValue(new FalError(402));
  const first=await jobs.submit({...request,count:4},'first-held-request');
  const second=await jobs.submit({...request,count:2},'second-held-request');
  await jobs.reconcile();expect(fal.submit).toHaveBeenCalledTimes(1);
  expect(jobs.all().filter((j:any)=>j.state==='blocked')).toHaveLength(5);
  fal.submit.mockImplementation(originalSubmit);
  jobs.continueRequest(first.jobs[1].id);await jobs.reconcile();await jobs.reconcile();await jobs.reconcile();
  expect(jobs.get(first.jobs[0].id).state).toBe('failed');
  expect(first.jobs.slice(1).every((j:any)=>jobs.get(j.id).state==='completed')).toBe(true);
  expect(second.jobs.every((j:any)=>jobs.get(j.id).state==='blocked')).toBe(true);
  expect(fal.submit).toHaveBeenCalledTimes(4);
  await jobs.cancel(second.jobs[0].id);expect(jobs.get(second.jobs[0].id).state).toBe('cancelled');
}));
it('keeps uncertainty as a barrier even when a held request is continued',async()=>fixture(async({jobs,fal,request})=>{
  fal.submit.mockRejectedValueOnce(Error('timeout'));
  const accepted=await jobs.submit({...request,count:2},'uncertain-held-request');await jobs.reconcile();
  expect(()=>jobs.continueRequest(accepted.jobs[1].id)).toThrow('interrupted');
  jobs.acknowledge(accepted.jobs[0].id);jobs.continueRequest(accepted.jobs[1].id);await jobs.reconcile();
  expect(jobs.get(accepted.jobs[0].id).state).toBe('needs_attention');expect(fal.submit).toHaveBeenCalledTimes(2);
}));
it('retrying one saved output does not release another failed download',async()=>fixture(async({jobs,fal,request})=>{
  const accepted=await jobs.submit({...request,count:2},'two-save-failures');await jobs.reconcile();
  fal.download.mockRejectedValue(Error('disk full'));await jobs.reconcile();
  expect(accepted.jobs.every((j:any)=>jobs.get(j.id).recovery_blocked)).toBe(true);
  jobs.retrySave(accepted.jobs[0].id);
  expect(jobs.get(accepted.jobs[1].id).recovery_blocked).toBe(true);
  expect(fal.submit).toHaveBeenCalledTimes(2);
}));
