// Real worker API + official tusd/containerboot, local Docker only; no inference.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import envPaths from 'env-paths';
import {enrollmentKey,tailscaleOrigin} from '../operations/tailscale.mjs';

const execute=promisify(execFile), name=`seed-worker-network-${process.pid}`;
const docker=async(...args)=>(await execute('docker',args,{windowsHide:true,maxBuffer:8*1024*1024})).stdout.trim();
const hash=b=>createHash('sha256').update(b).digest('hex');
const secret=randomBytes(32).toString('hex');
const bytes=randomBytes(8*1024*1024), split=3*1024*1024;
const item={path:'diffusion_models/network-test.bin',size:bytes.length,sha256:hash(bytes),url:'https://huggingface.co/seed/test/resolve/'+'a'.repeat(40)+'/test.bin'};
let created=false,origin,connection,peer,tunnel,tunnelClosed;
const evidence={started_at:new Date().toISOString(),checks:[]};
const directory=new URL('../.local/networking/',import.meta.url);await mkdir(directory,{recursive:true});
const keys=await mkdtemp(path.join(fileURLToPath(directory),'ssh-test-'));
await execute('ssh-keygen',['-q','-t','ed25519','-f',path.join(keys,'key'),'-N',''],{windowsHide:true});
async function stopTunnel(){if(tunnel&&!tunnel.killed){tunnel.kill();await tunnelClosed;}tunnel=null;}
async function mapping(){
  await stopTunnel();
  const remote=await docker('port',name,'22/tcp');assert.match(remote,/^127\.0\.0\.1:\d+$/);
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));origin='http://127.0.0.1:'+port;
  tunnel=spawn('ssh',['-N','-p',remote.split(':')[1],'-i',path.join(keys,'key'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile='+path.join(keys,'known_hosts'),'-o','ExitOnForwardFailure=yes','-L',`127.0.0.1:${port}:127.0.0.1:8080`,'root@127.0.0.1'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  tunnelClosed=new Promise(r=>tunnel.once('close',r));tunnel.stderr.on('data',b=>{evidence.ssh_diagnostic=String(b).slice(-1000);});
}
async function poll(check){for(let i=0;i<120;i++){const value=await check().catch(()=>null);if(value)return value;await delay(500);}throw Error('Local integration condition not reached; see collected logs');}
const request=(route,{method='GET',body,headers={}}={})=>fetch(origin+route,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{...(connection?{Authorization:'Bearer '+connection.worker_credential}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(route,options){const r=await request(route,options);if(!r.ok)throw Error(`${route} returned ${r.status}`);return r.json();}
const uploadPath='/worker/v1/model-uploads/'+hash(item.path);
const tus={'Tus-Resumable':'1.0.0'};
const patch=(offset,data,credential=connection.worker_credential)=>fetch(origin+uploadPath,{method:'PATCH',headers:{...tus,'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset),Authorization:'Bearer '+credential},body:data,signal:AbortSignal.timeout(30000)});
try {
  await docker('run','-d','--name',name,'-p','127.0.0.1::22','-e','SEED_START_SSH=1','-e','PUBLIC_KEY='+(await readFile(path.join(keys,'key.pub'),'utf8')).trim(),'-e','SEED_PAIRING_SECRET='+secret,process.env.SEED_NETWORK_TEST_IMAGE||'seed-worker:network-dev');created=true;
  await delay(1500);
  await mapping();await poll(async()=>{const r=await request('/');await r.body?.cancel();return r.ok;});
  const unlock=await request('/worker/v1/unlock',{method:'POST',body:{pairing_secret:secret},headers:{Origin:'http://127.0.0.1:18080'}});assert.equal(unlock.status,200);
  const cookie=unlock.headers.getSetCookie().map(x=>x.split(';')[0]).join(';');
  const code=await json('/worker/v1/pairing-codes',{method:'POST',body:{},headers:{Origin:'http://127.0.0.1:18080',Cookie:cookie}});
  const payload=JSON.parse(Buffer.from(code.connection_code.slice(8),'base64url'));
  connection=await json('/worker/v1/exchange',{method:'POST',body:{exchange_token:payload.exchange_token}});
  assert.equal((await fetch(origin+'/worker/v1/preparation')).status,401);
  await json('/worker/v1/preparation',{method:'PUT',body:{entries:[item],revision:0}});
  await poll(async()=>(await json('/worker/v1/preparation')).state==='needs_source');
  assert.equal((await request('/comfy/prompt',{method:'POST',body:{}})).status,409);
  await json(uploadPath,{method:'POST',body:{}});
  assert.equal((await patch(0,bytes.subarray(0,split),'invalid')).status,401);
  assert.equal((await patch(0,bytes.subarray(0,split))).status,204);
  evidence.checks.push('authenticated early API','generation gated during preparation','authenticated model upload');
  await docker('restart',name);await mapping();
  await poll(async()=>(await json('/worker/v1/preparation')).state==='needs_source');
  const restarted=await json('/worker/v1/status');assert.equal(restarted.worker_instance_id,connection.worker_instance_id);
  const head=await request(uploadPath,{method:'HEAD',headers:tus});assert.equal(head.status,200);assert.equal(Number(head.headers.get('Upload-Offset')),split);
  assert.equal((await patch(0,bytes.subarray(0,10))).status,409);
  assert.equal((await patch(split,randomBytes(bytes.length-split))).status,400);
  assert.equal((await json('/worker/v1/preparation')).state,'needs_source');
  await json(uploadPath,{method:'POST',body:{}});
  assert.equal((await patch(0,bytes)).status,204);
  assert.equal((await json('/worker/v1/preparation')).state,'ready');
  const remoteHash=(await docker('exec',name,'sha256sum','/workspace/ComfyUI/models/'+item.path)).split(' ')[0];assert.equal(remoteHash,item.sha256);
  assert.equal((await request(uploadPath,{method:'HEAD',headers:tus})).headers.get('Upload-Offset'),String(bytes.length));
  assert.equal((await json(uploadPath,{method:'POST',body:{}})).ready,true);
  evidence.checks.push('worker identity and bearer survive restart','tus partial resumes after restart','stale offset rejected','corrupt upload rejected and restarted','complete model hash verified','lost completion reconciled');
  const job=randomUUID();
  await docker('exec',name,'/opt/venv/bin/python','-c',"import sys,shutil; from pathlib import Path; from worker.spool import atomic; root=Path('/workspace/.seed/spool'); job=sys.argv[1]; target=root/'outputs'/'seed'/job/'network.bin'; target.parent.mkdir(parents=True); shutil.copyfile('/workspace/ComfyUI/models/'+sys.argv[2],target); atomic(root/'jobs'/job/'submission.json',{'job_id':job}); atomic(root/'jobs'/job/'manifest.json',{'state':'completed','outputs':[{'id':'test','path':'seed/'+job+'/network.bin','mime_type':'application/octet-stream','sha256':sys.argv[3],'size':target.stat().st_size}]})",job,item.path,item.sha256);
  async function outputCheck(endpoint,route){
    const begin=performance.now();
    const response=await fetch(endpoint+`/worker/v1/jobs/${job}/outputs/test`,{headers:{Authorization:'Bearer '+connection.worker_credential,Range:'bytes='+split+'-'},signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,206);const received=Buffer.from(await response.arrayBuffer());assert.equal(hash(received),hash(bytes.subarray(split)));
    evidence[route+'_output']={bytes:received.length,seconds:(performance.now()-begin)/1000};
  }
  await outputCheck(origin,'ssh');
  if(process.argv.includes('--tailscale')){
    const key=await enrollmentKey(envPaths('RunpodStudio',{suffix:''}));
    await json('/worker/v1/network',{method:'POST',body:{auth_key:key}});
    peer=await poll(async()=>{const n=await json('/worker/v1/network');return n.state==='ready'?n:null;});
    const endpoint=tailscaleOrigin(peer.address);
    const response=await fetch(endpoint+'/worker/v1/status',{headers:{Authorization:'Bearer '+connection.worker_credential},signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200);assert.equal((await response.json()).worker_instance_id,connection.worker_instance_id);
    await outputCheck(endpoint,'tailscale');
    await docker('restart',name);await mapping();
    const resumed=await poll(async()=>{const n=await json('/worker/v1/network');return n.state==='ready'?n:null;});
    assert.equal(resumed.peer_id,peer.peer_id);assert.equal(resumed.address,peer.address);
    evidence.checks.push('real tagged Tailscale enrollment','authenticated raw TCP Serve','same Tailscale peer survives restart without new key');
  }
  const record=await json('/worker/v1/jobs/'+job);
  assert.equal((await json('/worker/v1/jobs/'+job+'/receipt',{method:'POST',body:{manifest_digest:record.manifest_digest}})).cleanup_complete,true);
  assert.equal((await request('/worker/v1/jobs/'+job+'/outputs/test')).status,404);
  evidence.checks.push('ranged artifact transfer and hash over each route','durable receipt cleans worker output');
  evidence.passed=true;
} catch(error){evidence.passed=false;evidence.error=error.message;throw error;}
finally {
  if(created){
    const redact=s=>s.replace(/tskey-[A-Za-z0-9_-]+/g,'[REDACTED]').replaceAll(secret,'[REDACTED]');
    await writeFile(new URL('worker-network.log',directory),redact(await docker('logs',name).catch(e=>e.stderr||e.message)));
    for(const file of ['tailscale','tusd','comfy'])await writeFile(new URL(file+'-integration.log',directory),redact(await docker('exec',name,'cat','/var/lib/seed/'+file+'.log').catch(e=>e.stderr||e.message)));
    if(peer)await docker('exec',name,'/usr/local/bin/tailscale','--socket=/var/lib/seed/tailscale/tailscaled.sock','logout').catch(()=>{});
    await docker('rm','-f',name);
  }
  await stopTunnel();await rm(keys,{recursive:true,force:true});
  evidence.finished_at=new Date().toISOString();await writeFile(new URL('worker-network.json',directory),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}
