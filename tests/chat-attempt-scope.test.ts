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
function context(body:any){const text=body.messages.filter((m:any)=>m.role==='user').flatMap((m:any)=>Array.isArray(m.content)?m.content:[{type:'text',text:m.content}]).filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('');return JSON.parse(text.slice(text.indexOf('\n')+1));}

it('does not resurrect an old failed request after a new attachment conversation boundary',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/attempt-scope-')),paths=resolvePaths(root);prepareStorage(paths);
 writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({openrouterApiKey:'fake'}));
 const db=openDatabase(paths.data),pool=fakePool(db,paths).pool;
 const jobs=new Jobs(db,paths,pool),requests:any[]=[];
 const chats=new Chats(db,paths,jobs,async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));
  if(requests.length===1)return sse({tool_calls:[{index:0,id:'bad-old',type:'function',function:{name:'create_request',arguments:JSON.stringify({prompt:'Old photo.',size:'720p',inputs:[{asset:'input1'}]})}}]},true);
  return sse({content:'Ready for your next instruction.'});
 });
 try{
  for(const [id,color] of [['old','blue'],['new','red']]){
   await sharp({create:{width:32,height:24,channels:3,background:color!}}).png().toFile(path.join(paths.data,`media/originals/${id}.png`));
   db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(id,'image',id,`media/originals/${id}.png`,JSON.stringify({mode:'sfw',state:'ready'}),'2026-01-01');
  }
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'reference-to-video',title:'Scope fixture'});
  chats.send(chat.id,{version:chat.version,text:'Animate this old photo.',assets:['old']});chat=await idle(chats,chat.id);
  chats.send(chat.id,{version:chat.version,text:'Different idea. Look at this new photo and wait for my scene.',assets:['new']});chat=await idle(chats,chat.id);
  const index=requests.length;
  chats.send(chat.id,{version:chat.version,text:'Now animate that new photo with a gentle camera push.',assets:[]});await idle(chats,chat.id);
  const next=context(requests[index]);expect(next.images_in_order).toEqual(['new']);
  expect(next.last_attempt).toBeUndefined();
 }finally{await chats.close();db.close();rmSync(root,{recursive:true,force:true});}
});
