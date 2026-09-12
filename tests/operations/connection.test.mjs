import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {connectWorker,startTunnel,workerOrigin,cancelUnusedPreparation,workerRequest} from '../../operations/connection.mjs';
import {saveJson,readJson} from '../../operations/common.mjs';

async function fixture(t){
  const config=await mkdtemp(path.join(tmpdir(),'seed-connection-'));t.after(()=>rm(config,{recursive:true,force:true}));
  const calls=[];let running=false;
  const app={paths:{config},repo:config,state:{},stateFile:path.join(config,'rental.json'),origin:'http://127.0.0.1:4310',
    lifecycle:{control:async(paths,action)=>{calls.push(['control',action]);if(action==='stop')running=false;return running?{}:null;}},
    checkPort:async()=>{},startBackground:async()=>{calls.push(['tunnel']);running=true;},
    fetcher:async(url,options)=>{
      calls.push(['fetch',url]);
      if(url.endsWith('/unlock'))return new Response('{}',{headers:{'set-cookie':'seed_unlock=test; HttpOnly'}});
      if(url.endsWith('/pairing-codes'))return Response.json({connection_code:'test-code'});
      return Response.json({});
    },
    local:async(method,route,body)=>{
      calls.push([method,route]);
      if(method==='GET')return {queue:{active:0,waiting:0},outputs:{pending:0}};
      if(route==='/api/v1/connection')await saveJson(path.join(config,'worker-connection.json'),{worker_instance_id:'worker',worker_credential:'secret',endpoint:workerOrigin});
    },
  };
  return {app,calls,config};
}

test('shared SSH bootstrap pairs without starting or resubmitting generation',async t=>{
  const {app,calls}=await fixture(t);
  assert.equal((await connectWorker(app,{ssh:['root@worker'],secret:'launch-secret'})).connected,true);
  assert.equal(app.state.paired_worker,'worker');
  assert.deepEqual(calls.filter(x=>x[0]==='PUT'),[['PUT','/api/v1/connection']]);
  assert.equal(calls.filter(x=>x[0]==='tunnel').length,1);
});
test('SSH waits for the detached supervisor to register its control endpoint',async t=>{
  const {app}=await fixture(t);let launched=false,checks=0;
  app.startBackground=async()=>{launched=true;return {exitCode:null};};
  app.lifecycle.control=async()=>launched&&++checks>1?{}:null;
  await startTunnel(app,['root@worker']);
  assert.ok(checks>=2);
});
test('SSH reconnect verifies the saved pairing before retiring old route fields',async t=>{
  const {app,calls,config}=await fixture(t);
  app.state={paired_worker:'worker',route:'tailscale',tailscale_endpoint:'http://100.100.1.2:8080',tailscale_peer:'old',instance_id:123};
  await saveJson(path.join(config,'worker-connection.json'),{worker_instance_id:'worker',endpoint:workerOrigin,worker_credential:'unchanged'});
  const saved=await readJson(path.join(config,'worker-connection.json'));
  await connectWorker(app,{reconnect:true,ssh:['root@worker']});
  assert.deepEqual(calls.filter(x=>x[0]==='POST'),[['POST','/api/v1/connection/reconnect']]);
  assert.equal(calls.filter(x=>x[0]==='tunnel').length,1);
  assert.equal(calls.some(x=>String(x[1]).includes('/unlock')),false);
  assert.deepEqual(await readJson(path.join(config,'worker-connection.json')),saved);
  assert.deepEqual(app.state,{paired_worker:'worker',instance_id:123});
});

test('failed reconnect preserves old rental metadata for diagnosis',async t=>{
  const {app,config}=await fixture(t);
  const original={paired_worker:'worker',route:'tailscale',tailscale_peer:'old',instance_id:123};
  app.state={...original};
  await saveJson(path.join(config,'worker-connection.json'),{worker_instance_id:'worker',endpoint:workerOrigin,worker_credential:'unchanged'});
  app.local=async()=>{throw Error('Unexpected worker identity');};
  await assert.rejects(connectWorker(app,{reconnect:true,ssh:['root@worker']}),/identity/);
  assert.deepEqual(app.state,original);
});

test('reconnect refuses unrelated pairing before opening any transport',async t=>{
  const {app,calls}=await fixture(t);
  app.state.paired_worker='worker';
  await assert.rejects(connectWorker(app,{reconnect:true}),/existing pairing/);
  assert.equal(calls.length,0);
});

test('worker requests remain inactive until a migrated SSH connection is verified',async t=>{
  const {app,config,calls}=await fixture(t);
  app.state.paired_worker='worker';
  for(const connection of [
    {endpoint:workerOrigin,reconnect_required:true},
    {endpoint:'http://100.100.1.2:8080'},
  ]){
    await saveJson(path.join(config,'worker-connection.json'),{...connection,worker_instance_id:'worker',worker_credential:'unchanged'});
    await assert.rejects(workerRequest(app,'/worker/v1/preparation'),/Reconnect/);
  }
  assert.equal(calls.length,0);
});
test('unused-worker cleanup requires cancellation and matching worker/workspace proof',async t=>{
  const {app,config}=await fixture(t);
  app.state.paired_worker='worker';
  await saveJson(path.join(config,'worker-connection.json'),{worker_instance_id:'worker',workspace_id:'workspace',endpoint:workerOrigin,worker_credential:'secret'});
  let proof={worker_instance_id:'worker',workspace_id:'workspace'};
  app.fetcher=async url=>Response.json(url.endsWith('/cancel')?{state:'cancelled',unused_worker:proof}:{state:'needs_source'});
  assert.equal(await cancelUnusedPreparation(app),true);
  proof={worker_instance_id:'other',workspace_id:'workspace'};
  assert.equal(await cancelUnusedPreparation(app),false);
  app.local=async()=>({queue:{active:1,waiting:0},outputs:{pending:0}});
  await assert.rejects(cancelUnusedPreparation(app),/Finish or cancel/);
  app.fetcher=async()=>{throw Error('disconnected');};
  await assert.rejects(cancelUnusedPreparation(app),/Service request failed/);
});
