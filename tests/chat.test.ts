import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {openDatabase,listAssets} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {Chats} from '../server/chat/service.js';
import {initializeChatPrompts,chatPromptSnapshot} from '../server/chat/prompts.js';


import {fakePool} from './fake-pool.js';
import {preserveChatLabels,validateChatReferences} from '../server/chat/references.js';
import {compactConversation,settingsOnlyMessage} from '../server/chat/context.js';

const request={prompt:'A quiet landscape',seed:'random',count:1,output:{aspect:'16:9',size:'1mp'}};
function sse(chunk:unknown){return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
function flatRequest(r:any){const {output,count,audio,references,...rest}=r;return {...rest,...(count!==undefined?{batch_size:count}:{}),...(output?{aspect_ratio:output.aspect,size:output.size,...(output.duration_seconds!==undefined?{duration_seconds:output.duration_seconds}:{})}:{}),...(audio?{audio_output:audio.output}:{})};}
async function fixture(run:(f:{chats:Chats;jobs:Jobs;db:ReturnType<typeof openDatabase>;paths:ReturnType<typeof resolvePaths>;queue:unknown[];requests:any[];titleRequests:any[]})=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/chat-')),paths=resolvePaths(root);prepareStorage(paths);
  writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({openrouterApiKey:'fake',vastApiKey:null,runpodApiKey:null,civitaiKey:null,huggingFaceToken:null}));
  const db=openDatabase(paths.data),queue:unknown[]=[],requests:any[]=[],titleRequests:any[]=[];

  const pool=fakePool(db,paths).pool;
  const jobs=new Jobs(db,paths,pool);
  const chats=new Chats(db,paths,jobs,async(_url,init)=>{const body=JSON.parse(String(init?.body));if(JSON.stringify(body.messages[0]).includes('Generate a concise chat title')){titleRequests.push(body);return sse({choices:[{index:0,delta:{content:'Quiet Mountain Landscape'},finish_reason:'stop'}]});}requests.push(body);const ops=queue.shift();if(ops instanceof Error)throw ops;return sse({id:'fake-'+requests.length,choices:[{index:0,delta:ops?{tool_calls:(ops as any[]).map((op,index)=>({index,id:'call-'+requests.length+'-'+index,type:'function',function:{name:op.operation==='create'?'create_request':'edit_request',arguments:JSON.stringify(op.operation==='create'?flatRequest(op.request):{request_id:op.request_id,...flatRequest(op.changes??{})})}}))}:{reasoning:'I will prepare the requested scene.',content:'Ready for review.'},finish_reason:ops?'tool_calls':'stop'}]});});
  try{await run({chats,jobs,db,paths,queue,requests,titleRequests});}finally{await chats.close();db.close();rmSync(root,{recursive:true,force:true});}
}
async function idle(chats:Chats,id:string){for(let i=0;i<200;i++){const value=chats.view(id);if(value.activity==='idle')return value;await new Promise(r=>setTimeout(r,5));}throw Error('Agent did not settle.');}

it('holds a whole group until all decisions and submits approved requests once',async()=>fixture(async({chats,jobs,queue,requests})=>{
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'text-to-image'});
  queue.push([{operation:'create',request},{operation:'create',request:{...request,prompt:'Another landscape'}}]);
  chats.send(chat.id,{version:chat.version,text:'Two ideas',assets:[]});chat=await idle(chats,chat.id);
  expect(chat.error).toBeNull();expect(requests.every(r=>r.tools.length===2)).toBe(true);
  expect(chat.groups[0]!.after_message_id).toBe(chat.messages.filter(m=>m.role==='user').at(-1)!.id);expect(chat.messages.filter(m=>m.role==='assistant').at(-1)?.reasoning_text).toContain('I will prepare the requested scene.');const cards=chat.groups[0]!.cards;expect(cards).toHaveLength(2);expect(jobs.all()).toHaveLength(0);
  await chats.decide(chat.id,cards[0]!.id,1,'approved');expect(jobs.all()).toHaveLength(0);
  await chats.decide(chat.id,cards[1]!.id,1,'denied');expect(jobs.all()).toHaveLength(1);
  await expect(chats.decide(chat.id,cards[0]!.id,1,'approved')).rejects.toThrow();expect(jobs.all()).toHaveLength(1);
  chats.stop(chat.id);expect(jobs.all()[0]!.state).toBe('cancelled');
}));

it('freezes batch seeds at approval and edits a running request without cancelling it',async()=>fixture(async({chats,jobs,queue})=>{
 let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'text-to-image'});
 queue.push([{operation:'create',request:{...request,count:2}},{operation:'create',request}]);chats.send(chat.id,{version:chat.version,text:'Two requests',assets:[]});chat=await idle(chats,chat.id);
 const [first,second]=chat.groups[0]!.cards;
 chat=await chats.decide(chat.id,first!.id,1,'approved');const saved=chat.groups[0]!.cards[0]!.revisions[0]!.request.resolved_seeds!;expect(saved).toHaveLength(2);expect(jobs.all()).toHaveLength(0);
 chat=await chats.decide(chat.id,second!.id,1,'denied');expect(jobs.all().map(j=>j.seed)).toEqual(saved);
 const job=jobs.all()[0]!;job.state='running';jobs.save(job);
 chat=chats.restore(chat.id,first!.id,1,{...request,prompt:'Changed scene',count:2,note:'My note'});expect(chat.groups.at(-1)!.cards[0]!.revisions.at(-1)!.request.note).toBe('My note');expect(jobs.get(job.id)!.state).toBe('running');
 chats.stop(chat.id);
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
  await chats.decide(c.id,b!.id,1,'approved');expect(jobs.all()).toHaveLength(0);
  const failed=chats.view(c.id),savedSeeds=failed.groups[0]!.cards.flatMap(card=>card.revisions.at(-1)!.request.resolved_seeds!);
  expect(failed.groups[0]!.submission_error).toBe('Preparation failed');expect(failed.error).toBeNull();expect(failed.activity).toBe('idle');
  expect(chats.list('sfw')[0]!.error).toBe('Preparation failed');
  const retried=await chats.decide(c.id,b!.id,1,'approved');
  expect(retried.groups[0]!.submission_error).toBeUndefined();expect(retried.groups[0]!.state).toBe('released');
  expect(jobs.all().map(job=>job.seed)).toEqual(savedSeeds);
  await expect(chats.decide(c.id,b!.id,1,'approved')).rejects.toThrow();expect(jobs.all()).toHaveLength(2);
}));

it.each(['resolve','reject'])('Stop fences %s of delayed preparation without a late error',async outcome=>fixture(async({chats,jobs,queue,db})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Image',assets:[]});c=await idle(chats,c.id);
  let entered!:()=>void,finish!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
  const prepare=jobs.prepareSubmission.bind(jobs);jobs.prepareSubmission=async(...args)=>{const result=await prepare(...args);entered();await gate;if(outcome==='reject')throw Error('Late preparation failure');return result;};
  const approval=chats.decide(c.id,c.groups[0]!.cards[0]!.id,1,'approved');await started;
  const stopped=chats.stop(c.id);expect(stopped.groups[0]!.state).toBe('stopped');
  await expect(chats.decide(c.id,c.groups[0]!.cards[0]!.id,1,'approved')).rejects.toThrow();
  finish();await approval;
  const after=chats.view(c.id);expect(jobs.all()).toHaveLength(0);expect(after.groups[0]!.state).toBe('stopped');expect(after.groups[0]!.submission_error).toBeUndefined();expect(after.error).toBeNull();expect(after.activity).toBe('idle');
  expect(JSON.parse((db.prepare('SELECT body_json FROM chats WHERE id=?').get(c.id) as any).body_json).activity).toBe('idle');
}));

it('persists the preparing handoff and recovers it without automatically admitting jobs',async()=>fixture(async({chats,jobs,queue,db,paths})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request:{...request,count:2}}]);chats.send(c.id,{version:c.version,text:'Two images',assets:[]});c=await idle(chats,c.id);
  let entered!:()=>void,finish!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
  const prepare=jobs.prepareSubmission.bind(jobs);jobs.prepareSubmission=async(...args)=>{entered();await gate;return prepare(...args);};
  const card=c.groups[0]!.cards[0]!,approval=chats.decide(c.id,card.id,1,'approved');await started;
  const snapshot=(db.prepare('SELECT body_json FROM chats WHERE id=?').get(c.id) as {body_json:string}).body_json,stored=JSON.parse(snapshot);
  expect(stored.activity).toBe('preparing');expect(stored.groups[0].cards[0].revisions[0].decision).toBe('approved');expect(chats.view(c.id).activity).toBe('preparing');expect(jobs.all()).toHaveLength(0);
  await expect(chats.decide(c.id,card.id,1,'approved')).rejects.toThrow('Wait');
  // Drain the old instance, then restore the exact pre-commit bytes a new process would read.
  chats.stop(c.id);finish();await approval;jobs.prepareSubmission=prepare;
  db.prepare('UPDATE chats SET body_json=? WHERE id=?').run(snapshot,c.id);
  const restarted=new Chats(db,paths,jobs);
  try{
    const recovered=restarted.view(c.id);expect(recovered.activity).toBe('idle');expect(recovered.groups[0]!.submission_error).toContain('interrupted by server restart');expect(jobs.all()).toHaveLength(0);
    await restarted.decide(c.id,card.id,1,'approved');expect(jobs.all().map(job=>job.seed)).toEqual(stored.groups[0].cards[0].revisions[0].request.resolved_seeds);
    const afterCommit=new Chats(db,paths,jobs);try{expect(afterCommit.view(c.id).groups[0]!.cards[0]!.revisions[0]!.job_ids).toEqual(jobs.all().map(job=>job.id));await expect(afterCommit.decide(c.id,card.id,1,'approved')).rejects.toThrow();expect(jobs.all()).toHaveLength(2);}finally{await afterCommit.close();}
  }finally{await restarted.close();}
}));

it.each(['legacy','failed','all-denied','undecided'])('recovers %s review records conservatively',async state=>fixture(async({chats,jobs,queue,db,paths})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Image',assets:[]});c=await idle(chats,c.id);
  const stored=JSON.parse((db.prepare('SELECT body_json FROM chats WHERE id=?').get(c.id) as any).body_json),group=stored.groups[0];
  group.cards[0].revisions[0].decision=state==='all-denied'?'denied':state==='undecided'?'undecided':'approved';
  if(state==='failed')group.submission_error='The selected input could not be prepared.';
  stored.error='An earlier agent error';db.prepare('UPDATE chats SET body_json=? WHERE id=?').run(JSON.stringify(stored),c.id);
  const restarted=new Chats(db,paths,jobs);try{
    const recovered=restarted.view(c.id),saved=recovered.groups[0]!;expect(jobs.all()).toHaveLength(0);expect(recovered.error).toBe('An earlier agent error');
    if(state==='legacy'){expect(saved.submission_error).toBe('These approved requests did not start. Retry to continue.');expect(saved.submission_error).not.toContain('restart');}
    else if(state==='failed')expect(saved.submission_error).toBe(group.submission_error);
    else expect(saved.submission_error).toBeUndefined();
    expect(saved.state).toBe(state==='all-denied'?'released':'reviewing');
  }finally{await restarted.close();}
}));

it('clears preparation errors on new revisions and closes all-denied reviews without preparation',async()=>fixture(async({chats,jobs,queue})=>{
  let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Image',assets:[]});c=await idle(chats,c.id);
  let attempts=0;jobs.prepareSubmission=async()=>{attempts++;throw Error('Input preparation failed');};
  const card=c.groups[0]!.cards[0]!;await chats.decide(c.id,card.id,1,'approved');expect(chats.view(c.id).groups[0]!.submission_error).toBeTruthy();
  c=chats.revise(c.id,card.id,1,{...request,prompt:'Changed landscape'});expect(c.groups[0]!.submission_error).toBeUndefined();
  await expect(chats.decide(c.id,card.id,1,'approved')).rejects.toThrow();expect(attempts).toBe(1);
  await chats.decide(c.id,card.id,2,'approved');expect(chats.view(c.id).groups[0]!.submission_error).toBeTruthy();
  c=await chats.decide(c.id,card.id,2,'denied');expect(c.groups[0]!.state).toBe('released');expect(c.groups[0]!.submission_error).toBeUndefined();expect(c.activity).toBe('idle');expect(attempts).toBe(2);expect(jobs.all()).toHaveLength(0);
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
  const result=await jobs.submit({...request,workflow:'text-to-image',mode:'sfw',},'fixture-submission-123');
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
  queue.push([{operation:'create',request:{...request,seed:'puppy_snapshot_01',output:{aspect:'16:9',size:'768p'}}}]);
  chats.send(c.id,{version:c.version,text:'A candid puppy photo',assets:[]});c=await idle(chats,c.id);
  expect(c.groups).toHaveLength(0);expect(jobs.all()).toHaveLength(0);
  expect(c.error).toBeNull();expect(c.messages.at(-1)?.transcript?.state).toBe('failed');expect(c.messages.at(-1)?.transcript?.steps.some(s=>s.kind==='tool'&&s.state==='failed')).toBe(true);
  expect(c.messages.some(m=>m.role==='event'&&m.text.includes('tool failed'))).toBe(false);
  const schema=requests[0].tools[0].function.parameters;
  expect(schema.properties.size.enum).toEqual(['1mp']);
  expect(schema.properties).not.toHaveProperty('duration_seconds');
  expect(schema.properties.seed.pattern).toContain('random');
}));

it('publishes incremental assistant text before the completed chat snapshot',async()=>fixture(async({chats})=>{
 const c=chats.create('sfw');const updates:any[]=[];const off=chats.subscribe(c.id,value=>updates.push(value));
 chats.send(c.id,{version:c.version,text:'Hello',assets:[]});await idle(chats,c.id);off();
 expect(updates.some(v=>v.activity==='thinking'&&v.stream_message?.text==='Ready for review.')).toBe(true);
 expect(updates.at(-1)).toMatchObject({activity:'idle',partial:''});
}));

it('filters Library media type before pagination',async()=>fixture(async({db})=>{
 for(let i=0;i<60;i++)db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('kind-'+i,i===0?'video':'image','Media','media/originals/'+i,'{}',String(i).padStart(4,'0'));
 expect(listAssets(db,'',50,'sfw','video').map(a=>a.id)).toEqual(['kind-0']);
 expect(listAssets(db,'',50,'sfw','image')).toHaveLength(50);
}));

it('generates a title in a separate tool-free call from only the first message',async()=>fixture(async({chats,titleRequests})=>{
 let chat=chats.create('sfw');chats.send(chat.id,{version:chat.version,text:'Create a quiet mountain landscape',assets:[]});chat=await idle(chats,chat.id);
 expect(titleRequests).toHaveLength(1);expect(titleRequests[0].max_tokens).toBe(128);expect(titleRequests[0].reasoning).toEqual({enabled:false});expect(titleRequests[0].tools??[]).toHaveLength(0);
 expect(titleRequests[0].messages).toHaveLength(2);expect(JSON.stringify(titleRequests[0].messages[1])).toContain('Create a quiet mountain landscape');expect(chat.title).toBe('Quiet Mountain Landscape');
 chats.send(chat.id,{version:chat.version,text:'Now add mist',assets:[]});await idle(chats,chat.id);expect(titleRequests).toHaveLength(1);
}));
it('preserves a manual title set before the first message',async()=>fixture(async({chats,titleRequests})=>{
 let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{title:'My project'});chats.send(chat.id,{version:chat.version,text:'Create a mountain',assets:[]});chat=await idle(chats,chat.id);expect(chat.title).toBe('My project');expect(titleRequests).toHaveLength(0);
}));

it('a delayed title never overwrites a manual rename',async()=>fixture(async({db,paths,jobs})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const service=new Chats(db,paths,jobs,async(_url,init)=>{const title=String(init?.body).includes('Generate a concise chat title');if(title)await gate;return sse({choices:[{index:0,delta:{content:title?'Automatic title':'Answer'},finish_reason:'stop'}]});});
 try{let chat=service.create('sfw');service.send(chat.id,{version:chat.version,text:'First message',assets:[]});chat=await idle(service,chat.id);chat=service.settings(chat.id,chat.version,{title:'Keep this name'});release();await new Promise(resolve=>setTimeout(resolve,30));expect(service.view(chat.id).title).toBe('Keep this name');}finally{release();await service.close();}
}));

it('retries only the selected output as an unsubmitted chat review',async()=>fixture(async({chats,jobs,queue})=>{
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});
 queue.push([{operation:'create',request:{...request,count:2}}]);chats.send(c.id,{version:c.version,text:'Two images',assets:[]});c=await idle(chats,c.id);
 const card=c.groups[0]!.cards[0]!;await chats.decide(c.id,card.id,1,'approved');
 const original=jobs.all()[1]!;original.state='failed';jobs.save(original);
 c=chats.repeat(c.id,card.id,1,false,false,original.id);
 const revision=c.groups.at(-1)!.cards[0]!.revisions[0]!;
 expect(revision.request.count).toBe(1);expect(revision.request.seed).toBe(original.seed);
 expect(revision.request.resolved_seeds).toEqual([original.seed]);expect(revision.decision).toBe('undecided');expect(revision.job_ids).toEqual([]);expect(jobs.all()).toHaveLength(2);
 expect(()=>chats.repeat(c.id,card.id,1,true,false,original.id)).toThrow('Resolve or stop');
 c=chats.stop(c.id);c=chats.repeat(c.id,card.id,1,true,false,original.id);
 expect(c.groups.at(-1)!.cards[0]!.revisions[0]!.request.seed).toBe('random');
 expect(jobs.all()).toHaveLength(2);
}));

it('branches Generate into a new chat and Chat back into its original conversation',async()=>fixture(async({chats,jobs,queue})=>{
 const submitted=await jobs.submit({...request,workflow:'text-to-image',mode:'sfw',},'branch-generated-123');
 const job=submitted.jobs[0]!;const created=chats.branch([job.id],false);
 expect(created.groups[0]!.cards[0]!.revisions[0]).toMatchObject({decision:'undecided',job_ids:[],request:{count:1,seed:job.seed}});
 expect(created.workflow).toBe('text-to-image');expect(jobs.all()).toHaveLength(1);
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'An image',assets:[]});c=await idle(chats,c.id);
 await chats.decide(c.id,c.groups[0]!.cards[0]!.id,1,'approved');const fromChat=jobs.all().find(j=>j.source?.chat_id===c.id)!;
 const branched=chats.branch([fromChat.id],true);expect(branched.id).toBe(c.id);expect(branched.groups.at(-1)!.cards[0]!.revisions[0]!.request.seed).toBe('random');
 expect(()=>chats.branch([fromChat.id],true)).toThrow('Resolve or stop');expect(jobs.all()).toHaveLength(2);
}));

it('anchors replacements below replies and keeps only the latest revision approvable',async()=>fixture(async({chats,queue,jobs})=>{
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});
 queue.push([{operation:'create',request},{operation:'create',request:{...request,prompt:'Sibling'}}]);
 chats.send(c.id,{version:c.version,text:'Two scenes',assets:[]});c=await idle(chats,c.id);
 const [a,b]=c.groups[0]!.cards;const originalAnchor=a!.revisions[0]!.after_message_id;
 expect(originalAnchor).toBe(c.messages.at(-1)!.id);
 await chats.decide(c.id,b!.id,1,'approved');c=chats.view(c.id);
 queue.push([{operation:'create',request:{...request,prompt:'Updated scene'}}]);
 chats.send(c.id,{version:c.version,text:'Change this scene',assets:[],card_id:a!.id,revision:1});c=await idle(chats,c.id);
 expect(c.groups[0]!.cards).toHaveLength(2);
 const revised=c.groups[0]!.cards[0]!;expect(revised.revisions).toHaveLength(2);
 expect(revised.revisions[0]!.after_message_id).toBe(originalAnchor);
 expect(revised.revisions[1]!.after_message_id).toBe(c.messages.at(-1)!.id);
 expect(c.groups[0]!.cards[1]!.revisions[0]!.decision).toBe('approved');
 await expect(chats.decide(c.id,a!.id,1,'approved')).rejects.toThrow();
 expect(jobs.all()).toHaveLength(0);
 c=chats.revise(c.id,a!.id,2,{...request,prompt:'Manual change'});
 expect(c.groups[0]!.cards[0]!.revisions[2]!.after_message_id).toBe(c.messages.at(-1)!.id);
 await chats.decide(c.id,a!.id,3,'approved');expect(jobs.all()).toHaveLength(2);chats.stop(c.id);
}));

it('only skips images for unambiguous settings changes',()=>{
 for(const text of ['Set seed to 42','Please change the output count to 3.','Generate 2 variations','Change aspect ratio to 9:16'])expect(settingsOnlyMessage(text)).toBe(true);
 for(const text of ['Set seed to 42 and add fog','Make it brighter','What was in that picture?','Generate 2 variations of the face'])expect(settingsOnlyMessage(text)).toBe(false);
});
it('reattaches request images on follow-ups, deduplicates them, and retains settings without images',async()=>fixture(async({chats,db,paths,requests})=>{
 const sharp=(await import('sharp')).default;
 const relative='media/originals/reference.png';mkdirSync(path.dirname(path.join(paths.data,relative)),{recursive:true});
 await sharp({create:{width:4,height:4,channels:3,background:'green'}}).png().toFile(path.join(paths.data,relative));
 db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('reference','image','Reference',relative,JSON.stringify({mode:'sfw'}),'2026-01-01');
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'reference-to-video'});
 const stored=JSON.parse((db.prepare('SELECT body_json FROM chats WHERE id=?').get(c.id) as any).body_json);
 stored.assets=['reference'];stored.groups=[{id:'prior',state:'released',workflow:'reference-to-video',cards:[{id:'card',workflow:'reference-to-video',revisions:[{number:1,decision:'approved',job_ids:[],notes:{reference:'Green scene'},request:{...request,workflow:'reference-to-video',references:[{id:'ref',asset_id:'reference',kind:'image',role:'first_frame'}]}}]}]}];
 db.prepare('UPDATE chats SET body_json=? WHERE id=?').run(JSON.stringify(stored),c.id);
 const payload=()=>{const parts=requests.at(-1).messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]);const text=parts.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('');return{images:parts.filter((p:any)=>p.type==='image_url'),text};};
 chats.send(c.id,{version:c.version,text:'Add mist to the scene',assets:['reference']});c=await idle(chats,c.id);
 expect(c.error).toBeNull();expect(payload().images).toHaveLength(1);expect(payload().text).toContain('Green scene');expect(payload().text).toContain('first_frame');
 chats.send(c.id,{version:c.version,text:'Make the background darker',assets:[]});c=await idle(chats,c.id);expect(payload().images).toHaveLength(1);
 chats.send(c.id,{version:c.version,text:'Set seed to 42',assets:[]});c=await idle(chats,c.id);expect(payload().images).toHaveLength(0);expect(payload().text).toContain('Green scene');expect(payload().text).toContain('A quiet landscape');
}));

it('keeps a saved proposal reviewable when the model response times out',async()=>fixture(async({chats,queue})=>{
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});
 queue.push([{operation:'create',request}],new Error('Request timed out.'));
 chats.send(c.id,{version:c.version,text:'Create a scene',assets:[]});c=await idle(chats,c.id);
 expect(c.error).toContain('timed out');expect(c.error).not.toContain('configuration');expect(c.groups[0]!.state).toBe('reviewing');expect(c.groups[0]!.cards[0]!.revisions).toHaveLength(1);
}));
it('explains reference labels and ids instead of leaving the model to guess',async()=>fixture(async({chats,queue})=>{
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'reference-to-video'});
 // The fixture emits prepare_image, so exercise request validation directly without a paid provider call.
 expect(()=> (chats as any).request((chats as any).get(c.id),'reference-to-video',{...request,prompt:'Use <Picture 1>',output:{aspect:'16:9',size:'768p',duration_seconds:5},references:[{id:'image1',asset_id:'i',kind:'image',role:'first_frame'},{id:'video1',asset_id:'v',kind:'video',role:'reference',range:{start_seconds:0,duration_seconds:3}}]})).toThrow('input mapping');
}));

it('edits prompts with a full replacement while preserving other settings',async()=>fixture(async({chats,queue})=>{
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'A scene',assets:[]});c=await idle(chats,c.id);
 const card=c.groups[0]!.cards[0]!;
 queue.push([{operation:'revise',request_id:card.id,changes:{prompt:'A softly lit landscape'}}]);
 chats.send(c.id,{version:c.version,text:'Soften the lighting',assets:[],card_id:card.id,revision:1});c=await idle(chats,c.id);
 expect(c.groups[0]!.cards[0]!.revisions.at(-1)!.request).toMatchObject({...request,prompt:'A softly lit landscape'});
}));

it('persists the sent request snapshot independently of later revisions',async()=>fixture(async({chats,queue})=>{
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});queue.push([{operation:'create',request}]);chats.send(c.id,{version:c.version,text:'Create a scene',assets:[]});c=await idle(chats,c.id);const card=c.groups[0]!.cards[0]!;
 queue.push([{operation:'revise',request_id:card.id,expected_revision:1,changes:{prompt:'A misty landscape'}}]);chats.send(c.id,{version:c.version,text:'Add mist',assets:[],card_id:card.id,revision:1,attach_request:true});c=await idle(chats,c.id);
 const message=c.messages.filter(m=>m.role==='user').at(-1)!;expect(message.request_attachment).toMatchObject({card_id:card.id,revision:1,request:{prompt:request.prompt}});expect(c.groups[0]!.cards[0]!.revisions.at(-1)!.request.prompt).toBe('A misty landscape');
 c=chats.revise(c.id,card.id,2,{...request,prompt:'Another edit'});expect(c.messages.find(m=>m.id===message.id)!.request_attachment!.request.prompt).toBe(request.prompt);
 expect(()=>chats.send(c.id,{version:c.version,text:'Missing target',assets:[],attach_request:true})).toThrow('Choose the request');
}));

it('records rejected and successful attempts separately with exact arguments and timings',async()=>fixture(async({chats,queue,db})=>{
 let c=chats.create('sfw');c=chats.settings(c.id,c.version,{workflow:'text-to-image'});
 const invalid={...request,seed:'invalid'};
 queue.push([{operation:'create',request:invalid}],[{operation:'create',request}]);
 chats.send(c.id,{version:c.version,text:'Prepare a landscape',assets:[]});c=await idle(chats,c.id);
 const message=c.messages.at(-1)!,turn=message.transcript!,tools=turn.steps.filter(s=>s.kind==='tool');
 expect(turn.state).toBe('completed');expect(Date.parse(turn.ended_at!)).toBeGreaterThanOrEqual(Date.parse(turn.started_at));
 expect(tools.map(s=>s.state)).toEqual(['failed','succeeded']);expect(tools[0]!.input).toEqual(flatRequest(invalid));expect(tools[1]!.input).toEqual(flatRequest(request));expect(tools.every(s=>s.ended_at&&s.result)).toBe(true);
 expect(c.messages.filter(m=>m.role==='assistant')).toHaveLength(1);expect(c.messages.some(m=>m.text.includes('A request tool failed'))).toBe(false);expect(c.error).toBeNull();
 const stored=JSON.parse((db.prepare('select body_json from chats where id=?').get(c.id) as any).body_json);expect(stored.messages.at(-1).transcript).toEqual(turn);
}));

it('Chat supplies owner LoRA guidance and approves without a pricing service',async()=>fixture(async({chats,jobs,queue,requests,paths})=>{
  writeFileSync(path.join(paths.config,'loras.json'),JSON.stringify([{id:'watercolor',revision:'v1',name:'Watercolor',route:'image',availability:'all',description:'Soft landscapes. Use 0.8 to preserve detail.',default_scale:.8,trigger_words:['watercolor'],source:{provider:'civitai',model_id:5,version_id:10,file_id:20,url:'https://civitai.com/api/download/models/10',sha256:'a'.repeat(64),size_bytes:1000}},{id:'hidden',revision:'v2',name:'Private adapter',route:'image',availability:'spicy'}]));
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'text-to-image'});
  queue.push([{operation:'create',request:{...request,loras:[{id:'watercolor',revision:'v1',scale:.8}]}}]);chats.send(chat.id,{version:chat.version,text:'A watercolor landscape',assets:[]});chat=await idle(chats,chat.id);
  const context=JSON.stringify(requests[0]);expect(context).toContain('Soft landscapes. Use 0.8');expect(context).toContain('default_scale');expect(context).not.toContain('Private adapter');
  expect(chat.error).toBeNull();const card=chat.groups[0]!.cards[0]!,proposal=card.revisions[0]!.request;expect(proposal.loras).toEqual([{id:'watercolor',revision:'v1',scale:.8}]);
  expect(jobs.all()).toHaveLength(0);
  await chats.decide(chat.id,card.id,1,'approved');
  expect(jobs.all()[0]).toMatchObject({request:{loras:proposal.loras}});expect(jobs.all()[0]).not.toHaveProperty('estimate');
}));
