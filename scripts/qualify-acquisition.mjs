// Live qualification support. Purchases and generations are performed in Seed's UI.
// This helper observes explicitly adopted test rentals and provides bounded cleanup.
import {readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync,renameSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';
import {resolvePaths} from '../dist/server/storage.js';
import {credential,storedCredentials} from '../dist/server/credential-store.js';
import {sanitize} from '../dist/server/diagnostics.js';
const paths=resolvePaths(),base=process.env.SEED_QUALIFY_BASE??'http://127.0.0.1:4310';
const root=path.resolve('.local/acquisition-qualification'),pointer=path.join(root,'current.json');
const read=f=>JSON.parse(readFileSync(f,'utf8'));
const save=(f,v)=>{writeFileSync(f+'.tmp',JSON.stringify(v,null,2)+'\n');renameSync(f+'.tmp',f);};
const clean=v=>sanitize(v,[...Object.values(storedCredentials(paths)),...(plan?.worker_ids??[]).map(id=>{
 try{return read(path.join(paths.config,'workers',id,'bootstrap.json')).pairing_secret;}catch{return '';}
})].filter(v=>typeof v==='string'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const command=process.argv[2];let dir=command==='init'?undefined:process.argv[3]&&path.isAbsolute(process.argv[3])?process.argv[3]:read(pointer).dir;
let plan=dir?read(path.join(dir,'plan.json')):null;
async function app(route,body){const r=await fetch(base+'/api/v1/'+route,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(clean(d)));return d;}
function rows(){const db=new Database(path.join(paths.data,'studio.sqlite'),{readonly:true});try{return db.prepare('SELECT snapshot_json FROM pool_workers').all().map(r=>JSON.parse(r.snapshot_json));}finally{db.close();}}
function owned(){return rows().filter(w=>plan.worker_ids.includes(w.id));}
function estimate(){return owned().reduce((n,w)=>n+(w.create_sent?Math.max(0,(Date.parse(w.released_at??new Date().toISOString())-Date.parse(w.allocated_at??w.created_at)))/3600000*w.hourly:0)+(w.create_sent?(w.offer.transfer_per_gb??0)*(w.worker_class==='video'?130:60):0),0);}
function event(operation,data={}){appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify(clean({at:new Date().toISOString(),operation,...data}))+'\n');}
async function provider(name,route,method='GET'){
 const r=await fetch((name==='vast'?'https://console.vast.ai/api/':'https://api.runpod.io/v2/')+route,{method,headers:{Authorization:'Bearer '+credential(paths,name==='vast'?'vastApiKey':'runpodApiKey')},signal:AbortSignal.timeout(20000)});
 const text=await r.text();let d;try{d=text?JSON.parse(text):{};}catch{d={message:text.slice(0,2048)};}
 if(r.status===404&&method==='GET')return null;if(!r.ok){event('audit.error',{provider:name,status:r.status,response:d});throw Error(name+' HTTP '+r.status);}return d;
}
async function inventory(){const [v,r]=await Promise.all([provider('vast','v1/instances/'),provider('runpod','pods')]);if(!Array.isArray(v?.instances)||!Array.isArray(r?.pods)||v.next_token)throw Error('Incomplete inventory; refusing ownership assumptions.');return {
 vast:v.instances.map(p=>({id:String(p.id),name:p.label,status:p.actual_status})),runpod:r.pods.map(p=>({id:p.id,name:p.name,status:p.status}))};}
async function remaining(){const inv=await inventory(),ws=owned();return Object.entries(inv).flatMap(([provider,items])=>items.filter(p=>ws.some(w=>w.provider===provider&&(w.resource?.id===p.id||p.name==='seed-'+w.id))).map(p=>({...p,provider})));}
async function cleanup(reason){event('cleanup.requested',{reason});for(const w of owned().filter(w=>w.state!=='released'))try{await app('pool/workers/'+w.id+'/actions',{action:'quit'});}catch(e){event('cleanup.app_error',{message:e.message});}
 for(let i=0;i<10;i++){const left=await remaining();if(!left.length){save(path.join(dir,'cleanup.json'),{at:new Date().toISOString(),reason,provider_absence:true,estimate:estimate(),worker_ids:plan.worker_ids});return;}
   if(i>=2)for(const p of left){event('cleanup.emergency_direct_delete',{provider:p.provider,id:p.id});await provider(p.provider,p.provider==='vast'?'v0/instances/'+p.id+'/':'pods/'+p.id,'DELETE');}
   await pause(5000);
 }throw Error('Cleanup not independently confirmed');}
if(command==='init'){
 mkdirSync(root,{recursive:true});dir=path.join(root,new Date().toISOString().replaceAll(':','-'));mkdirSync(dir);
 const current=await inventory();if(current.vast.length||current.runpod.length||rows().some(w=>w.state!=='released'))throw Error('Expected an empty pool/account before qualification.');
 plan={id:path.basename(dir),created_at:new Date().toISOString(),budget_usd:10,cleanup_at_usd:8,deadline:new Date(Date.now()+6*3600000).toISOString(),worker_ids:[],complete:false};save(path.join(dir,'plan.json'),plan);save(pointer,{dir});save(path.join(dir,'baseline.json'),current);
 const child=spawn(process.execPath,[path.resolve('scripts/qualify-acquisition.mjs'),'watch',dir],{detached:true,windowsHide:true,stdio:'ignore'});child.unref();
 for(let i=0;i<30&&!existsSync(path.join(dir,'watchdog.json'));i++)await pause(100);
 if(!existsSync(path.join(dir,'watchdog.json')))throw Error('Budget watchdog failed to start');console.log(JSON.stringify({dir,pid:child.pid,budget:10,cleanup_at:8}));
}else if(command==='resume'){
 const inv=await inventory();if(inv.vast.length||inv.runpod.length||rows().some(w=>w.state!=='released'))throw Error('Resume requires an empty pool and provider inventory');
 if(!plan.complete||estimate()>=plan.cleanup_at_usd||Date.now()>=Date.parse(plan.deadline))throw Error('Campaign cannot resume within its existing safeguards');
 plan.complete=false;save(path.join(dir,'plan.json'),plan);event('resumed',{estimate:estimate(),budget:plan.budget_usd});
 const child=spawn(process.execPath,[path.resolve('scripts/qualify-acquisition.mjs'),'watch',dir],{detached:true,windowsHide:true,stdio:'ignore'});child.unref();
 let started=false;for(let i=0;i<30;i++){await pause(100);if(read(path.join(dir,'watchdog.json')).pid===child.pid){started=true;break;}}
 if(!started){plan.complete=true;save(path.join(dir,'plan.json'),plan);throw Error('Budget watchdog failed to resume');}
 console.log(JSON.stringify({pid:child.pid,estimated_total:estimate(),budget:plan.budget_usd,cleanup_at:plan.cleanup_at_usd}));
}else if(command==='adopt'){
 const id=process.argv[3],w=rows().find(w=>w.id===id);if(!w||Date.parse(w.created_at)<Date.parse(plan.created_at))throw Error('Not a fresh campaign rental');
 if(!plan.worker_ids.includes(id))plan.worker_ids.push(id);save(path.join(dir,'plan.json'),plan);
 await app('pool/workers/'+id+'/history',{campaign:plan.id,note:'Fresh live UI acquisition qualification. No manual repairs authorized for a passing attempt.'});event('adopted',{id,provider:w.provider,rate:w.hourly});console.log(JSON.stringify({adopted:id,rate:w.hourly}));
}else if(command==='watch'){
 while(true){plan=read(path.join(dir,'plan.json'));const cost=estimate();save(path.join(dir,'watchdog.json'),{at:new Date().toISOString(),pid:process.pid,estimated_total:cost,worker_ids:plan.worker_ids});
 try{if(plan.complete){await cleanup('Campaign completed');break;}if(cost>=plan.cleanup_at_usd||Date.now()>=Date.parse(plan.deadline)){await cleanup('Budget/deadline safeguard');break;}}
 catch(e){event('watchdog.error',{message:e.message});}await pause(10000);}
}else if(command==='status'){
 const current=await app('pool');const ws=current.workers.filter(w=>plan.worker_ids.includes(w.id));const report={at:new Date().toISOString(),estimated_total:estimate(),workers:ws.map(w=>({id:w.id,provider:w.provider,gpu:w.gpu,state:w.state,phase:w.preparation?.phase,stage:w.preparation?.stage,bytes_done:w.preparation?.bytes_done,bytes_total:w.preparation?.bytes_total,rate:w.preparation?.bytes_per_second,issue:w.issue,job:w.current_job_id,activity:w.current_activity,spend:w.estimated_spend}))};save(path.join(dir,'status.json'),report);console.log(JSON.stringify(report));
}else if(command==='audit'){const inv=await inventory();save(path.join(dir,'inventory.json'),{at:new Date().toISOString(),...inv});console.log(JSON.stringify(inv));
}else if(command==='storage-audit'){
 const [v,r]=await Promise.all([provider('vast','v0/volumes?owner=me&type=all_volume'),provider('runpod','network-volumes')]);
 if(!Array.isArray(v?.volumes)||!Array.isArray(r?.networkVolumes))throw Error('Unexpected storage inventory shape; inspect privately before claiming absence');
 const result={at:new Date().toISOString(),vast:v.volumes.map(x=>({id:x.id})),runpod:r.networkVolumes.map(x=>({id:x.id}))};save(path.join(dir,'storage-inventory.json'),result);console.log(JSON.stringify(result));
}else if(command==='collect'){
 const history=await app('pool/history?from='+encodeURIComponent(plan.created_at));save(path.join(dir,'history.json'),history);
 for(const id of plan.worker_ids){let after=0,all=[];let detail;do{detail=await app('pool/workers/'+id+'/history?after='+after);all.push(...detail.events);after=detail.next_cursor;}while(after);save(path.join(dir,'worker-'+id+'.json'),{...detail,events:all});}
 save(path.join(dir,'jobs.json'),(await app('jobs')).items.filter(j=>j.created_at>=plan.created_at));console.log(JSON.stringify({collected:plan.worker_ids.length,dir}));
}else if(command==='logs'){
 const daemon=!process.argv.includes('--container');
 for(const w of owned().filter(w=>w.provider==='vast'&&w.state!=='released'&&w.provider_id)){
  const r=await fetch('https://console.vast.ai/api/v0/instances/request_logs/'+w.provider_id+'/',{method:'PUT',headers:{Authorization:'Bearer '+credential(paths,'vastApiKey'),'Content-Type':'application/json'},body:JSON.stringify({tail:'250',daemon_logs:String(daemon)}),signal:AbortSignal.timeout(20000)});
  const result=await r.json();if(!r.ok||!result.result_url)throw Error('Vast log export failed');
  let saved=false;
  for(let i=0;i<30;i++){const log=await fetch(result.result_url,{signal:AbortSignal.timeout(10000)});if(log.ok){const content=(await log.text()).split('\n').map(line=>clean(line)).join('\n');writeFileSync(path.join(dir,'provider-'+w.provider_id+(daemon?'-daemon':'-container')+'.log'),content);console.log(JSON.stringify({worker:w.id,log:content.slice(-2200)}));saved=true;break;}await pause(1000);}
  if(!saved)throw Error('Vast log export did not become available');
 }
}else if(command==='finish'){await cleanup('Campaign completed');plan.complete=true;save(path.join(dir,'plan.json'),plan);console.log(JSON.stringify({remaining:await remaining(),estimate:estimate()}));
}else throw Error('Use init, adopt ID, status, audit, collect, or finish.');
