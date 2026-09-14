#!/usr/bin/env node
/** Headless real-agent evaluation. Dry manifest by default; never approve a job. */
import {mkdirSync,writeFileSync,readFileSync,existsSync,openSync,closeSync,unlinkSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {matrix,userText} from './agent-eval-cases.mjs';
import {createFixtures,registerFixtures,registerPhotoFixtures} from './agent-eval-fixtures.mjs';
import {registerInspectionFixture} from './agent-eval-inspection-cases.mjs';

const {values:args}=parseArgs({options:{live:{type:'boolean',default:false},smoke:{type:'boolean',default:false},
  list:{type:'boolean',default:false},paraphrase:{type:'boolean',default:false},'include-heldout':{type:'boolean',default:false},'heldout-only':{type:'boolean',default:false},'include-photos':{type:'boolean',default:false},'photos-only':{type:'boolean',default:false},
  'include-edges':{type:'boolean',default:false},'edges-only':{type:'boolean',default:false},'compatible-edges':{type:'boolean',default:false},
  'include-inspections':{type:'boolean',default:false},'inspections-only':{type:'boolean',default:false},'include-photos-v2':{type:'boolean',default:false},'photos-v2-only':{type:'boolean',default:false},
  repeats:{type:'string',default:'3'},concurrency:{type:'string',default:'4'},limit:{type:'string'},filter:{type:'string'},ids:{type:'string'},
  out:{type:'string'},ledger:{type:'string',default:'.local/agent-eval-budget.json'},budget:{type:'string',default:'10'},
  'max-input-price':{type:'string',default:'1'},'max-output-price':{type:'string',default:'2'},
  'max-tokens':{type:'string',default:'4096'},'max-calls':{type:'string',default:'1600'},
  'reference-mode':{type:'string',default:'direct'},'dist-root':{type:'string',default:'dist'},
  'turn-timeout-ms':{type:'string',default:'660000'}}});
const positive=(name,max=Infinity)=>{const n=Number(args[name]);if(!Number.isFinite(n)||n<=0||n>max)throw Error(`Invalid --${name}`);return n;};
const concurrency=positive('concurrency',8),repeats=positive('repeats',10),budget=positive('budget',10);
if(!Number.isInteger(concurrency)||!Number.isInteger(repeats))throw Error('Concurrency and repeats must be integers.');
if(args.live&&args.smoke)throw Error('Choose --live or --smoke.');
if(!['direct','stable'].includes(args['reference-mode']))throw Error('Unknown reference mode.');
process.env.SEED_AGENT_REFERENCE_MODE=args['reference-mode'];
const root=path.resolve(args.out??`.local/agent-eval-${Date.now()}-${args['reference-mode']}`);
if(existsSync(path.join(root,'manifest.json')))throw Error('Choose a fresh output directory; existing evidence is never overwritten.');
mkdirSync(root,{recursive:true});
const heldout=args['include-heldout']||args['heldout-only']?(await import('./agent-eval-heldout.mjs')).heldout:[];
const photos=args['include-photos']||args['photos-only']?(await import('./agent-eval-photo-cases.mjs')).photoCases:[];
let edges=args['include-edges']||args['edges-only']?(await import('./agent-eval-edge-cases.mjs')).edgeCases:[];
if(edges.length&&args['compatible-edges']){const {edgeRoleCasesV2}=await import('./agent-eval-edge-role-cases-v2.mjs');edges=[...edges.filter(c=>!/^edge-(reference|first_frame|last_frame)-to-(reference|first_frame|last_frame)$/.test(c.id)),...edgeRoleCasesV2];}
const inspections=args['include-inspections']||args['inspections-only']?(await import('./agent-eval-inspection-cases.mjs')).inspectionCases:[];
const photosV2=args['include-photos-v2']||args['photos-v2-only']?(await import('./agent-eval-photo-v2-cases.mjs')).photoV2Cases:[];
if(['photos-only','heldout-only','edges-only','inspections-only','photos-v2-only'].filter(key=>args[key]).length>1)throw Error('Choose only one exclusive case set.');
const available=args['inspections-only']?inspections:args['photos-v2-only']?photosV2:args['edges-only']?edges:args['photos-only']?photos:args['heldout-only']?heldout:[...matrix,...heldout,...photos,...edges,...inspections,...photosV2];
const selected=available.filter(c=>(!args.filter||c.id.includes(args.filter))&&(!args.ids||args.ids.split(',').includes(c.id))).slice(0,args.limit?positive('limit'):undefined);
if(!selected.length)throw Error('No matching scenarios.');
const schedule=selected.flatMap(scenario=>Array.from({length:repeats},(_,repetition)=>({scenario,repetition})));
const manifest={created_at:new Date().toISOString(),live:args.live,smoke:args.smoke,referenceMode:args['reference-mode'],
  repeats,concurrency,budget,caseCount:selected.length,trialCount:schedule.length,
  categories:Object.fromEntries([...new Set(available.map(c=>c.category))].map(category=>[category,available.filter(c=>c.category===category).length])),
  reasoning:true,paraphrase:args.paraphrase,scenarios:selected,distRoot:path.resolve(args['dist-root']),
  harnessHashes:Object.fromEntries(['scripts/agent-eval.mjs','scripts/agent-eval-cases.mjs','scripts/agent-eval-fixtures.mjs','scripts/agent-eval-heldout.mjs','scripts/agent-eval-photo-cases.mjs','scripts/agent-eval-edge-cases.mjs','scripts/agent-eval-inspection-cases.mjs','scripts/agent-eval-photo-v2-cases.mjs','scripts/agent-eval-edge-role-cases-v2.mjs'].map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),
  sourceHashes:Object.fromEntries(['server/chat/service.ts','server/chat/request-tools.ts','server/chat/provider.ts','server/chat/prompts.ts','server/chat/context.ts','server/chat/visual-context.ts','server/chat/read-input.ts','server/chat/references.ts','server/video.ts','server/workflows.ts','shared/reference-labels.ts',...readdirSync('prompting').filter(name=>name.endsWith('.md')).map(name=>'prompting/'+name)].map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),
  limitations:['passed means deterministic checks passed, not a human semantic verdict. Semantic prompt quality requires independent review of exact prompts and references.',
    'No request approval, GPU submission, live media, custom live prompts or live conversation history is used.',
    'Repeated variants share a rubric. Confidence intervals must account for dependence between related scenarios.']};
writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
if(!args.live&&!args.smoke){console.log(JSON.stringify({mode:'dry',root,cases:selected.length,trials:schedule.length,categories:manifest.categories,...(args.list?{ids:selected.map(c=>c.id)}:{})}));process.exit(0);}

const dist=path.resolve(args['dist-root']);
const moduleAt=async name=>import(pathToFileURL(path.join(dist,name)).href);
const [{resolvePaths,prepareStorage},{openDatabase},{Chats},{Jobs},{chatCredential},{validateChatReferences}]=await Promise.all([
  moduleAt('server/storage.js'),moduleAt('server/db.js'),moduleAt('server/chat/service.js'),moduleAt('server/jobs.js'),moduleAt('server/chat/credentials.js'),moduleAt('server/chat/references.js')]);
// Only this one credential is read from the installation, once. No owner data or custom prompt reads.
const apiKey=args.live?chatCredential(resolvePaths()):'offline-fixture';
if(args.live&&!apiKey)throw Error('Configure the authorized OpenRouter credential through Seed CLI setup first.');
// Inject the real key into the outbound request only. Isolated config stores a non-secret marker.
const originalEnvironmentKey=process.env.OPENROUTER_API_KEY;
process.env.OPENROUTER_API_KEY='isolated-agent-eval-marker';
await createFixtures(path.join(root,'fixtures'));

const ledgerFile=path.resolve(args.ledger),lockFile=ledgerFile+'.lock';let lock;
mkdirSync(path.dirname(ledgerFile),{recursive:true});
try{lock=openSync(lockFile,'wx');writeFileSync(lock,JSON.stringify({pid:process.pid,root}));}
catch{throw Error('Another evaluation owns the budget ledger. Do not run competing harness processes; inspect its lock after an interrupted process.');}
const ledger=existsSync(ledgerFile)?JSON.parse(readFileSync(ledgerFile,'utf8')):{version:1,calls:[],budget};
if(ledger.version!==1||!Array.isArray(ledger.calls))throw Error('Unrecognized budget ledger.');
ledger.budget=Math.min(ledger.budget??budget,budget);
const inputPrice=positive('max-input-price'),outputPrice=positive('max-output-price'),maxTokens=positive('max-tokens',8192),maxCalls=positive('max-calls');
let next=0;const results=[];let halted=false;
const persistLedger=()=>writeFileSync(ledgerFile,JSON.stringify(ledger,null,2));
const charged=()=>ledger.calls.reduce((sum,c)=>sum+(c.cost??c.reservation),0);
const log=value=>console.log(JSON.stringify(value));
const redact=value=>JSON.stringify(value).replaceAll(apiKey,'[redacted]');
const write=(file,value)=>writeFileSync(file,redact(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const get=(object,key)=>key.split('.').reduce((value,part)=>value?.[part],object);
const cards=chat=>chat.groups.flatMap(g=>g.cards);
const recentRequest=chat=>cards(chat).at(-1)?.revisions.at(-1)?.request;
const comparableReferences=refs=>(refs??[]).map(r=>({asset_id:r.asset_id,kind:r.kind,role:r.role,
  ...(r.kind==='image'?{framing:r.framing??'fit'}:{range:r.range,...(r.kind==='video'?{include_audio:Boolean(r.include_audio)}:{})})}));
const flatExpected=expected=>Object.entries(expected).flatMap(([key,value])=>['output','audio'].includes(key)?Object.entries(value).map(([k,v])=>[key+'.'+k,v]):[[key,value]]);
function assess(request,expected,before,scenario){
  const failures=[];
  if(!request)return {passed:false,failures:['No saved request.']};
  for(const [key,value] of flatExpected(expected)){
    const actual=key==='references'?comparableReferences(request.references):get(request,key);
    const wanted=key==='references'?comparableReferences(value):value;
    if(!same(actual,wanted))failures.push({field:key,expected:wanted,actual});
  }
  if(before){
    const changes=scenario.changes??{};
    for(const key of ['seed','count','mode','quality','output.aspect','output.size','output.duration_seconds','output.format','audio.output']){
      if(!Object.hasOwn(changes,key)&&!same(get(request,key),get(before,key)))failures.push({preservation:key,before:get(before,key),after:get(request,key)});
    }
    if(!Object.hasOwn(changes,'references')&&!same(comparableReferences(request.references),comparableReferences(before.references)))failures.push({preservation:'references'});
    if(scenario.preservePrompt&&request.prompt!==before.prompt)failures.push({preservation:'prompt'});
    if(scenario.promptMustChange&&request.prompt===before.prompt)failures.push({field:'prompt',error:'Prompt did not change.'});
  }
  try{validateChatReferences(request);}catch(error){failures.push({labels:error.message});}
  return {passed:failures.length===0,failures};
}
function expectedAfter(scenario,before){
  const expected=structuredClone(scenario.expected);
  for(const [key,value] of Object.entries(scenario.changes??{})){
    const parts=key.split('.');let target=expected;for(const part of parts.slice(0,-1))target=target[part]??={};target[parts.at(-1)]=value;
  }
  // Existing unspecified optional defaults should remain exactly what the model originally chose.
  if(before)for(const key of ['quality','audio'])if(!Object.hasOwn(expected,key)&&before[key]!==undefined)expected[key]=structuredClone(before[key]);
  return expected;
}
function summarize(){
  const groups=Object.fromEntries([...new Set(results.map(r=>r.category))].map(category=>{
    const rows=results.filter(r=>r.category===category);
    return [category,{trials:rows.length,passed:rows.filter(r=>r.passed).length,firstAttemptCorrect:rows.filter(r=>r.firstAttemptCorrect).length,prerequisiteFailed:rows.filter(r=>r.prerequisiteFailed).length}];
  }));
  const summary={root,planned:schedule.length,completed:results.length,halted,chargedOrReservedUsd:charged(),
    inputTokens:ledger.calls.reduce((s,c)=>s+(c.inputTokens??0),0),outputTokens:ledger.calls.reduce((s,c)=>s+(c.outputTokens??0),0),
    unknownTokenAccountingCalls:ledger.calls.filter(c=>c.inputTokens==null||c.outputTokens==null).length,
    knownCostUsd:ledger.calls.reduce((s,c)=>s+(c.cost??0),0),unknownAccountingCalls:ledger.calls.filter(c=>c.cost==null).length,
    budgetUsd:ledger.budget,groups,results};write(path.join(root,'results.json'),summary);return summary;
}

async function trial({scenario,repetition}){
  for(const [file,hash] of Object.entries({...manifest.sourceHashes,...manifest.harnessHashes}))if(createHash('sha256').update(readFileSync(file)).digest('hex')!==hash){halted=true;throw Error('Evaluation source changed after startup: '+file+'. Start a fresh versioned run.');}
  const trialId=scenario.id+'-r'+(repetition+1),directory=path.join(root,trialId);mkdirSync(directory,{recursive:true});
  const paths=resolvePaths(directory);prepareStorage(paths);writeFileSync(path.join(paths.config,'credentials.json'),'{"openrouterApiKey":"isolated-agent-eval-marker"}');
  const db=openDatabase(paths.data);registerFixtures(path.join(root,'fixtures'),paths,db,scenario.mode);
  await registerPhotoFixtures(scenario.photoFixtures,paths,db,scenario.mode);
  await registerInspectionFixture(scenario,paths,db);
  const preset={filename:'synthetic.safetensors',sha256:'0'.repeat(64),strength_model:1,revision:'synthetic'};
  const cap={revision:'eval-v1',ready:true,workspace_id:'isolated-eval',engine_session_id:'isolated-eval',nsfw:preset,
    video:{ready:true,nsfw:{fl:preset,ref:preset},image_export:true,native_export:true,duration_step:1,quality:{fast:true,high:true},profile_revision:'eval'}};
  const jobs=new Jobs(db,paths,{identity:{workspace_id:'isolated-eval'},json:async route=>{if(route==='/comfy/capabilities')return cap;throw Error('GPU/network operation blocked by evaluation fixture: '+route);}});jobs.capabilities=cap;
  // Any accidental admission is a harness failure, even though the worker is synthetic.
  for(const name of ['prepareSubmission','admitPrepared','submit'])if(typeof jobs[name]==='function')jobs[name]=()=>{throw Error('EVAL_FORBIDS_GENERATION_APPROVAL');};
  let phase='create';const trialCalls=[];
  const transport=async(url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(!String(url).startsWith('https://openrouter.ai/api/v1/'))throw Error('Unexpected inference URL.');
    body.max_tokens=Math.min(body.max_tokens??maxTokens,maxTokens);
    body.provider={...body.provider,max_price:{prompt:inputPrice,completion:outputPrice}};
    const encoded=JSON.stringify(body),images=(encoded.match(/data:image\//g)??[]).length;
    // UTF-8 bytes overestimate text tokens; add conservative framing and image reserves.
    const reservation=((Buffer.byteLength(encoded)+4096+images*32768)*inputPrice+body.max_tokens*outputPrice)/1e6;
    if(halted||ledger.calls.length>=maxCalls||charged()+reservation>ledger.budget){halted=true;throw Error('Evaluation budget reservation exhausted.');}
    const call={id:randomUUID(),trial:trialId,phase,started_at:new Date().toISOString(),reservation,cost:null,inputTokens:null,outputTokens:null,provider:null};
    ledger.calls.push(call);trialCalls.push(call);persistLedger();
    const payloadNumber=trialCalls.length;write(path.join(directory,`payload-${payloadNumber}.json`),body);
    const headers=new Headers(init?.headers);headers.set('Authorization','Bearer '+apiKey);
    if(args.smoke){call.cost=0;call.finished_at=new Date().toISOString();persistLedger();return new Response('data: '+JSON.stringify({id:call.id,choices:[{index:0,delta:{content:'Offline plumbing fixture; no request was proposed.'},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0,cost:0}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
    let response;
    try{response=await fetch(url,{...init,headers,body:encoded});}catch(error){call.error=error.message;persistLedger();throw error;}
    call.httpStatus=response.status;
    if(!response.body){persistLedger();return response;}
    let pending='',raw='';const decoder=new TextDecoder();
    const observe=line=>{if(!line.startsWith('data:'))return;try{const chunk=JSON.parse(line.slice(5));if(chunk.id)call.providerGenerationId=chunk.id;if(chunk.provider)call.provider=chunk.provider;
      if(!call.firstDeltaAt&&chunk.choices?.some(c=>Object.keys(c.delta??{}).some(k=>['content','reasoning','reasoning_content','tool_calls'].includes(k)))){call.firstDeltaAt=new Date().toISOString();call.firstDeltaMs=Date.now()-Date.parse(call.started_at);}
      if(chunk.usage){for(const [field,key] of [['cost','cost'],['inputTokens','prompt_tokens'],['outputTokens','completion_tokens']]){const value=chunk.usage[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)call[field]=value;}}}catch{}};
    const stream=response.body.pipeThrough(new TransformStream({transform(bytes,controller){
      const text=decoder.decode(bytes,{stream:true});raw+=text;pending+=text;const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines)observe(line);controller.enqueue(bytes);
    },flush(){pending+=decoder.decode();observe(pending);call.finished_at=new Date().toISOString();
      if(call.cost!=null&&call.cost>call.reservation){call.reservationExceeded=true;halted=true;}
      if(charged()>ledger.budget)halted=true;persistLedger();writeFileSync(path.join(directory,`response-${payloadNumber}.sse`),raw.replaceAll(apiKey,'[redacted]'));
    }}));return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  const chats=new Chats(db,paths,jobs,transport);let chat=chats.create(scenario.mode);
  chat=chats.settings(chat.id,chat.version,{workflow:scenario.workflow,title:'Evaluation '+trialId,reasoning:true});
    const result={id:trialId,category:scenario.category,repetition:repetition+1,passed:false,firstAttemptCorrect:false,semanticReview:'pending',finalSemanticRubric:scenario.finalSemanticRubric,semanticRubric:scenario.semanticRubric??[
      'The prompt fulfills the subject, action, camera and style requested in the user message.',
      'Every numbered label or stable reference token refers to the intended asset, including soundtrack identity.',
      'Edits preserve all creative details not changed by the user; settings-only edits preserve the entire prompt.',
      'The assistant claims only that a request is ready for review; no generation was approved or completed.',
    ],phases:[],calls:trialCalls};
  async function send(text,assets=[],target=false){
    chat=chats.view(chat.id);const card=cards(chat).at(-1);
    const priorRevisions=new Set(cards(chat).flatMap(c=>c.revisions.map(r=>c.id+':'+r.number)));
    const input={version:chat.version,text:userText(text,repetition,args.paraphrase),assets,
      ...(target&&card?{card_id:card.id,revision:card.revisions.at(-1).number}:{})};
    const start=Date.now();chats.send(chat.id,input);
    while(chats.view(chat.id).activity!=='idle'){
      if(Date.now()-start>positive('turn-timeout-ms')){chats.stop(chat.id);throw Error('Evaluation turn timeout.');}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    chat=chats.view(chat.id);const stored=JSON.parse(db.prepare('SELECT body_json FROM chats WHERE id=?').get(chat.id).body_json),run=stored.runs.at(-1);
    const toolResults=run?.messages?.filter(m=>m.role==='toolResult')??[];
    const requestResults=toolResults.filter(t=>['create_request','edit_request'].includes(t.toolName));
    const inspections=toolResults.filter(t=>t.toolName==='read_input').map(t=>{let metadata;try{metadata=JSON.parse(t.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'));}catch{}return {isError:Boolean(t.isError),imageCount:t.content.filter(p=>p.type==='image').length,metadata};});
    const phaseResult={phase,text:input.text,error:chat.error,elapsedMs:Date.now()-start,toolErrors:requestResults.filter(t=>t.isError),inspectionResults:inspections,
      toolCalls:run?.messages?.filter(m=>m.role==='assistant').flatMap(m=>m.content?.filter(c=>c.type==='toolCall')??[])??[],
      firstToolSucceeded:requestResults.length>0&&!requestResults[0].isError,
      firstSavedRequest:cards(chat).flatMap(c=>c.revisions.filter(r=>!priorRevisions.has(c.id+':'+r.number)).map(r=>r.request))[0],
      request:recentRequest(chat),cardCount:cards(chat).length};
    result.phases.push(phaseResult);write(path.join(directory,'snapshot-'+phase+'.json'),{chat,run});return phaseResult;
  }
  try{
    if(scenario.category==='recovery'){
      phase='invalid';const invalid=await send(`${scenario.create} Override the relevant setting with this instruction: ${scenario.invalid}`,scenario.missingInitially?[]:scenario.assets);
      result.invalidRequestNotSaved=!recentRequest(chat);phase='recovery';
      const final=await send(`${scenario.create} Final correction: ${scenario.correction}`,scenario.missingInitially?scenario.assets:[]);
      result.checks=assess(final.request,expectedAfter(scenario),undefined,scenario);
      result.passed=result.invalidRequestNotSaved&&result.checks.passed&&!final.error;
      result.firstAttemptChecks=assess(final.firstSavedRequest,expectedAfter(scenario),undefined,scenario);
      result.firstAttemptCorrect=result.passed&&final.firstToolSucceeded&&final.toolErrors.length===0&&result.firstAttemptChecks.passed;
      result.invalidPhase=invalid.error??null;
    }else{
      const initial=await send(scenario.create,scenario.assets);const initialChecks=assess(initial.request,scenario.expected,undefined,scenario);
      if(scenario.expectedInspection){
        const expected=scenario.expectedInspection;
        result.inspectionObserved=initial.inspectionResults.some(read=>!read.isError&&read.imageCount===expected.timestamps.length&&read.metadata?.asset_id===expected.asset_id&&same(read.metadata?.requested_range,{start_seconds:expected.start_seconds,duration_seconds:expected.duration_seconds})&&same(read.metadata?.visual_evidence_in_order?.map(frame=>frame.timestamp_seconds),expected.timestamps));
        const inspectionIndex=initial.toolCalls.findIndex(call=>call.name==='read_input'),saveIndex=initial.toolCalls.findIndex(call=>call.name==='create_request');
        result.inspectionBeforeRequest=inspectionIndex>=0&&saveIndex>inspectionIndex;
        if(!result.inspectionObserved||!result.inspectionBeforeRequest){initialChecks.passed=false;initialChecks.failures.push('Required pre-save read_input inspection did not return the requested timestamped frames.');}
      }
      result.initialChecks=initialChecks;
      result.initialFirstAttemptChecks=assess(initial.firstSavedRequest,scenario.expected,undefined,scenario);
      result.initialFirstAttemptCorrect=!initial.error&&initialChecks.passed&&initial.firstToolSucceeded&&initial.toolErrors.length===0&&result.initialFirstAttemptChecks.passed;
      if(!initialChecks.passed||initial.error){result.prerequisiteFailed=scenario.category!=='fresh-create';result.checks=initialChecks;}
      else if(!scenario.feedback){result.passed=true;result.firstAttemptChecks=assess(initial.firstSavedRequest,scenario.expected,undefined,scenario);result.firstAttemptCorrect=initial.firstToolSucceeded&&initial.toolErrors.length===0&&result.firstAttemptChecks.passed;}
      else{
        const before=structuredClone(initial.request);
        if(scenario.history){
          const stored=JSON.parse(db.prepare('SELECT body_json FROM chats WHERE id=?').get(chat.id).body_json);
          // Compaction retains eight messages. One giant message never exercises it.
          // Six user/assistant pairs cross the byte threshold while leaving a real older prefix.
          const pairs=scenario.longHistory?6:1,repetitions=scenario.longHistory?80:8;
          const historyText=('Unrelated planning aside: museum opening hours, tea preferences, travel packing, desk organization, and weather observations. No changes to the creative request. ').repeat(repetitions);
          for(let index=0;index<pairs;index++)stored.messages.push({id:randomUUID(),role:'user',text:`Aside ${index+1}: ${historyText}`,assets:[],created_at:new Date().toISOString()},{id:randomUUID(),role:'assistant',text:'The aside is recorded. The creative request and all supplied reference identities remain unchanged.',assets:[],created_at:new Date().toISOString()});
          result.summaryBeforeThrough=stored.summary?.through??0;
          const history=stored.messages.filter(message=>message.role!=='event').map(message=>({role:message.role,text:message.text}));
          result.compactionFixture={messages:history.length,unsummarizedBytes:JSON.stringify(history.slice(result.summaryBeforeThrough)).length};
          if(scenario.longHistory&&(history.length-result.summaryBeforeThrough<=8||result.compactionFixture.unsummarizedBytes<=60000))throw Error('Compaction fixture did not cross both message and byte thresholds.');
          db.prepare('UPDATE chats SET body_json=? WHERE id=?').run(JSON.stringify(stored),chat.id);result.syntheticHistoryBytes=historyText.length*pairs;
        }
        phase='edit';const edited=await send(scenario.feedback,[],true);
        result.checks=assess(edited.request,expectedAfter(scenario,before),before,scenario);
        if(scenario.longHistory){
          const stored=JSON.parse(db.prepare('SELECT body_json FROM chats WHERE id=?').get(chat.id).body_json);
          const summary=stored.runs.at(-1)?.summary;
          result.compactionObserved=Boolean(summary?.text?.trim()&&summary.through>result.summaryBeforeThrough);
          result.summaryAfterThrough=summary?.through??0;
          if(!result.compactionObserved){result.checks.passed=false;result.checks.failures.push('Required conversation compaction did not produce a new summary.');}
        }
        const revised=cards(chat).at(-1)?.revisions.length>1;
        result.passed=result.checks.passed&&!edited.error&&revised;
        result.firstAttemptChecks=assess(edited.firstSavedRequest,expectedAfter(scenario,before),before,scenario);
        result.editFirstAttemptCorrect=result.passed&&edited.firstToolSucceeded&&edited.toolErrors.length===0&&result.firstAttemptChecks.passed;
        result.firstAttemptCorrect=result.initialFirstAttemptCorrect&&result.editFirstAttemptCorrect;
        result.changedRequestId=cards(chat).length!==initial.cardCount;
        if(result.changedRequestId){result.passed=false;result.editFirstAttemptCorrect=false;result.firstAttemptCorrect=false;result.checks.failures.push('Created an extra card instead of editing the target.');}
      }
    }
    if(jobs.all().length)throw Error('Evaluation created generation jobs.');
  }catch(error){result.error=error.message;}
  finally{await chats.close();db.close();result.costUsd=trialCalls.reduce((sum,c)=>sum+(c.cost??0),0);result.unknownCostCalls=trialCalls.filter(c=>c.cost==null).length;write(path.join(directory,'result.json'),result);results.push(result);summarize();log({trial:trialId,passed:result.passed,firstAttemptCorrect:result.firstAttemptCorrect,costUsd:result.costUsd,error:result.error??null});}
}

try{
  await Promise.all(Array.from({length:concurrency},async()=>{while(next<schedule.length&&!halted){const index=next++;try{await trial(schedule[index]);}catch(error){
    const item=schedule[index];results.push({id:item.scenario.id+'-r'+(item.repetition+1),category:item.scenario.category,passed:false,firstAttemptCorrect:false,semanticReview:'pending',infrastructureError:error.message});summarize();log({infrastructureError:error.message,case:item.scenario.id});
  }}}));
  const summary=summarize();log({done:true,root,completed:results.length,planned:schedule.length,chargedOrReservedUsd:summary.chargedOrReservedUsd,groups:summary.groups});
}finally{
  persistLedger();if(lock!==undefined)closeSync(lock);unlinkSync(lockFile);
  if(originalEnvironmentKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalEnvironmentKey;
}
