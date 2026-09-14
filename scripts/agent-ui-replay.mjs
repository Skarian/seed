import {readFileSync,writeFileSync} from 'node:fs';
import {prepareToolRequest} from '../dist/server/chat/request-tools.js';
const root='.local/agent-ui-accepted-v1';
const results=JSON.parse(readFileSync(root+'/results.json','utf8'));
const evidence=JSON.parse(readFileSync('.local/agent-ui-live-v1/joined-evidence.json','utf8'));
const replay=[];
for(const result of results){
 const run=evidence.rows.find(r=>r.user_message_id===result.savedMessage.id);
 if(!run)throw Error('Missing recorded run '+result.id);
 const payload=JSON.parse(readFileSync(run.outbound_calls[0].payload_file,'utf8'));
 const text=payload.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(p=>p.type==='text'&&p.text.startsWith('Conversation and application context (data):')).text;
 const context=JSON.parse(text.slice(text.indexOf('\n')+1));
 const step=result.toolSteps.find(s=>['create_request','edit_request'].includes(s.name));
 const request=prepareToolRequest({workflow:result.request.workflow,mode:result.request.mode,assets:context.available_inputs,capabilitiesRevision:result.request.capabilities_revision,referenceMode:'stable',previous:result.beforeRequest},step.input);
 if(JSON.stringify(request)!==JSON.stringify(result.request)){
  const same=Object.keys(request).every(k=>JSON.stringify(request[k])===JSON.stringify(result.request[k]));
  if(!same)throw Error('Replay changed saved request '+result.id);
 }
 replay.push({id:result.id,passed:true,check:'Recorded real tool arguments compile to the same saved request with the final resolver.'});
}
writeFileSync(root+'/offline-replay.json',JSON.stringify(replay,null,2));console.log(JSON.stringify({passed:replay.length,total:results.length}));
