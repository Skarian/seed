#!/usr/bin/env node
/** Join UI requests, transcript tool events and real outbound calls by provider generation id. */
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.local/agent-ui-live-v1');
const read=(name,fallback)=>existsSync(path.join(root,name))?JSON.parse(readFileSync(path.join(root,name),'utf8')):fallback;
let snapshots;
try{
  const server=read('server.json',{});
  const response=await fetch((server.url??'http://127.0.0.1:4313')+'/__eval/snapshots',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Snapshots HTTP '+response.status);
  snapshots=await response.json();
}catch(error){snapshots=read('snapshots.json',null);if(!snapshots)throw error;}
const ledger=read('budget.json',{calls:[]}),cases=read('case-chats.json',{});
const matched=new Set(),rows=[];
const browserRoot=path.resolve(process.argv[3]??'.local/agent-ui-browser-v1');
const caseByMessage=new Map();
if(existsSync(browserRoot))for(const dir of readdirSync(browserRoot)){
  const file=path.join(browserRoot,dir,'result.json');if(!existsSync(file))continue;
  const result=JSON.parse(readFileSync(file,'utf8'));if(result.savedMessage?.id)caseByMessage.set(result.savedMessage.id,result.id);
}
function mediaEvidence(call){
  if(!call)return null;
  const file=path.join(root,'calls',call.id,'payload.json');
  if(!existsSync(file))return {error:'Payload unavailable',call_id:call.id};
  const payload=JSON.parse(readFileSync(file,'utf8'));
  const parts=(payload.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]);
  const text=parts.find(p=>p.type==='text'&&p.text?.startsWith('Conversation and application context (data):\n'))?.text;
  let context={};try{if(text)context=JSON.parse(text.slice(text.indexOf('\n')+1));}catch{}
  const images=parts.filter(p=>p.type==='image_url');
  return {call_id:call.id,image_parts:images.length,encoded_images:images.filter(p=>p.image_url?.url?.startsWith('data:image/')).length,
    audio_parts:parts.filter(p=>['input_audio','audio','audio_url'].includes(p.type)).length,
    assets:(context.assets??[]).map(a=>({id:a.id,name:a.name,kind:a.kind,duration_seconds:a.metadata?.duration_seconds})),
    visual_evidence_in_order:context.visual_evidence_in_order??[],video_evidence_note:context.video_evidence_note??null,
    unavailable_inputs:context.unavailable_inputs??[]};
}
for(const chat of snapshots){
  for(const run of chat.runs??[]){
    const ids=new Set((run.accounting??[]).map(a=>a.id).filter(Boolean));
    const calls=ledger.calls.filter(c=>ids.has(c.generation_id));
    calls.forEach(c=>matched.add(c.id));
    const assistant=chat.messages.find(m=>m.id===run.id&&m.role==='assistant');
    const userIndex=chat.messages.findIndex(m=>m.id===run.id);
    const user=[...chat.messages.slice(0,userIndex)].reverse().find(m=>m.role==='user');
    const results=(run.messages??[]).filter(m=>m.role==='toolResult');
    const submits=results.filter(m=>['create_request','edit_request'].includes(m.toolName));
    const steps=assistant?.transcript?.steps??[];
    rows.push({case:caseByMessage.get(user?.id)??calls.find(c=>c.case!=='unassigned')?.case??cases[chat.id]??null,chat_id:chat.id,run_id:run.id,state:run.state,
      user_message_id:user?.id,user_text:user?.text,mention_bindings:user?.mention_bindings??[],source_assets:run.source_assets,
      final_text:assistant?.text,transcript_steps:steps,raw_messages:run.messages,
      tool_results:results.map(m=>({name:m.toolName,call_id:m.toolCallId,error:m.isError===true,content:m.content,details:m.details})),
      first_request_tool_succeeded:submits.length?submits[0].isError!==true:null,
      request_tool_errors:submits.filter(m=>m.isError===true).length,
      first_payload_media:mediaEvidence(calls[0]),
      outbound_calls:calls.map(c=>({...c,payload_file:path.join(root,'calls',c.id,'payload.json'),response_file:path.join(root,'calls',c.id,'response.sse')})),
      accounted_generations:[...ids],unmatched_accounting:[...ids].filter(id=>!calls.some(c=>c.generation_id===id)),
      saved_revisions:chat.groups.flatMap(g=>g.cards).flatMap(card=>card.revisions.filter(rev=>rev.run_id===run.id).map(rev=>({card_id:card.id,...rev})))
    });
  }
  // Background title requests are outside agent runs, but still count toward spend.
  for(const account of chat.title_accounting??[]){const call=ledger.calls.find(c=>c.generation_id===account.id);if(call){matched.add(call.id);call.chat_id=chat.id;call.case=cases[chat.id]??call.case;call.purpose='title';}}
}
const report={created_at:new Date().toISOString(),root,rows,unmatched_calls:ledger.calls.filter(c=>!matched.has(c.id)),
  known_cost:ledger.calls.reduce((n,c)=>n+(c.cost??0),0),reserved_or_charged:ledger.calls.reduce((n,c)=>n+(c.cost??c.reservation),0)};
writeFileSync(path.join(root,'joined-evidence.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({runs:rows.length,cases:rows.map(r=>({case:r.case,state:r.state,first_request_tool_succeeded:r.first_request_tool_succeeded,request_tool_errors:r.request_tool_errors,call_count:r.outbound_calls.length,transcript_steps:r.transcript_steps.length,unmatched_accounting:r.unmatched_accounting})),unmatched_calls:report.unmatched_calls.length,known_cost:report.known_cost}));
