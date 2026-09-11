import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
import {SeedVast,validateOffer,safeShutdown,workerOrigin,sshArgs,run,freePort,main} from '../scripts/vast.mjs';

import {assertIdle,requestJson,saveJson,readJson} from '../scripts/common.mjs';

const idle={queue:{active:0,waiting:0},outputs:{pending:0}};
test('shutdown refuses a different worker before sending requests',async()=>{
  let calls=0;await assert.rejects(safeShutdown({paired_worker:'one'},{worker_instance_id:'two',endpoint:workerOrigin},async()=>{calls++;}),/not paired/);assert.equal(calls,0);
});
test('shutdown pauses and waits for fresh confirmation, never treats null as safe',async()=>{
  const calls=[];let checked=0;
  await safeShutdown({paired_worker:'one'},{worker_instance_id:'one',endpoint:workerOrigin},async(method,route)=>{
    calls.push([method,route]);return {safe_to_terminate:route.endsWith('studio')&&++checked>1?true:null};
  },{sleep:async()=>{}});
  assert.deepEqual(calls,[['POST','/api/v1/queue/pause'],['GET','/api/v1/studio'],['GET','/api/v1/studio']]);
});
test('shutdown times out without accepting an unverified state',async()=>{
  await assert.rejects(safeShutdown({paired_worker:'one'},{worker_instance_id:'one',endpoint:workerOrigin},async()=>({safe_to_terminate:null}),{sleep:async()=>{},attempts:2}),/No fresh/);
});
test('pending work and incomplete local responses block teardown',()=>{
  assert.doesNotThrow(()=>assertIdle(idle));
  for(const s of [null,{}, {...idle,outputs:{pending:1}}, {...idle,queue:{active:0,waiting:1}}])assert.throws(()=>assertIdle(s));
});
test('rental rejects missing price, nonfinite limits, multiple GPUs and hardware changes',()=>{
  const offer={num_gpus:1,dph_total:1.45,gpu_name:'RTX PRO 6000 WS'};
  validateOffer(offer,offer,1.45);
  for(const limit of [NaN,Infinity,0,1])assert.throws(()=>validateOffer(offer,offer,limit));
  for(const change of [{dph_total:null},{dph_total:NaN},{dph_total:-1},{num_gpus:2},{gpu_name:'A100'}])assert.throws(()=>validateOffer({...offer,...change},offer,2));
});
test('HTTP keeps auth/body and rejects redirects; service errors never print response secrets',async()=>{
  let sent;
  const result=await requestJson('https://example.invalid/test/',{method:'POST',body:{value:42},headers:{Authorization:'Bearer fake'},fetcher:async(url,options)=>{sent=options;return new Response('{"ok":true}');}});
  assert.equal(result.ok,true);assert.equal(sent.redirect,'error');assert.equal(sent.headers.Authorization,'Bearer fake');assert.deepEqual(JSON.parse(sent.body),{value:42});
  await assert.rejects(requestJson('https://example.invalid/',{fetcher:async()=>new Response('private-token',{status:403})}),e=>e.message.includes('403')&&!e.message.includes('private-token'));
});
test('SSH preserves paths with spaces as arguments and rejects invalid network addresses',()=>{
  const instance={public_ipaddr:'127.0.0.1',ports:{'22/tcp':[{HostPort:'40395'}]}};
  const args=sshArgs(instance,'/a path/my key','/a path/known hosts');
  assert.equal(args[1],'/a path/my key');assert.ok(args.includes('UserKnownHostsFile=/a path/known hosts'));
  assert.throws(()=>sshArgs({...instance,public_ipaddr:'host; command'},'key','hosts'));
});
test('subprocess passes empty and special arguments literally, without a shell',async()=>{
  const values=['','a path with spaces','$(not-a-command)','"quoted"'];
  const output=await run(process.execPath,['-e','console.log(JSON.stringify(process.argv.slice(1)))',...values]);
  assert.deepEqual(JSON.parse(output),values);
});
test('private JSON roundtrips and preserves restrictive POSIX modes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'seed-vast-'));
  try{const file=path.join(root,'private','state.json');await saveJson(file,{fake:'test'});assert.deepEqual(await readJson(file),{fake:'test'});if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);}
  finally{await rm(root,{recursive:true,force:true});}
});
test('occupied tunnel port is rejected',async()=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await assert.rejects(freePort(server.address().port),/occupied/);}finally{await new Promise(resolve=>server.close(resolve));}
});
test('doctor explains missing build on a clean checkout',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'seed-vast-'));
  try{const result=await main(['doctor','--repo',root]);assert.equal(result.built,false);assert.match(result.next,/npm run build/);}
  finally{await rm(root,{recursive:true,force:true});}
});
test('ambiguous rental is journaled and cannot allocate again on retry',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'seed-vast-'));
  try{
    const ops=new SeedVast(root);ops.image='ghcr.io/example/worker@sha256:'+ 'a'.repeat(64);ops.work=path.join(root,'work');ops.privateDir=path.join(root,'private');ops.key=path.join(ops.privateDir,'key');ops.stateFile=path.join(ops.work,'state.json');
    await saveJson(ops.key,{});await saveJson(ops.key+'.pub',{});
    const offer={id:42,machine_id:7,gpu_name:'RTX PRO 6000 WS',num_gpus:1,dph_total:1.45};
    await saveJson(path.join(ops.work,'offers.json'),[offer]);ops.instances=async()=>[];
    let creations=0;ops.api=async(method,route,body)=>{if(route.endsWith('/bundles/'))return {offers:[offer]};if(route.endsWith('/asks/42/')){assert.equal(body.image,ops.image);creations++;throw new Error('lost response');}return {success:true};};
    await assert.rejects(ops.rent({offerId:42,maxHourly:1.45}),/lost response/);
    assert.equal((await readJson(ops.stateFile)).offer_id,42);
    await assert.rejects(ops.rent({offerId:42,maxHourly:1.45}),/uncertain attempt/);assert.equal(creations,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

for (const fail of [false,true]) test(`connect uses only a tunnel and pairing; exchange failure=${fail}`,async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'seed-connect-'));
  try {
    const starts=[],calls=[];
    const ops=new SeedVast(root,{startBackground:async(script)=>starts.push(path.basename(script)),fetcher:async(url)=>{
      if(url.endsWith('/pairing-codes'))return Response.json({connection_code:'test-code'});
      return new Response('ok',{headers:{'set-cookie':'session=test; HttpOnly'}});
    }});
    ops.state={instance_id:42};ops.privateDir=root;ops.tunnelPaths={config:path.join(root,'tunnel')};ops.connectionFile=path.join(root,'connection.json');ops.origin='http://127.0.0.1:4310';
    await saveJson(ops.connectionFile,{worker_instance_id:'previous'});
    await saveJson(ops.secretFile(),{SEED_PAIRING_SECRET:'fake'});
    ops.key='key';ops.knownHosts='hosts';ops.current=async()=>({actual_status:'running',public_ipaddr:'127.0.0.1',ports:{'22/tcp':[{HostPort:22}]}});
    let stops=0;ops.stopTunnel=async()=>{stops++;};ops.saveState=async()=>{};
    ops.local=async(method,route)=>{
      calls.push([method,route]);
      if(method==='GET')return idle;
      if(fail)throw new Error('exchange failed');
      await saveJson(ops.connectionFile,{worker_instance_id:'new'});
    };
    if(fail)await assert.rejects(ops.connect(),/exchange failed/);else assert.equal((await ops.connect()).connected,true);
    assert.deepEqual(starts,['tunnel.mjs']);
    assert.deepEqual(calls,[['GET','/api/v1/studio'],['PUT','/api/v1/connection']]);
    assert.equal(stops,fail?2:1);
    assert.equal((await readJson(ops.connectionFile)).worker_instance_id,fail?'previous':'new');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('destroy stops the tunnel and retains the saved connection without app lifecycle calls',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'seed-destroy-'));
  try {
    const ops=new SeedVast(root);ops.state={instance_id:42,paired_worker:'worker'};
    ops.connectionFile=path.join(root,'connection.json');const saved={worker_instance_id:'worker',endpoint:workerOrigin};await saveJson(ops.connectionFile,saved);
    ops.current=async()=>({id:42,actual_status:'running'});
    const calls=[];ops.local=async(method,route)=>{calls.push([method,route]);return {safe_to_terminate:true};};
    ops.api=async(method,route)=>{calls.push([method,route]);return {success:true};};
    ops.saveState=async()=>{};ops.stopTunnel=async()=>{calls.push(['tunnel','stop']);};ops.instances=async()=>[];
    assert.equal((await ops.teardown('destroy')).confirmed,'destroy');
    assert.deepEqual(await readJson(ops.connectionFile),saved);
    assert.deepEqual(calls,[['POST','/api/v1/queue/pause'],['GET','/api/v1/studio'],['DELETE','/api/v0/instances/42/'],['tunnel','stop']]);
  }finally{await rm(root,{recursive:true,force:true});}
});
