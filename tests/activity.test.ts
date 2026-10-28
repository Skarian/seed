import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { Activity } from '../server/activity.js';
import { prepareStorage, resolvePaths } from '../server/storage.js';
import type { Job } from '../server/jobs.js';
import type { LoraImportActivity } from '../shared/loras.js';
import type { PoolSnapshot, PoolWorker } from '../shared/pool.js';
import { visibleActivityJob, visibleActivityImport, visibleActivityWorker } from '../shared/activity.js';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{force:true,recursive:true});});
function fixture(){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/activity-'));roots.push(root);
  const paths=resolvePaths(root);prepareStorage(paths);
  const jobs:Job[]=['completed','failed','cancelled','queued','running','copying','cancel_requested','blocked','needs_attention'].map((state,i)=>({
    id:'job-'+i,submission_id:'submission-'+i,submission_index:0,state,seed:'1',outputs:state==='completed'?['saved-media']:[],error:null,
    created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:01:00Z',
    request:{workflow:'text-to-image',mode:'sfw',prompt:'Keep my request',count:1,seed:'1',output:{aspect:'16:9',size:'1mp'}},
  }));
  jobs.push({...jobs[1]!,id:'save-recovery',recovery_blocked:true});
  jobs.push({...jobs[0]!,id:'private',request:{...jobs[0]!.request,mode:'nsfw'}});
  const imports:LoraImportActivity[]=['ready','failed','downloading'].map((state,i)=>({id:'import-'+i,name:'Keep adapter',state:state as LoraImportActivity['state'],created_at:'before',updated_at:'revision-1',files:[]}));
  const workers=['released','ready','releasing','needs_attention'].map((state,i)=>({id:'worker-'+i,state,created_at:'before',released_at:state==='released'?'release-1':undefined}) as PoolWorker);
  const sources=[{all:()=>jobs},{list:()=>imports},{snapshot:()=>({workers}) as PoolSnapshot}] as const;
  return {paths,jobs,imports,workers,sources,activity:new Activity(paths)};
}
it('persists cleared finished entries while preserving active work, recovery, other modes and original records',()=>{
  const f=fixture(),original=JSON.stringify([f.jobs,f.imports,f.workers]);
  const cleared=f.activity.clear('sfw',...f.sources);
  expect(Object.keys(cleared.jobs)).toEqual(['job-0','job-1','job-2']);
  expect(Object.keys(cleared.imports)).toEqual(['import-0','import-1']);
  expect(Object.keys(cleared.workers)).toEqual(['worker-0']);
  expect(JSON.stringify([f.jobs,f.imports,f.workers])).toBe(original);
  expect(new Activity(f.paths).snapshot()).toEqual(cleared);
  expect(f.jobs.filter(j=>visibleActivityJob(j,cleared)).map(j=>j.id)).toContain('save-recovery');
  f.activity.clear('nsfw',...f.sources);
  expect(Object.keys(new Activity(f.paths).snapshot().jobs)).toEqual(['job-0','job-1','job-2','private']);
});
it('shows new events and updated or retried records after a clear',()=>{
  const f=fixture(),cleared=f.activity.clear('sfw',...f.sources);
  expect(visibleActivityJob(f.jobs[0]!,cleared)).toBe(false);
  expect(visibleActivityJob({...f.jobs[0]!,id:'new'},cleared)).toBe(true);
  expect(visibleActivityJob({...f.jobs[0]!,updated_at:'new-revision'},cleared)).toBe(true);
  expect(visibleActivityJob({...f.jobs[0]!,state:'running'},cleared)).toBe(true);
  expect(visibleActivityImport(f.imports[0]!,cleared)).toBe(false);
  expect(visibleActivityImport({...f.imports[0]!,state:'downloading'},cleared)).toBe(true);
  expect(visibleActivityImport({...f.imports[0]!,updated_at:'retry-finished'},cleared)).toBe(true);
  expect(visibleActivityWorker(f.workers[0]!,cleared)).toBe(false);
  expect(visibleActivityWorker({...f.workers[0]!,state:'reconnecting'},cleared)).toBe(true);
});
it('retains the last saved clear state when a write fails',()=>{
  const f=fixture(),before=f.activity.clear('sfw',...f.sources);
  const file=path.join(f.paths.config,'activity-cleared.json'),original=readFileSync(file,'utf8');
  renameSync(f.paths.config,f.paths.config+'-unavailable');
  try {
    expect(()=>f.activity.clear('nsfw',...f.sources)).toThrow();
    expect(f.activity.snapshot()).toEqual(before);
    expect(readFileSync(path.join(f.paths.config+'-unavailable','activity-cleared.json'),'utf8')).toBe(original);
  } finally { renameSync(f.paths.config+'-unavailable',f.paths.config); }
});
