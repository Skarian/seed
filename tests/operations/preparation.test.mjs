import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareWorker} from '../../operations/preparation.mjs';

const entry={path:'diffusion_models/test.bin',url:'https://huggingface.co/test/model/resolve/'+ 'a'.repeat(40)+'/test.bin',sha256:'b'.repeat(64),size:1024};
async function fixture(run){
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-prepare-'));
 const config=path.join(root,'config'); await mkdir(config);await mkdir(path.join(root,'dist/server'),{recursive:true});
 await writeFile(path.join(root,'package.json'),'{"type":"module"}');
 await writeFile(path.join(root,'dist/server/model-cache.js'),`export async function modelManifest(){return ${JSON.stringify([entry])}}`);
 await writeFile(path.join(root,'dist/server/settings.js'),'export function settings(){return {localModelCache:false}}');
 const connection={endpoint:'http://127.0.0.1:18080',worker_instance_id:'worker-one',workspace_id:'space-one',worker_credential:'private-key'};
 await writeFile(path.join(config,'worker-connection.json'),JSON.stringify(connection));
 const state={state:'waiting',revision:0,digest:null,files:[],bytes_done:0,bytes_total:1024};
 const app={repo:root,paths:{config},state:{paired_worker:'worker-one'},env:{},lifecycle:{control:async()=>({token:'controller-one',pid:123})},fetcher:async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer private-key');
  if(url.endsWith('/status'))return Response.json({...connection,protocol_version:1});
  if(options.method==='PUT'){state.state='ready';return Response.json({...state,credentials_accepted:true});}
  return Response.json(state);
 }};
 const waits=[]; const options={say:()=>{},sleep:async ms=>{waits.push(ms)}};
 try{await run({app,state,options,waits,connection,config});}finally{await rm(root,{recursive:true,force:true});}
}

test('one preparation invocation survives a lost status request without manual rerun',()=>fixture(async({app,options,waits})=>{
 const normal=app.fetcher; let lost=false;
 app.fetcher=async(url,opt)=>{if(url.endsWith('/preparation')&&!lost){lost=true;throw new TypeError('fetch failed');}return normal(url,opt);};
 assert.equal((await prepareWorker(app,options)).prepared,true); assert.ok(waits.length>0);
}));

test('a lost accepted PUT is reconciled before retry, preserving revision and intent',()=>fixture(async({app,state,options})=>{
 const normal=app.fetcher;let writes=0,readsAfterLoss=0,lost=false;
 app.fetcher=async(url,opt)=>{
  if(url.endsWith('/preparation')&&opt.method==='PUT'){
   writes++;assert.equal(JSON.parse(opt.body).revision,0);
   if(!lost){lost=true;state.state='ready';throw new TypeError('fetch failed');}
  }else if(lost&&url.endsWith('/preparation'))readsAfterLoss++;
  return normal(url,opt);
 };
 assert.equal((await prepareWorker(app,options)).prepared,true); assert.equal(writes,1);assert.ok(readsAfterLoss>0);
}));

test('cancellation revision changed during outage is never automatically undone',()=>fixture(async({app,state,options})=>{
 const normal=app.fetcher; let writes=0;
 app.fetcher=async(url,opt)=>{
  if(url.endsWith('/preparation')&&opt.method==='PUT'){writes++;state.state='cancelled';state.revision=1;throw new TypeError('fetch failed');}
  return normal(url,opt);
 };
 await assert.rejects(prepareWorker(app,options),/cancel|revision/i);assert.equal(writes,1);
}));

test('authentication failure is terminal and does not enter retry loop',()=>fixture(async({app,options,waits})=>{
 app.fetcher=async()=>new Response('',{status:401});
 await assert.rejects(prepareWorker(app,options),/401|auth/i);assert.equal(waits.length,0);
}));

test('wrong authenticated worker identity never receives the manifest',()=>fixture(async({app,options})=>{
 let writes=0; const normal=app.fetcher;
 app.fetcher=async(url,opt)=>{if(url.endsWith('/status'))return Response.json({worker_instance_id:'replacement',workspace_id:'space-one',protocol_version:1});if(opt.method==='PUT')writes++;return normal(url,opt);};
 await assert.rejects(prepareWorker(app,options),/identity|worker changed/i);assert.equal(writes,0);
}));

test('retry backoff survives more than the old tus burst and caps at 30 seconds',()=>fixture(async({app,options,waits})=>{
 const normal=app.fetcher;let failures=9;
 app.fetcher=async(url,opt)=>{if(url.endsWith('/preparation')&&failures-->0)throw new TypeError('fetch failed');return normal(url,opt);};
 assert.equal((await prepareWorker(app,options)).prepared,true);
 assert.deepEqual(waits.slice(0,9),[1000,2000,4000,8000,16000,30000,30000,30000,30000]);
}));

test('abort interrupts retry wait without another request',()=>fixture(async({app,options})=>{
 const controller=new AbortController();let calls=0;
 app.fetcher=async()=>{calls++;throw new TypeError('fetch failed');};
 options.signal=controller.signal;options.sleep=async()=>controller.abort();
 await assert.rejects(prepareWorker(app,options),{name:'AbortError'});assert.equal(calls,1);
}));

test('changed saved connection during retry never receives source credentials',()=>fixture(async({app,options,config,connection})=>{
 const normal=app.fetcher;let calls=0;
 app.fetcher=async(url,opt)=>{calls++;throw new TypeError('fetch failed');};
 options.sleep=async()=>writeFile(path.join(config,'worker-connection.json'),JSON.stringify({...connection,worker_instance_id:'replacement'}));
 await assert.rejects(prepareWorker(app,options),/connection changed/);assert.equal(calls,1);
}));

test('one invocation reopens model fallback after upload interruption and reconciles completion',()=>fixture(async({app,state,options})=>{
 const {PreparationFault}=await import('../../operations/preparation-request.mjs');
 const {manifestDigest}=await import('../../operations/preparation.mjs');
 await writeFile(path.join(app.repo,'dist/server/settings.js'),'export function settings(){return {localModelCache:true}}');
 await writeFile(path.join(app.repo,'dist/server/model-cache.js'),`export async function modelManifest(){return ${JSON.stringify([entry])}}; export async function cached(){return true}; export function modelFile(){return 'fixture.bin'}`);
 const normal=app.fetcher;let uploads=0,creates=0,firstEndpoint;
 app.fetcher=async(url,opt)=>{
  if(url.endsWith('/preparation')&&opt.method==='PUT'){
   state.digest=manifestDigest([entry]);state.state=uploads===2?'ready':'needs_source';return Response.json({...state,credentials_accepted:true});
  }
  if(url.includes('/model-uploads/')){creates++;return Response.json({ready:false});}
  return normal(url,opt);
 };
 options.upload=async(connection,endpoint)=>{uploads++;assert.equal(connection.worker_instance_id,'worker-one');if(uploads===1){firstEndpoint=endpoint;throw new PreparationFault('interrupted',true);}assert.equal(endpoint,firstEndpoint);};
 assert.equal((await prepareWorker(app,options)).prepared,true);assert.equal(uploads,2);assert.equal(creates,2);
}));

test('permanent preparation disk/validation errors do not retry',()=>fixture(async({app,options,waits})=>{
 app.fetcher=async()=>new Response('',{status:507});
 await assert.rejects(prepareWorker(app,options),/507/);assert.equal(waits.length,0);
}));

test('stopped SSH supervisor ends preparation rather than waiting forever',()=>fixture(async({app,options,waits})=>{
 let alive=true;
 app.lifecycle.control=async()=>alive?{token:'controller-one',pid:123}:null;
 app.fetcher=async()=>{alive=false;throw new TypeError('fetch failed');};
 await assert.rejects(prepareWorker(app,options),/SSH supervisor stopped/);assert.equal(waits.length,0);
}));

test('replacement SSH supervisor is not silently adopted',()=>fixture(async({app,options})=>{
 let token='controller-one';app.lifecycle.control=async()=>({token,pid:123});
 app.fetcher=async()=>{token='replacement';throw new TypeError('fetch failed');};
 await assert.rejects(prepareWorker(app,options),/supervisor changed/);
}));

test('CLI SIGINT cancels an active request and removes its temporary listeners',()=>fixture(async({app,options})=>{
 const before=process.listenerCount('SIGINT');
 app.fetcher=async(_url,{signal})=>new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  setImmediate(()=>process.emit('SIGINT'));
 });
 await assert.rejects(prepareWorker(app,options),{name:'AbortError'});
 assert.equal(process.listenerCount('SIGINT'),before);
}));

test('old connection marked for reconnect cannot start preparation',()=>fixture(async({app,options,config,connection})=>{
 await writeFile(path.join(config,'worker-connection.json'),JSON.stringify({...connection,reconnect_required:true}));
 app.fetcher=async()=>{throw Error('Must not contact worker');};
 await assert.rejects(prepareWorker(app,options),/Reconnect/);
}));
