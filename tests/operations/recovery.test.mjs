import test from 'node:test';
import assert from 'node:assert/strict';
import { SeedVast } from '../../operations/vast.mjs';
import { waitFor } from '../../operations/wait.mjs';
import {requestJson} from '../../operations/common.mjs';
import {vastLogs} from '../../operations/vast-logs.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Vast logs wait for export, redact secrets and preserve collection failures',async()=>{
 const work=await mkdtemp(path.join(os.tmpdir(),'seed-log-test-'));
 try {
  let attempts=0;
  const app={state:{instance_id:123},work,env:{},credentials:async()=>({vastApiKey:'private-test-key'}),secretFile:()=>path.join(work,'missing.json'),
   api:async(method,route)=>{assert.equal(route,'/api/v0/instances/request_logs/123/');return {success:true,result_url:'https://s3.amazonaws.com/vast.ai/test.log'};},
   fetcher:async()=>++attempts===1?new Response('',{status:403}):new Response('sshd: no hostkeys available\ntoken=private-test-key')};
  const result=await vastLogs(app,{sleep:async()=>{}});
  assert.equal(attempts,2);assert.match(result.lines[0],/no hostkeys/);
  assert.ok(!(await readFile(result.file,'utf8')).includes('private-test-key'));
  app.fetcher=async()=>new Response('',{status:500});
  await assert.rejects(vastLogs(app),/diagnostic saved/);
 }finally{await rm(work,{recursive:true,force:true});}
});

test('provider errors retain diagnosis and redact submitted secrets and signed URLs',async()=>{
 await assert.rejects(requestJson('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer private-test-key'},body:{env:{SEED_PAIRING_SECRET:'private-pairing-value'}},fetcher:async()=>new Response(JSON.stringify({detail:'Invalid disk field. private-test-key private-pairing-value https://example.com?token=secret',errors:[{field:'disk',value:'must not echo'}]}),{status:422,headers:{'retry-after':'5'}})}),error=>{
  assert.match(error.message,/Invalid disk/);
  assert.ok(!error.message.includes('private-test'));
  assert.ok(!error.message.includes('private-pairing'));
  assert.ok(!error.message.includes('?token'));
  assert.deepEqual(error.provider.fields,['disk']);return true;
 });
});

test('uncertain rental requires two separated absence observations', async () => {
  const app = new SeedVast('.');
  app.state = { destroyed: false };
  app.instances = async () => [];
  app.saveState = async () => {};
  assert.equal((await app.reconcile()).reconciled, false);
  assert.equal((await app.reconcile()).reconciled, false);
  assert.equal(app.state.destroyed, false);
  app.state.absent_since = new Date(Date.now() - 31000).toISOString();
  assert.equal((await app.reconcile()).reconciled, true);
  assert.equal(app.state.destroyed, true);
});

test('uncertain rental never clears state while an unidentified instance exists', async () => {
  const app = new SeedVast('.');
  app.state = { destroyed: false, absent_since: new Date(0).toISOString() };
  app.instances = async () => [{ id: 123 }];
  app.saveState = async () => {};
  await assert.rejects(app.reconcile(), /Uncertain rental/);
  assert.equal(app.state.destroyed, false);
  assert.equal(app.state.absent_since, undefined);
});

test('an explicit wait deadline is respected when a caller supplies one', async () => {
  let time = 0, calls = 0;
  const options = { timeout: 10, interval: 5, sleep: async n => { time += n; }, now: () => time, say: () => {} };
  assert.equal(await waitFor(async () => ++calls === 2 ? 'ready' : null, options), 'ready');
  time = 0;
  await assert.rejects(waitFor(async () => null, options), /timed out/);
  assert.equal(time, 10);
});

test('default startup wait continues beyond eight minutes with elapsed progress',async()=>{
  let time=0;const messages=[];
  const ready=await waitFor(async()=>time>=540000?'ready':null,{sleep:async n=>{time+=n;},now:()=>time,say:message=>messages.push(message)});
  assert.equal(ready,'ready');assert.equal(time,540000);
  assert.ok(messages.some(message=>message.includes('480s elapsed')));
  assert.ok(messages.every(message=>!message.includes('NaN')));
});

test('startup wait still propagates a reported failure immediately',async()=>{
  await assert.rejects(waitFor(async()=>{throw Error('Provider startup failed');}),/Provider startup failed/);
  const app=new SeedVast('.');app.current=async()=>({actual_status:'error'});
  await assert.rejects(app.wait(),/Vast startup failed/);
});

test('Vast readiness requires a successful SSH command, not just running status and ports',async()=>{
 const app=new SeedVast('.');app.key='key';app.knownHosts='hosts';
 app.current=async()=>({id:123,actual_status:'running',public_ipaddr:'127.0.0.1',ports:{'22/tcp':[{HostPort:'2222'}]}});
 let time=0,calls=0;
 const options={timeout:10,interval:5,sleep:async n=>{time+=n;},now:()=>time,say:()=>{}};
 const ready=await app.wait({...options,probe:async(command,args)=>{assert.equal(command,'ssh');assert.equal(args.at(-1),'true');if(++calls===1)throw Error('Connection refused');}});
 assert.equal(ready.instance_id,123);assert.equal(calls,2);
 time=0;await assert.rejects(app.wait({...options,probe:async()=>{throw Error('Connection refused');}}),/timed out/);
});


test('Vast readiness stops immediately for terminal SSH authentication errors',async()=>{
 const {SshFailure}=await import('../../operations/ssh.mjs');
 const app=new SeedVast('.');app.key='key';app.knownHosts='hosts';
 app.current=async()=>({id:123,actual_status:'running',public_ipaddr:'127.0.0.1',ports:{'22/tcp':[{HostPort:'2222'}]}});
 let probes=0;
 await assert.rejects(app.wait({probe:async()=>{probes++;throw new SshFailure('SSH could not authenticate.',true);},sleep:async()=>{throw Error('Must not retry');}}),/authenticate/);
 assert.equal(probes,1);
});
