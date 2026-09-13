import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {openDatabase,listAssets} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {Chats} from '../server/chat/service.js';
import {initializeChatPrompts,chatPromptSnapshot} from '../server/chat/prompts.js';
import type {WorkerConnection} from '../server/worker.js';
import {preserveChatLabels,validateChatReferences} from '../server/chat/references.js';
import {compactConversation} from '../server/chat/context.js';

const request={prompt:'A quiet landscape',seed:'random',count:1,output:{aspect:'16:9',size:'1mp'}};
function sse(chunk:unknown){return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
async function fixture(run:(f:{chats:Chats;jobs:Jobs;db:ReturnType<typeof openDatabase>;paths:ReturnType<typeof resolvePaths>;queue:unknown[];requests:any[];cap:any})=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/chat-')),paths=resolvePaths(root);prepareStorage(paths);
  writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({openrouterApiKey:'fake'}));
  const db=openDatabase(paths.data),queue:unknown[]=[],requests:any[]=[];
  const cap={revision:'v1',ready:true,workspace_id:'test',engine_session_id:'engine',nsfw:null};
  const worker={identity:{workspace_id:'test'},json:async()=>cap} as unknown as WorkerConnection;
  const jobs=new Jobs(db,paths,worker);
  const chats=new Chats(db,paths,jobs,async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));const ops=queue.shift();return sse({id:'fake-'+requests.length,choices:[{index:0,delta:ops?{tool_calls:[{index:0,id:'call-'+requests.length,type:'function',function:{name:'prepare_image',arguments:JSON.stringify({operations:ops})}}]}:{reasoning:'I will prepare the requested scene.',content:'Ready for review.'},finish_reason:ops?'tool_calls':'stop'}]});});
  try{await run({chats,jobs,db,paths,queue,requests,cap});}finally{await chats.close();db.close();rmSync(root,{recursive:true,force:true});}
}
async function idle(chats:Chats,id:string){for(let i=0;i<200;i++){const value=chats.view(id);if(value.activity==='idle')return value;await new Promise(r=>setTimeout(r,5));}throw Error('Agent did not settle.');}

it('holds a whole group until all decisions and submits approved requests once',async()=>fixture(async({chats,jobs,queue,requests})=>{
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'text-to-image'});
  queue.push([{operation:'create',request},{operation:'create',request:{...request,prompt:'Another landscape'}}]);
  chats.send(chat.id,{version:chat.version,text:'Two ideas',assets:[]});chat=await idle(chats,chat.id);
  expect(chat.error).toBeNull();expect(requests.every(r=>r.tools.length===1)).toBe(true);
  expect(chat.groups[0]!.after_message_id).toBe(chat.messages.filter(m=>m.role==='user').at(-1)!.id);expect(chat.messages.filter(m=>m.role==='assistant').at(-1)?.reasoning_text).toContain('I will prepare the requested scene.');const cards=chat.groups[0]!.cards;expect(cards).toHaveLength(2);expect(jobs.all()).toHaveLength(0);
  await chats.decide(chat.id,cards[0]!.id,1,'approved');expect(jobs.all()).toHaveLength(0);
  await chats.decide(chat.id,cards[1]!.id,1,'denied');expect(jobs.all()).toHaveLength(1);
  await expect(chats.decide(chat.id,cards[0]!.id,1,'approved')).rejects.toThrow();expect(jobs.all()).toHaveLength(1);
  chats.stop(chat.id);expect(jobs.all()[0]!.state).toBe('cancelled');
}));

it('rejects cross-workflow feedback and stale versions, and preserves workflow after Stop',async()=>fixture(async({chats,queue})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Image',assets:[]});c=await idle(chats,c.id);
  const card=c.groups[0]!.cards[0]!;const oldVersion=c.version;c=chats.settings(c.id,c.version,{workflow:'text-to-video'});
  expect(()=>chats.send(c.id,{version:oldVersion,text:'Hello',assets:[]})).toThrow('another tab');
  expect(()=>chats.send(c.id,{version:c.version,text:'Change it',assets:[],card_id:card.id,revision:1})).toThrow('Switch');
  c=chats.stop(c.id);expect(c.workflow).toBe('text-to-video');expect(c.groups[0]!.state).toBe('stopped');
}));

it('creates new revisions, retains sibling approvals and rejects stale edits',async()=>fixture(async({chats,queue})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request},{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Two',assets:[]});c=await idle(chats,c.id);
  const [a,b]=c.groups[0]!.cards;await chats.decide(c.id,a!.id,1,'approved');chats.revise(c.id,b!.id,1,{...request,prompt:'Changed'});
  c=chats.view(c.id);expect(c.groups[0]!.cards[0]!.revisions[0]!.decision).toBe('approved');expect(c.groups[0]!.cards[1]!.revisions.at(-1)!.decision).toBe('undecided');
  expect(()=>chats.revise(c.id,b!.id,1,request)).toThrow('changed');
  expect(()=>chats.revise(c.id,b!.id,2,{...request,mode:'nsfw'})).toThrow('mode field');
}));

it('failed later preparation admits zero jobs',async()=>fixture(async({chats,jobs,queue})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request},{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Two',assets:[]});c=await idle(chats,c.id);
  const [a,b]=c.groups[0]!.cards;await chats.decide(c.id,a!.id,1,'approved');
  const prepare=jobs.prepareSubmission.bind(jobs);let attempts=0;jobs.prepareSubmission=async(...args)=>{if(++attempts===2)throw Error('Preparation failed');return prepare(...args);};
  await chats.decide(c.id,b!.id,1,'approved');expect(jobs.all()).toHaveLength(0);expect(chats.view(c.id).error).toBe('Preparation failed');
}));

it('Stop fences preparation before atomic admission',async()=>fixture(async({chats,jobs,queue})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Image',assets:[]});c=await idle(chats,c.id);
  const prepare=jobs.prepareSubmission.bind(jobs);jobs.prepareSubmission=async(...args)=>{const result=await prepare(...args);chats.stop(c.id);return result;};
  await chats.decide(c.id,c.groups[0]!.cards[0]!.id,1,'approved');expect(jobs.all()).toHaveLength(0);expect(chats.view(c.id).groups[0]!.state).toBe('stopped');
}));

it('shipped prompt copies are editable, preserved and loaded next run',async()=>fixture(async({paths})=>{
  const directory=initializeChatPrompts(paths),file=path.join(directory,'chat/standard.md');
  const first=chatPromptSnapshot(paths,'sfw','text-to-image');writeFileSync(file,'My custom instructions');initializeChatPrompts(paths);
  const next=chatPromptSnapshot(paths,'sfw','text-to-image');expect(readFileSync(file,'utf8')).toBe('My custom instructions');expect(next.hash).not.toBe(first.hash);expect(next.system).toContain('My custom instructions');expect(first.system).not.toContain('My custom instructions');
}));

it('filters exact modes before pagination and preserves media when deleting chat',async()=>fixture(async({chats,db})=>{
  for(let i=0;i<70;i++)db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('asset-'+i,'image','Image','media/originals/'+i,JSON.stringify({mode:i<60?'nsfw':'sfw'}),String(i).padStart(4,'0'));
  expect(listAssets(db,'',50,'sfw')).toHaveLength(10);expect(listAssets(db,'',50,'nsfw')).toHaveLength(50);
  const c=chats.create('sfw');chats.delete(c.id);expect(listAssets(db,'',100)).toHaveLength(70);
}));

it('restoring an old revision keeps prior copies and requires new approval',async()=>fixture(async({chats,queue})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Image',assets:[]});c=await idle(chats,c.id);
  const card=c.groups[0]!.cards[0]!;chats.revise(c.id,card.id,1,{...request,prompt:'Second revision'});chats.stop(c.id);
  c=chats.restore(c.id,card.id,1,request);const restored=c.groups.at(-1)!.cards[0]!;expect(c.groups.at(-1)!.after_message_id).toBe(c.messages.at(-1)!.id);
  expect(restored.revisions).toHaveLength(3);expect(restored.revisions.at(-1)).toMatchObject({number:3,decision:'undecided',request:{prompt:request.prompt}});
  expect(c.groups[0]!.cards[0]!.revisions).toHaveLength(2);
}));

it('late job saves cannot erase a chat cancellation fence',async()=>fixture(async({jobs})=>{
  const result=await jobs.submit({...request,workflow:'text-to-image',mode:'sfw',capabilities_revision:'v1'},'fixture-submission-123');
  const stale=jobs.get(result.jobs[0]!.id)!;jobs.stopJobs([stale.id]);stale.error='Late transfer response';jobs.save(stale);
  expect(jobs.get(stale.id)!.state).toBe('cancelled');
}));

it('reference reordering preserves meaning and removal needs prompt correction',()=>{
  const previous:any={prompt:'<Picture 1> beside <Picture 2>',references:['a','b'].map(id=>({id,asset_id:id,kind:'image',role:'reference'}))};
  expect(preserveChatLabels(previous,{...previous,references:[...previous.references].reverse()}).prompt).toBe('<Picture 2> beside <Picture 1>');
  const removed=preserveChatLabels(previous,{...previous,references:previous.references.slice(1)});
  expect(()=>validateChatReferences(removed)).toThrow('missing reference');
});

it('Stop allows discussion while remote cancellation remains pending',async()=>fixture(async({chats,jobs,queue})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Image',assets:[]});c=await idle(chats,c.id);
  await chats.decide(c.id,c.groups[0]!.cards[0]!.id,1,'approved');const job=jobs.all()[0]!;job.state='running';jobs.save(job);
  c=chats.stop(c.id);expect(c.activity).toBe('idle');expect(jobs.get(job.id)!.state).toBe('cancel_requested');
  chats.send(c.id,{version:c.version,text:'Let us discuss the next shot',assets:[]});c=await idle(chats,c.id);expect(c.error).toBeNull();
  expect(()=>chats.delete(c.id)).toThrow('cancellation');
}));

it('compacts older dialogue while retaining recent turns and the original history',async()=>{
  const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',text:String(i)+': '+'x'.repeat(4000)}));
  let calls=0;const result=await compactConversation(history,undefined,async input=>{calls++;expect(input).toContain('earlier_messages');return 'Owner wants a blue landscape; approval must come from application state.';});
  expect(calls).toBe(1);expect(result.summary?.through).toBe(12);expect(result.recent).toEqual(history.slice(12));expect(history).toHaveLength(20);
  await compactConversation(history,result.summary,async()=>{throw Error('Should reuse summary');});
});

it('surfaces rejected tool calls even when the model falsely claims success',async()=>fixture(async({chats,jobs,queue,requests})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});
  queue.push([{operation:'create',request:{...request,seed:'puppy_snapshot_01',output:{aspect:'16:9',size:'native'}}}]);
  chats.send(c.id,{version:c.version,text:'A candid puppy photo',assets:[]});c=await idle(chats,c.id);
  expect(c.groups).toHaveLength(0);expect(jobs.all()).toHaveLength(0);
  expect(c.error).toContain('The request was not saved');
  expect(c.messages.some(m=>m.role==='event'&&m.text.includes('tool failed'))).toBe(true);
  const schema=requests[0].tools[0].function.parameters.properties.operations.items.anyOf[0].properties.request;
  expect(schema.properties.output.properties.size.const).toBe('1mp');
  expect(schema.properties.output.properties).not.toHaveProperty('duration_seconds');
  expect(schema.properties.seed.pattern).toContain('random');
}));

it('publishes incremental assistant text before the completed chat snapshot',async()=>fixture(async({chats})=>{
 const c=chats.create('sfw');const updates:any[]=[];const off=chats.subscribe(c.id,value=>updates.push(value));
 chats.send(c.id,{version:c.version,text:'Hello',assets:[]});await idle(chats,c.id);off();
 expect(updates.some(v=>v.activity==='thinking'&&v.partial==='Ready for review.')).toBe(true);
 expect(updates.at(-1)).toMatchObject({activity:'idle',partial:''});
}));

it('filters Library media type before pagination',async()=>fixture(async({db})=>{
 for(let i=0;i<60;i++)db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('kind-'+i,i===0?'video':'image','Media','media/originals/'+i,'{}',String(i).padStart(4,'0'));
 expect(listAssets(db,'',50,'sfw','video').map(a=>a.id)).toEqual(['kind-0']);
 expect(listAssets(db,'',50,'sfw','image')).toHaveLength(50);
}));
