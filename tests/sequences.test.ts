import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openDatabase, listAssets } from '../server/db.js';
import { Sequences } from '../server/sequences.js';
import { prepareStorage, resolvePaths } from '../server/storage.js';
import type { Jobs } from '../server/jobs.js';
import { videoGraph, videoRequest } from '../server/video.js';

const request={workflow:'text-to-video',capabilities_revision:'test',prompt:'A forest',mode:'sfw',seed:'5',count:1,output:{aspect:'16:9',size:'720p',duration_seconds:5}};
it.each(Array.from({length:11},(_,i)=>i+5))('exports exact %i seconds in both formats without changing conditioning',seconds=>{
  const v=videoRequest({...request,output:{...request.output,duration_seconds:seconds}});
  const images=videoGraph({...v,output:{...v.output,format:'images'}},'job','5',null);
  const video=videoGraph(v,'job','5',null);
  expect(images['15']!.inputs.length).toBe(seconds*24);
  expect(images['6']).toEqual(video['6']);expect(images['11']).toEqual(video['11']);
  expect(images['6']!.inputs.length).toBe(17*Math.ceil((seconds*24-5)/17)+5);
  expect(images['13']).toBeUndefined();expect(images['14']!.class_type).toBe('SaveImage');
  expect(video['14']!.inputs.seconds).toBe(seconds);
});
it.each([4,16,5.5,'5',null])('rejects invalid duration %s',duration=>{
  expect(()=>videoRequest({...request,output:{...request.output,duration_seconds:duration}})).toThrow();
});

function fixture(run:(f:any)=>void) {
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/sequences-'));
  const paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data);
  let jobs:any[]=[];
  const service=()=>new Sequences(db,paths.data,paths.cache,{all:()=>jobs,save:()=>{}} as unknown as Jobs);
  db.prepare('INSERT INTO sequences(id,mode,created_at) VALUES (?,?,?)').run('seq','nsfw','2026-09-12T00:00:00Z');
  for(let i=0;i<4;i++){
    writeFileSync(path.join(paths.data,`media/outputs/f${i}.png`),'frame'+i);
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('f'+i,'image','Frame',`media/outputs/f${i}.png`,JSON.stringify({width:100,height:50}), '2026-09-12T00:00:00Z');
    db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('seq','f'+i,i);
  }
  try {run({db,paths,service,setJobs:(value:any[])=>jobs=value});}
  finally{db.close();rmSync(root,{recursive:true,force:true});}
}
it('groups all frames, preserves originals and order through pruning, retry and restart',()=>fixture(({db,paths,service}:any)=>{
  expect(listAssets(db)).toEqual([{id:'seq',kind:'sequence',name:'Image sequence',mode:'nsfw',created_at:'2026-09-12T00:00:00Z',cover_id:'f0',frame_count:4}]);
  const result=service().prune('seq',['f3','f1'],0);
  expect(result.frames.map((f:any)=>f.id)).toEqual(['f1','f3']);expect(result.frames[0].time).toBe(1/24);
  expect(existsSync(path.join(paths.data,'media/outputs/f0.png'))).toBe(false);
  expect(existsSync(path.join(paths.data,'media/outputs/f1.png'))).toBe(true);
  expect(service().prune('seq',['f1','f3'],0).revision).toBe(1);
  expect(()=>service().prune('seq',['f1'],0)).toThrow('changed');
  expect(service().prune('seq',['f3'],1).frames).toHaveLength(1);
  expect(listAssets(db)[0]!.frame_count).toBe(1);
}));
it('preflights queued references before any file removal and rejects foreign/empty sets',()=>fixture(({service,setJobs,paths}:any)=>{
  setJobs([{state:'queued',request:{references:[{asset_id:'f2'}]},outputs:[]}]);
  expect(()=>service().prune('seq',['f0'],0)).toThrow('queued');
  expect(existsSync(path.join(paths.data,'media/outputs/f1.png'))).toBe(true);
  expect(()=>service().prune('seq',[],0)).toThrow();
  expect(()=>service().prune('seq',['alien'],0)).toThrow();
}));
it('recovers persisted partial deletion intent and updates job output ownership',()=>fixture(({db,service,setJobs,paths}:any)=>{
  const job={outputs:['f0','f1','f2','f3'],state:'completed',cleanup_state:'complete'};setJobs([job]);
  db.prepare('UPDATE sequences SET pending_json=? WHERE id=?').run(JSON.stringify({keep:['f3'],remove:['f0','f1','f2'],deleting:false}),'seq');
  rmSync(path.join(paths.data,'media/outputs/f0.png'));
  service().recover();expect(service().get('seq').frames.map((f:any)=>f.id)).toEqual(['f3']);expect(job.outputs).toEqual(['f3']);
  service().prune('seq',[],1,true);expect(listAssets(db)).toEqual([]);expect(job.outputs).toEqual([]);
}));
