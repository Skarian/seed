import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SeedRunpod,validatePodId} from '../../operations/runpod.mjs';
import {podEnvironment} from '../../operations/runpod-secrets.mjs';
import {saveJson} from '../../operations/common.mjs';
import {createPod,lifecycle,podRequest} from '../../operations/runpod-lifecycle.mjs';
test('RunPod defaults to global disposable storage without a template or volume',()=>{
 const config={gpu:'gpu',image:'pinned-image',disk:180,publicKey:'public-key',environment:{SEED_PAIRING_SECRET:'private'}};
 const request=podRequest(config);
 assert.equal(request.disk,180);assert.equal(request.mounts,undefined);assert.equal(request.templateId,undefined);assert.equal(request.dataCenterIds,undefined);
 assert.equal(request.env.SEED_PAIRING_SECRET,'private');
 assert.deepEqual(podRequest({...config,datacenters:['US-X']} ).dataCenterIds,['US-X']);
 assert.throws(()=>podRequest({...config,disk:10}),/150/);
});

test('RunPod create refuses unknown prices and active rentals before mutation', async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try {
  await saveJson(path.join(root,'pod-deployment.json'),{templateId:'ours',volumeId:'vol'});
  const app={paths:{config:root},api:async(route)=>route==='pods'?{pods:[]}:{dataCenter:'DC'},catalog:async()=>({gpus:[{id:'gpu',price:{secure:2}}]})};
  await assert.rejects(createPod(app,{gpu:'gpu',maxHourly:1}),/hourly limit/);
  app.state={destroyed:false};
  await assert.rejects(createPod(app,{gpu:'gpu',maxHourly:3}),/recorded/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('RunPod failed unpaired launch can be destroyed without worker access',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try {
  const calls=[];
  const app={state:{pod_id:'abc',destroyed:false},stateFile:path.join(root,'rental.json'),local:async()=>({queue:{active:0,waiting:0},outputs:{pending:0}}),api:async(route,method)=>{calls.push([route,method]);return route==='pods'?{pods:[]}:null;}};
  assert.equal((await lifecycle(app,'destroy')).disposable_disk_deleted,true);
  assert.deepEqual(calls[0],['pods/abc','DELETE']);
  assert.equal(app.state.destroyed,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pod origin cannot redirect pairing secrets',()=>{assert.equal(validatePodId('abc123'),'abc123');for(const value of ['https://other','../bad','abc:123',undefined])assert.throws(()=>validatePodId(value));});
test('pod status never prints provider environment secrets',async()=>{const app=new SeedRunpod('.');app.api=async()=>({pods:[{id:'abc',status:'RUNNING',env:{HF_TOKEN:'private'}}]});app.local=async()=>({});assert.ok(!JSON.stringify(await app.status()).includes('private'));});
test('pairing rejects an unrecorded pod even when its legacy template matches',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try{const app=new SeedRunpod('.',{fetcher:()=>{throw new Error('Must not contact worker');}});app.paths={config:root};await saveJson(path.join(root,'pod-deployment.json'),{templateId:'ours',pairingSecret:'secret'});app.api=async()=>({template:'ours'});await assert.rejects(app.connect('abc'),/recorded Seed rental/);}finally{await rm(root,{recursive:true,force:true});}
});
test('safe requires matching pod and fresh affirmative worker status',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try{const app=new SeedRunpod('.');app.paths={config:root};app.state={pod_id:'abc',paired_worker:'worker'};await saveJson(path.join(root,'worker-connection.json'),{endpoint:'http://127.0.0.1:18080',worker_instance_id:'worker'});let calls=0;app.local=async()=>{calls++;return {safe_to_terminate:null};};await assert.rejects(app.safe('other'),/not paired/);assert.equal(calls,0);await assert.rejects(app.safe('abc'),/No fresh/);app.local=async()=>({safe_to_terminate:true});assert.equal((await app.safe('abc')).safe_to_terminate,true);}finally{await rm(root,{recursive:true,force:true});}
});

test('safe pauses once and waits for asynchronous fresh status',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try {
  const app=new SeedRunpod('.');app.paths={config:root};app.state={pod_id:'abc',paired_worker:'worker'};
  await saveJson(path.join(root,'worker-connection.json'),{endpoint:'http://127.0.0.1:18080',worker_instance_id:'worker'});
  const calls=[];let reads=0;
  app.local=async(method,route)=>{calls.push([method,route]);return {safe_to_terminate:method==='GET'&&++reads===3?true:null};};
  assert.equal((await app.safe('abc',{sleep:async()=>{}})).safe_to_terminate,true);
  assert.equal(calls.filter(([method])=>method==='POST').length,1);
  assert.equal(reads,3);
 } finally {await rm(root,{recursive:true,force:true});}
});

 test('RunPod secrets are generated once and corrupt settings fail closed',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try {
  const first=podEnvironment({config:root});
  assert.match(first.SEED_PAIRING_SECRET,/^[\w-]{43}$/);
  assert.deepEqual(podEnvironment({config:root}),first);
  await saveJson(path.join(root,'pod-deployment.json'),{version:1,pairingSecret:'bad'});
  assert.throws(()=>podEnvironment({config:root}),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
 });
