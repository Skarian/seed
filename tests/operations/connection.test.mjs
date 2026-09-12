import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {connectWorker,startTunnel,workerOrigin,cancelUnusedPreparation} from '../../operations/connection.mjs';
import {enrollmentKey,tailscaleOrigin} from '../../operations/tailscale.mjs';
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
test('Tailscale reconnect needs neither SSH nor a new enrollment key',async t=>{
  const {app,calls,config}=await fixture(t);
  app.state={paired_worker:'worker',route:'tailscale',tailscale_endpoint:'http://100.100.1.2:8080'};
  await saveJson(path.join(config,'worker-connection.json'),{worker_instance_id:'worker',endpoint:app.state.tailscale_endpoint,worker_credential:'unchanged'});
  const saved=await readJson(path.join(config,'worker-connection.json'));
  await connectWorker(app,{reconnect:true,ssh:()=>{throw Error('Must not require SSH');}});
  assert.deepEqual(calls.filter(x=>x[0]==='PUT'),[['PUT','/api/v1/connection/route']]);
  assert.equal(calls.some(x=>x[0]==='fetch'||x[0]==='tunnel'),false);
  assert.deepEqual(await readJson(path.join(config,'worker-connection.json')),saved);
});
test('reconnect refuses unrelated pairing before opening any transport',async t=>{
  const {app,calls}=await fixture(t);
  app.state.paired_worker='worker';
  await assert.rejects(connectWorker(app,{reconnect:true}),/existing pairing/);
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
test('enrollment issues only a one-use ephemeral worker-tag key',async t=>{
  const {config}=await fixture(t);const calls=[];
  const key=await enrollmentKey({config},{env:{TAILSCALE_CLIENT_ID:'fixture',TAILSCALE_CLIENT_SECRET:'secret'},fetcher:async(url,options)=>{
    calls.push([url,options]);return Response.json(url.endsWith('/token')?{access_token:'temporary'}:{key:'tskey-auth-fixture'});
  }});
  assert.equal(key,'tskey-auth-fixture');
  assert.equal(calls[0][1].body.get('scope'),'auth_keys');assert.equal(calls[0][1].body.get('tags'),'tag:seed-worker');
  assert.deepEqual(JSON.parse(calls[1][1].body).capabilities.devices.create,{reusable:false,ephemeral:true,preauthorized:true,tags:['tag:seed-worker']});
  assert.equal(JSON.parse(calls[1][1].body).expirySeconds,600);
  assert.equal(tailscaleOrigin('100.100.1.2'),'http://100.100.1.2:8080');
  for(const ip of ['127.0.0.1','100.128.1.2','100.63.1.2','100.100.1.2:8080'])assert.throws(()=>tailscaleOrigin(ip));
});
