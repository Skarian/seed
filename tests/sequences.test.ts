import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openDatabase, listAssets } from '../server/db.js';
import { Sequences } from '../server/sequences.js';
import { prepareStorage, resolvePaths } from '../server/storage.js';
import type { Jobs } from '../server/jobs.js';
import { videoRequest } from '../server/video.js';

const request={workflow:'text-to-video',prompt:'A forest',mode:'sfw',seed:'5',count:1,output:{aspect:'16:9',size:'768p',duration_seconds:5}};
it.each([4,16,5.5,'5',null])('rejects invalid duration %s',duration=>{
  expect(()=>videoRequest({...request,output:{...request.output,duration_seconds:duration}})).toThrow();
});

function fixture(run:(f:any)=>void) {
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/sequences-'));
  const paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data);
  let jobs:any[]=[];
  const service=()=>new Sequences(db,paths.data,paths.cache,{all:()=>jobs,isInFlight:()=>false,save:()=>{}} as unknown as Jobs);
  db.prepare('INSERT INTO sequences(id,mode,created_at) VALUES (?,?,?)').run('seq','nsfw','2026-09-12T00:00:00Z');
  for(let i=0;i<4;i++){
    writeFileSync(path.join(paths.data,`media/outputs/f${i}.png`),'frame'+i);
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('f'+i,'image','Frame',`media/outputs/f${i}.png`,JSON.stringify({width:100,height:50}), '2026-09-12T00:00:00Z');
    db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('seq','f'+i,i);
  }
  try {run({db,paths,service,setJobs:(value:any[])=>jobs=value});}
  finally{db.close();rmSync(root,{recursive:true,force:true});}
}
it('lists legacy frames as images and preserves originals through pruning, retry and restart',()=>fixture(({db,paths,service}:any)=>{
  expect(listAssets(db).map(asset=>[asset.id,asset.kind,asset.mode])).toEqual(['f3','f2','f1','f0'].map(id=>[id,'image','nsfw']));
  expect(listAssets(db,'',50,'sfw','image')).toEqual([]);
  expect(listAssets(db,'',50,'nsfw','image')).toHaveLength(4);
  const result=service().prune('seq',['f3','f1'],0);
  expect(result.frames.map((f:any)=>f.id)).toEqual(['f1','f3']);expect(result.frames[0].time).toBe(1/24);
  expect(existsSync(path.join(paths.data,'media/outputs/f0.png'))).toBe(false);
  expect(existsSync(path.join(paths.data,'media/outputs/f1.png'))).toBe(true);
  expect(service().prune('seq',['f1','f3'],0).revision).toBe(1);
  expect(()=>service().prune('seq',['f1'],0)).toThrow('changed');
  expect(service().prune('seq',['f3'],1).frames).toHaveLength(1);
  expect(listAssets(db).map(asset=>asset.id)).toEqual(['f3']);
}));
it('preflights queued references before any file removal and rejects foreign/empty sets',()=>fixture(({service,setJobs,paths}:any)=>{
  setJobs([{state:'queued',request:{references:[{asset_id:'f2'}]},outputs:[]}]);
  expect(()=>service().prune('seq',['f0'],0)).toThrow('queued');
  expect(existsSync(path.join(paths.data,'media/outputs/f1.png'))).toBe(true);
  expect(()=>service().prune('seq',[],0)).toThrow();
  expect(()=>service().prune('seq',['alien'],0)).toThrow();
}));
it('recovers persisted partial deletion intent and updates job output ownership',()=>fixture(({db,service,setJobs,paths}:any)=>{
  const job={outputs:['f0','f1','f2','f3'],state:'completed'};setJobs([job]);
  db.prepare('UPDATE sequences SET pending_json=? WHERE id=?').run(JSON.stringify({keep:['f3'],remove:['f0','f1','f2'],deleting:false}),'seq');
  rmSync(path.join(paths.data,'media/outputs/f0.png'));
  service().recover();expect(service().get('seq').frames.map((f:any)=>f.id)).toEqual(['f3']);expect(job.outputs).toEqual(['f3']);
  service().prune('seq',[],1,true);expect(listAssets(db)).toEqual([]);expect(job.outputs).toEqual([]);
}));
