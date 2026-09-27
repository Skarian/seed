import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import Fastify from 'fastify';
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {Chats} from '../server/chat/service.js';
import {registerChats} from '../server/chat/http.js';
import {fakePool} from './fake-pool.js';

it('accepts UI mention bindings over HTTP, retains history and resolves source tokens in the real provider context',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/mention-context-')),paths=resolvePaths(root);prepareStorage(paths);
 writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({openrouterApiKey:'fake'}));
 const db=openDatabase(paths.data),jobs=new Jobs(db,paths,fakePool(db,paths).pool);
 let provider:any;
 const chats=new Chats(db,paths,jobs,async(_url,init)=>{provider=JSON.parse(String(init?.body));return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'References understood.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});});
 const app=Fastify();registerChats(app,chats,()=>true);
 try{
  for(const id of ['first','second']){
   await sharp({create:{width:24,height:24,channels:3,background:'blue'}}).png().toFile(path.join(paths.data,`media/originals/${id}.png`));
   db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(id,'image',id,`media/originals/${id}.png`,JSON.stringify({mode:'sfw',state:'ready'}),'2026-01-01');
  }
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'reference-to-video',title:'Mention test'});
  const text='Move [Picture 1](asset:second) toward [Picture 2](asset:first).';
  const response=await app.inject({method:'POST',url:`/api/v1/chats/${chat.id}/messages`,payload:{version:chat.version,text,assets:['first','second'],mention_bindings:[{token:'[Picture 1](asset:second)',asset_id:'second'},{token:'[Picture 2](asset:first)',asset_id:'first'}]}});
  expect(response.statusCode).toBe(200);
  for(let i=0;i<300&&chats.view(chat.id).activity!=='idle';i++)await new Promise(resolve=>setTimeout(resolve,10));
  expect(chats.view(chat.id).activity).toBe('idle');
  const user=chats.view(chat.id).messages.find(m=>m.role==='user')!;
  expect(user.text).toBe(text);expect(user.mention_bindings?.map(b=>b.asset_id)).toEqual(['second','first']);
  const parts=provider.messages.filter((m:any)=>m.role==='user').flatMap((m:any)=>m.content);
  const raw=parts.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('');
  const context=JSON.parse(raw.slice(raw.indexOf('\n')+1));
  const sent=context.conversation.find((m:any)=>m.role==='user');
  expect(sent.text).toBe('Move [[input2]] toward [[input1]].');
  expect(sent.mention_bindings.map((b:any)=>b.source_handle)).toEqual(['input2','input1']);
  expect(parts.filter((p:any)=>p.type==='image_url')).toHaveLength(2);
 }finally{await app.close();await chats.close();db.close();rmSync(root,{recursive:true,force:true});}
});
