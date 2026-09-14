#!/usr/bin/env node
/** Isolated real UI + real OpenRouter evaluation; never admits GPU work. */
import {mkdirSync,readFileSync,writeFileSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolvePaths,prepareStorage} from '../dist/server/storage.js';
import {chatCredential} from '../dist/server/chat/credentials.js';
import {Jobs} from '../dist/server/jobs.js';
import {createApp} from '../dist/server/http.js';
import {openDatabase} from '../dist/server/db.js';

const root=path.resolve(process.env.AGENT_UI_ROOT??'.local/agent-ui-live-v1');
const port=Number(process.env.AGENT_UI_PORT??4313),host='127.0.0.1';
const budget=5,maxTokens=4096,inputPrice=1,outputPrice=2;
mkdirSync(root,{recursive:true});
const lockFile=path.join(root,'server.lock');
const lock=openSync(lockFile,'wx');writeFileSync(lock,JSON.stringify({pid:process.pid}));
const ledgerFile=path.join(root,'budget.json');
const ledger=existsSync(ledgerFile)?JSON.parse(readFileSync(ledgerFile,'utf8')):{version:1,budget,calls:[]};
if(ledger.version!==1||ledger.budget!==budget||!Array.isArray(ledger.calls))throw Error('Invalid isolated ledger.');
const apiKey=chatCredential(resolvePaths());
if(!apiKey)throw Error('No installed OpenRouter credential.');
process.env.OPENROUTER_API_KEY='isolated-ui-eval-marker';
process.env.SEED_AGENT_REFERENCE_MODE='stable';
const paths=resolvePaths(path.join(root,'studio'));prepareStorage(paths);
writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({openrouterApiKey:'isolated-ui-eval-marker'}));
const save=()=>writeFileSync(ledgerFile,JSON.stringify(ledger,null,2));
const charge=()=>ledger.calls.reduce((n,c)=>n+(c.cost??c.reservation),0);
const redact=s=>s.replaceAll(apiKey,'[redacted]');
let activeCase='unassigned',halted=false;const caseChats={};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url!=='https://openrouter.ai/api/v1/chat/completions')throw Error('UI evaluation blocks external request: '+new URL(url).origin);
  const body=JSON.parse(String(init?.body));
  body.max_tokens=Math.min(body.max_tokens??maxTokens,maxTokens);
  body.provider={...body.provider,max_price:{prompt:inputPrice,completion:outputPrice}};
  const encoded=JSON.stringify(body),images=(encoded.match(/data:image\//g)??[]).length;
  const reservation=((Buffer.byteLength(encoded)+4096+images*32768)*inputPrice+body.max_tokens*outputPrice)/1e6;
  if(halted||charge()+reservation>budget||ledger.calls.length>=250)throw Error('UI evaluation budget exhausted.');
  const call={id:randomUUID(),case:activeCase,started_at:new Date().toISOString(),reservation,cost:null};
  ledger.calls.push(call);save();
  const dir=path.join(root,'calls',call.id);mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'payload.json'),redact(JSON.stringify(body,null,2)));
  const headers=new Headers(init?.headers);headers.set('Authorization','Bearer '+apiKey);
  let response;
  try{response=await nativeFetch(url,{...init,headers,body:encoded});}
  catch(error){call.error=String(error);save();throw error;}
  call.status=response.status;save();
  if(!response.body)return response;
  let raw='',pending='';const decoder=new TextDecoder();
  const observe=line=>{if(!line.startsWith('data:'))return;try{const chunk=JSON.parse(line.slice(5));if(chunk.id)call.generation_id=chunk.id;if(chunk.provider)call.provider=chunk.provider;
    for(const [to,from] of [['cost','cost'],['input_tokens','prompt_tokens'],['output_tokens','completion_tokens']])if(typeof chunk.usage?.[from]==='number'&&Number.isFinite(chunk.usage[from])&&chunk.usage[from]>=0)call[to]=chunk.usage[from];
  }catch{}};
  const stream=response.body.pipeThrough(new TransformStream({transform(bytes,controller){const text=decoder.decode(bytes,{stream:true});raw+=text;pending+=text;const lines=pending.split('\n');pending=lines.pop()??'';lines.forEach(observe);controller.enqueue(bytes);},flush(){pending+=decoder.decode();observe(pending);call.finished_at=new Date().toISOString();if((call.cost??0)>reservation||charge()>budget)halted=true;save();writeFileSync(path.join(dir,'response.sse'),redact(raw));}}));
  return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
};
// Process-local fixtures only. Real media uploads, chat services and HTTP routes remain intact.
const preset={filename:'synthetic.safetensors',sha256:'0'.repeat(64),strength_model:1,revision:'ui-eval'};
const cap={revision:'ui-eval-v1',ready:true,workspace_id:'isolated-ui',engine_session_id:'isolated-ui',nsfw:preset,video:{ready:true,nsfw:{fl:preset,ref:preset},image_export:true,native_export:true,duration_step:1,quality:{fast:true,high:true},profile_revision:'ui-eval'}};
Jobs.prototype.inspectCapabilities=async function(){this.capabilities=cap;return cap;};
Jobs.prototype.start=function(){};
for(const name of ['prepareSubmission','admitPrepared','submit'])Jobs.prototype[name]=function(){throw Error('UI_EVAL_FORBIDS_GENERATION_APPROVAL');};
const app=await createApp({paths,port,host,webRoot:path.resolve('dist/web')});
const db=openDatabase(paths.data);
app.get('/__eval/status',async()=>({root,port,case:activeCase,budget,charged:charge(),knownCost:ledger.calls.reduce((n,c)=>n+(c.cost??0),0),calls:ledger.calls,halted}));
app.post('/__eval/case',async request=>{const id=request.body?.id;if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))throw Error('Invalid case id');if(request.body.chat_id){caseChats[request.body.chat_id]=id;writeFileSync(path.join(root,'case-chats.json'),JSON.stringify(caseChats,null,2));}else activeCase=id;return {id,chat_id:request.body.chat_id??null};});
app.get('/__eval/snapshots',async()=>{const chats=db.prepare('SELECT body_json FROM chats').all().map(r=>JSON.parse(r.body_json));for(const chat of chats)for(const run of chat.runs??[])for(const accounting of run.accounting??[]){const call=ledger.calls.find(c=>c.generation_id===accounting.id);if(call){call.chat_id=chat.id;call.run_id=run.id;call.case=caseChats[chat.id]??call.case;}}save();writeFileSync(path.join(root,'snapshots.json'),redact(JSON.stringify(chats,null,2)));return chats;});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await app.close();db.close();save();closeSync(lock);unlinkSync(lockFile);}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());
await app.listen({host,port});
save();writeFileSync(path.join(root,'server.json'),JSON.stringify({pid:process.pid,url:`http://${host}:${port}`,root,isolated:true,realOpenRouter:true,gpuApproval:false,budget},null,2));
console.log(JSON.stringify({url:`http://${host}:${port}`,root,budget}));
