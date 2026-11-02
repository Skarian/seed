import {it,expect} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {enginePhase,nextProgress,progressLabel,workerPhaseLabel} from '../shared/generation-progress.js';
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {fakePool} from './fake-pool.js';

it('keeps only known engine phases and a bounded percent',()=>{
  expect(enginePhase({phase:'generating',percent:42.9})).toEqual({phase:'generating',percent:42});
  expect(enginePhase({phase:'editing',percent:140})).toEqual({phase:'generating',percent:100});
  expect(enginePhase({phase:'saving'})).toEqual({phase:'finishing'});
  expect(enginePhase({phase:'loading',percent:10})).toEqual({phase:'loading'});
  for(const raw of [undefined,null,'loading',{phase:'sampling'},{phase:1}])expect(enginePhase(raw)).toBeUndefined();
});

it('shows four plain steps, with a percent while generating and elapsed time otherwise',()=>{
  const start=new Date('2026-11-02T10:00:00Z'),at=(s:number)=>start.getTime()+s*1000;
  const loading=nextProgress(undefined,'loading',undefined,start);
  expect(progressLabel(loading,'text-to-video',at(0))).toBe('Loading models…');
  expect(progressLabel(nextProgress(loading,'loading',undefined,new Date(at(18))),'text-to-video',at(18))).toBe('Loading models · 18 s');
  expect(progressLabel(loading,'text-to-video',at(75))).toBe('Loading models · 1 min 15 s');
  expect(progressLabel(nextProgress(loading,'generating',42,new Date(at(80))),'text-to-video')).toBe('Generating · 42%');
  expect(progressLabel(nextProgress(loading,'generating',7,start),'image-to-image')).toBe('Editing · 7%');
  expect(progressLabel(nextProgress(undefined,'finishing',undefined,start),'text-to-image',at(3))).toBe('Finishing · 3 s');
  expect(progressLabel({...nextProgress(undefined,'starting',undefined,start),preparing_loras:true},'text-to-video',at(5))).toBe('Preparing LoRAs · 5 s');
  expect(workerPhaseLabel({phase:'generating',percent:5})).toBe('Generating · 5%');
  expect(workerPhaseLabel({phase:'finishing'})).toBe('Finishing');
});

for(const [workflow,role] of [['text-to-image','image'],['image-to-image','image'],['text-to-video','video']] as const)
it(`reports progress for ${workflow} on a cloud worker`,async()=>{
  mkdirSync('.local/tests',{recursive:true});
  const root=mkdtempSync(path.resolve('.local/tests/progress-')),paths=resolvePaths(root);prepareStorage(paths);
  const db=openDatabase(paths.data),f=fakePool(db,paths),jobs=new Jobs(db,paths,f.pool);
  try{
    // Synthetic request; the engine holds it running so its phase can be observed.
    const workflows=role==='image'?['text-to-image','image-to-image']:['text-to-video'];
    const prepare=f.worker.prepare.getMockImplementation()!;
    let phase:any={phase:'loading'};
    f.worker.prepare.mockImplementation(async (w:any)=>{const health=await prepare(w);return w.current_job_id?{...health,workflows,busy:true,active_job_id:w.current_job_id,phase,activity:workerPhaseLabel(phase)}:{...health,workflows};});
    f.worker.submit.mockImplementation(async(record:any,body:any,options:any)=>{options?.beforePost?.();const id=String(body.prompt_id);f.receipts.set(id,{submission:{graph_digest:'fixture',job_id:id,workspace_id:'workspace-'+record.id,engine_session_id:record.session_id}} as any);});
    await f.ready(role);
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('photo','image','Synthetic source','media/originals/photo',JSON.stringify({state:'ready',sha256:'fixture-photo',mode:'sfw'}),new Date().toISOString());
    const request:any=workflow==='text-to-image'?{workflow,mode:'sfw',prompt:'A synthetic red cube.',output:{aspect:'16:9',size:'1mp'},seed:'1',count:1}
      :workflow==='image-to-image'?{workflow,mode:'sfw',prompt:'Make it blue.',references:[{id:'source',asset_id:'photo',kind:'image',role:'source'}],output:{aspect:'source',size:'1mp'},seed:'1',count:1}
      :{workflow,mode:'sfw',prompt:'A synthetic cube spins.',output:{aspect:'16:9',size:'768p',duration_seconds:5},audio:{output:'generated'},seed:'1',count:1};
    if(workflow==='image-to-image'){const sharp=(await import('sharp')).default,file=path.join(paths.data,'media/originals/photo');mkdirSync(path.dirname(file),{recursive:true});await sharp({create:{width:64,height:64,channels:3,background:'#336699'}}).png().toFile(file);}
    const job=(await jobs.submit(request,'progress-'+workflow)).jobs[0]!;
    const settle=async()=>{for(let i=0;i<4;i++){await f.pool.tick();await jobs.reconcile();}};
    await settle();
    expect(jobs.get(job.id)).toMatchObject({state:'running',progress:{phase:'loading'}});
    const loadingSince=jobs.get(job.id)!.progress!.since;
    await settle();
    expect(jobs.get(job.id)!.progress!.since).toBe(loadingSince);
    phase={phase:'generating',percent:42};await settle();
    expect(jobs.get(job.id)!.progress).toMatchObject({phase:'generating',percent:42});
    expect(f.pool.get(jobs.get(job.id)!.worker!.id!)!.current_activity).toBe('Generating · 42%');
    phase={phase:'finishing'};await settle();
    expect(jobs.get(job.id)!.progress).toMatchObject({phase:'finishing'});
  }finally{await jobs.close();await f.pool.close();await jobs.media.close();db.close();rmSync(root,{recursive:true,force:true});}
});
