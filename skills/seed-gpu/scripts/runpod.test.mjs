import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SeedRunpod,podOrigin} from './runpod.mjs';
import {saveJson} from './seed-vast.mjs';
test('pod origin cannot redirect pairing secrets',()=>{assert.equal(podOrigin('abc123'),'https://abc123-8080.proxy.runpod.net');for(const value of ['https://other','../bad','abc:123',undefined])assert.throws(()=>podOrigin(value));});
test('pod status never prints provider environment secrets',async()=>{const app=new SeedRunpod('.');app.api=async()=>({pods:[{id:'abc',status:'RUNNING',env:{HF_TOKEN:'private'}}]});app.local=async()=>({});assert.ok(!JSON.stringify(await app.status()).includes('private'));});
test('pairing rejects a pod outside saved Seed template before contacting worker',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try{const app=new SeedRunpod('.',{fetcher:()=>{throw new Error('Must not contact worker');}});app.paths={config:root};await saveJson(path.join(root,'pod-deployment.json'),{templateId:'ours',pairingSecret:'secret'});app.api=async()=>({template:'other'});await assert.rejects(app.connect('abc'),/private Seed template/);}finally{await rm(root,{recursive:true,force:true});}
});
test('safe requires matching pod and fresh affirmative worker status',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try{const app=new SeedRunpod('.');app.paths={config:root};await saveJson(path.join(root,'worker-connection.json'),{endpoint:podOrigin('abc')});let calls=0;app.local=async()=>{calls++;return {safe_to_terminate:null};};await assert.rejects(app.safe('other'),/not paired/);assert.equal(calls,0);await assert.rejects(app.safe('abc'),/No fresh/);app.local=async()=>({safe_to_terminate:true});assert.equal((await app.safe('abc')).safe_to_terminate,true);}finally{await rm(root,{recursive:true,force:true});}
});

test('pairing exchanges the code locally without returning credentials',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-runpod-'));
 try{
  const fetched=[];const local=[];
  const app=new SeedRunpod('.',{fetcher:async(url,options)=>{fetched.push({url,options});return url.endsWith('/unlock')?new Response('{}',{headers:{'Set-Cookie':'seed_unlock=private; Path=/worker/v1'}}):new Response(JSON.stringify({connection_code:'private-code'}));}});
  app.paths={config:root};app.origin='http://127.0.0.1:4310';
  await saveJson(path.join(root,'pod-deployment.json'),{templateId:'ours',pairingSecret:'secret'});
  app.api=async()=>({template:'ours'});app.local=async(method,route,body)=>{local.push({method,route,body});return {queue:{active:0,waiting:0},outputs:{pending:0}};};
  const result=await app.connect('abc');
  assert.equal(fetched[0].url,podOrigin('abc')+'/worker/v1/unlock');
  assert.equal(fetched[1].options.headers.Cookie,'seed_unlock=private');
  assert.deepEqual(local[1],{method:'PUT',route:'/api/v1/connection',body:{connection_code:'private-code'}});
  assert.deepEqual(result,{connected:true,pod_id:'abc',url:app.origin});
 }finally{await rm(root,{recursive:true,force:true});}
});
