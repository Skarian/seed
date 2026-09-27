import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {Chats} from '../server/chat/service.js';
import {fakePool} from './fake-pool.js';

function sse(delta:unknown,tool=false){return new Response('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:tool?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
async function idle(chats:Chats,id:string){for(let i=0;i<300;i++){const chat=chats.view(id);if(chat.activity==='idle')return chat;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Chat did not settle');}
function payload(body:any){
 const parts=body.messages.filter((m:any)=>m.role==='user').flatMap((m:any)=>Array.isArray(m.content)?m.content:[{type:'text',text:m.content}]);
 const text=parts.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('');
 return {images:parts.filter((p:any)=>p.type==='image_url'),context:JSON.parse(text.slice(text.indexOf('\n')+1))};
}

it('a follow-up after rejected create restores real images and the failed attempt, while settings-only keeps the context without images',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/retry-context-')),paths=resolvePaths(root);prepareStorage(paths);
 writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({openrouterApiKey:'fake'}));
 const db=openDatabase(paths.data);
 const pool=fakePool(db,paths).pool;
 const jobs=new Jobs(db,paths,pool),requests:any[]=[];
 const invalid={prompt:'The person in [[input1]] waves.',size:'720p',inputs:[{asset:'input1'}]};
 const chats=new Chats(db,paths,jobs,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  if(requests.length===1)return sse({tool_calls:[{index:0,id:'rejected-create',type:'function',function:{name:'create_request',arguments:JSON.stringify(invalid)}}]},true);
  return sse({content:'I could not save the request.'});
 });
 try{
  await sharp({create:{width:32,height:24,channels:3,background:'blue'}}).png().toFile(path.join(paths.data,'media/originals/person.png'));
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('person','image','Person','media/originals/person.png',JSON.stringify({mode:'sfw',state:'ready'}),'2026-01-01');
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'reference-to-video',title:'Retry fixture'});
  chats.send(chat.id,{version:chat.version,text:'Animate the person waving',assets:['person']});chat=await idle(chats,chat.id);
  expect(chat.groups.flatMap(g=>g.cards)).toEqual([]);expect(chat.messages.at(-1)!.transcript?.steps.some(s=>s.kind==='tool'&&s.state==='failed')).toBe(true);
  expect(payload(requests[0]).images).toHaveLength(1);
  const beforeRetry=requests.length;
  chats.send(chat.id,{version:chat.version,text:'Try again',assets:[]});chat=await idle(chats,chat.id);
  const retry=payload(requests[beforeRetry]);expect(retry.images).toHaveLength(1);
  expect(retry.context.images_in_order).toEqual(['person']);expect(retry.context.visual_evidence_in_order).toEqual([{asset_id:'person',type:'image'}]);
  expect(retry.context.last_attempt).toMatchObject({tool:'create_request',input:invalid,saved:false});
  expect(JSON.stringify(retry.context.last_attempt.result)).toContain('size');expect(chat.groups.flatMap(g=>g.cards)).toEqual([]);
  const beforeSecondRetry=requests.length;
  chats.send(chat.id,{version:chat.version,text:'Please try once more',assets:[]});chat=await idle(chats,chat.id);
  expect(payload(requests[beforeSecondRetry]).context.last_attempt).toMatchObject({tool:'create_request',input:invalid,saved:false});
  const beforeSettings=requests.length;
  chats.send(chat.id,{version:chat.version,text:'Set seed to 42',assets:[]});await idle(chats,chat.id);
  const settings=payload(requests[beforeSettings]);expect(settings.images).toEqual([]);expect(settings.context.images_in_order).toEqual([]);
  expect(settings.context.assets.some((a:any)=>a.id==='person')).toBe(true);
  expect(settings.context.conversation.some((m:any)=>m.text==='Set seed to 42')).toBe(true);
 }finally{await chats.close();db.close();rmSync(root,{recursive:true,force:true});}
});
