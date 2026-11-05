import {it,expect} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {openDatabase,listAssets} from '../server/db.js';

// Synthetic fixture rows only: two generated images from different chats and one upload.
function fixture(run:(db:ReturnType<typeof openDatabase>)=>void){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/library-'));const db=openDatabase(root);
  try{
    const job=(id:string,chat:string,prompt:string,title:string)=>db.prepare("INSERT INTO jobs VALUES (?,'text-to-image','completed',?,?,?,?,0)").run(id,JSON.stringify({request:{prompt,title,mode:'sfw'},source:{chat_id:chat}}),'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','sub-'+id);
    const asset=(id:string,at:string,meta:object)=>db.prepare("INSERT INTO assets VALUES (?,'image',?,?,?,?)").run(id,'Generated image','files/'+id+'.png',JSON.stringify({mode:'sfw',...meta}),at);
    job('job-lake','chat-a','A quiet lake at dawn','Quiet lake');job('job-ridge','chat-b','A misty ridge','Misty ridge');
    asset('a-lake','2026-11-01T01:00:00Z',{job_id:'job-lake'});asset('a-ridge','2026-11-01T02:00:00Z',{job_id:'job-ridge'});asset('a-upload','2026-11-01T03:00:00Z',{});
    db.prepare("INSERT INTO asset_notes VALUES ('a-upload','Reference sketch of a lighthouse',1)").run();
    run(db);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
}

it('searches prompts, titles and notes, and filters by source and project',()=>fixture(db=>{
  const ids=(filters:Parameters<typeof listAssets>[5])=>listAssets(db,'',50,'sfw',undefined,filters).map(a=>a.id);
  expect(ids({})).toEqual(['a-upload','a-ridge','a-lake']);
  expect(ids({q:'LAKE'})).toEqual(['a-lake']);
  expect(ids({q:'misty ridge'})).toEqual(['a-ridge']);
  expect(ids({q:'ridge misty'})).toEqual(['a-ridge']);
  expect(listAssets(db,'',50,'sfw',undefined,{q:'ridge'})[0]!.prompt_match).toBeTruthy();
  expect(listAssets(db,'',50,'sfw')[0]!.prompt_match).toBeUndefined();
  expect(ids({q:'lighthouse'})).toEqual(['a-upload']);
  expect(listAssets(db,'',50,'sfw',undefined,{q:'lighthouse'})[0]!.note).toBe('Reference sketch of a lighthouse');
  expect(listAssets(db,'',50,'sfw',undefined,{q:'lake'})[0]!.note).toBeUndefined();
  expect(ids({q:'100%'})).toEqual([]);
  expect(ids({source:'uploaded'})).toEqual(['a-upload']);
  expect(ids({source:'made'})).toEqual(['a-ridge','a-lake']);
  expect(ids({chat_id:'chat-b'})).toEqual(['a-ridge']);
  expect(ids({order:'oldest'})).toEqual(['a-lake','a-ridge','a-upload']);
  expect(listAssets(db,'a-lake',50,'sfw',undefined,{order:'oldest'}).map(a=>a.id)).toEqual(['a-ridge','a-upload']);
  expect(listAssets(db,'',50,'sfw')[1]).toMatchObject({id:'a-ridge',job_id:'job-ridge',title:'Misty ridge',chat_id:'chat-b'});
  expect(listAssets(db,'',50,'sfw')[1]!.variant).toBeUndefined();
  db.prepare("INSERT INTO jobs VALUES (?,'text-to-image','completed',?,?,?,?,1)").run('job-dune',JSON.stringify({submission_index:1,request:{prompt:'Dunes',title:'Dunes',count:3,mode:'sfw'},source:{chat_id:'chat-a'}}),'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','sub-dune');
  db.prepare("INSERT INTO assets VALUES (?,'image',?,?,?,?)").run('a-dune','Generated image','files/a-dune.png',JSON.stringify({mode:'sfw',job_id:'job-dune'}),'2026-11-01T04:00:00Z');
  expect(listAssets(db,'',50,'sfw')[0]).toMatchObject({id:'a-dune',variant:2,variants:3});
}));
