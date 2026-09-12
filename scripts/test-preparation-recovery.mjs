// Production preparation owner + real OpenSSH/tusd. No rental or model inference.
// Fixture replaces only the local manifest/cache, never upload or retry behavior.
import {execFile,spawn} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {createServer as httpServer,request as httpRequest} from 'node:http';
import {createServer as netServer} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {values}=parseArgs({options:{'remote-config':{type:'string'}}});
const remoteConfig=values['remote-config']?JSON.parse(await readFile(values['remote-config'],'utf8')):null;
if(remoteConfig&&(!Array.isArray(remoteConfig.sshArgs)||!remoteConfig.sshArgs.length||remoteConfig.sshArgs.some(x=>typeof x!=='string')||typeof remoteConfig.pairingSecret!=='string'||!remoteConfig.pairingSecret))throw Error('Remote config requires exact sshArgs and a pairingSecret.');
const execute=promisify(execFile),name=`seed-preparation-recovery-${process.pid}`;
const docker=async(...args)=>(await execute('docker',args,{windowsHide:true,maxBuffer:8*1024*1024})).stdout.trim();
const remoteExec=async command=>(await execute('ssh',[...remoteConfig.sshArgs,command],{windowsHide:true,maxBuffer:1024*1024,timeout:15000})).stdout.trim();
const directory=path.join(repo,'.local/networking');await mkdir(directory,{recursive:true});
const label=remoteConfig?String(remoteConfig.provider??'remote').replace(/[^a-zA-Z0-9-]/g,'').slice(0,40):'';
const artifact=name=>path.join(directory,`preparation-${label?label+'-':''}${name}`);
const work=await mkdtemp(path.join(directory,'preparation-recovery-'));
const config=path.join(work,'config'),tunnelConfig=path.join(config,'worker-tunnel');
await mkdir(tunnelConfig,{recursive:true});await mkdir(path.join(work,'dist/server'),{recursive:true});
const bytes=randomBytes(24*1024*1024),secret=remoteConfig?.pairingSecret??randomBytes(32).toString('hex');
const item={path:'diffusion_models/preparation-test.bin',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'https://huggingface.co/seed/test/resolve/'+'a'.repeat(40)+'/test.bin'};
const modelFile=path.join(work,'model.bin');await writeFile(modelFile,bytes);
await writeFile(path.join(work,'package.json'),'{"type":"module"}');
await writeFile(path.join(work,'dist/server/model-cache.js'),`export async function modelManifest(){return ${JSON.stringify([item])}};export async function cached(){return true};export function modelFile(){return ${JSON.stringify(modelFile)}};export async function downloadModel(){throw Error('Fixture cache must already exist')}`);
await writeFile(path.join(work,'dist/server/settings.js'),'export function settings(){return {localModelCache:true}}');
if(!remoteConfig)await execute('ssh-keygen',['-q','-t','ed25519','-f',path.join(work,'key'),'-N',''],{windowsHide:true});
let created=false,supervisor,supervisorClosed,cli,cliClosed,connection,proxy,restoreTimer,blackout=false,injected=false;
const evidence={started_at:new Date().toISOString(),image:remoteConfig?.image??process.env.SEED_NETWORK_TEST_IMAGE??'seed-worker:ssh-recovery',remote:Boolean(remoteConfig),checks:[],heads:[],patch_offsets:[]};
let supervisorLog='',cliLog='';const held=new Set(),upstreams=new Set();
const redact=text=>[secret,connection?.worker_credential].filter(Boolean).reduce((s,value)=>s.replaceAll(value,'[REDACTED]'),text);
async function poll(check,timeout=90000){const start=Date.now();while(Date.now()-start<timeout){const value=await check().catch(()=>null);if(value)return value;await delay(200);}throw Error('Preparation fixture condition timed out; see private logs');}
async function port(){const server=netServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const n=server.address().port;await new Promise(resolve=>server.close(resolve));return n;}
async function terminate(child,closed){if(child&&child.exitCode===null&&!child.killed){child.kill();await closed;}}
const origin='http://127.0.0.1:18080';
async function request(route,{method='GET',body,headers={}}={}){return fetch(origin+route,{method,signal:AbortSignal.timeout(10000),headers:{...(connection?{Authorization:'Bearer '+connection.worker_credential}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function json(route,options){const result=await request(route,options);assert.ok(result.ok,`${route}: HTTP ${result.status}`);return result.json();}
try{
 const forwardPort=await port();
 proxy=httpServer((incoming,response)=>{
  incoming.on('error',()=>{});response.on('error',()=>{});
  if(blackout){held.add(incoming);incoming.pause();incoming.on('close',()=>held.delete(incoming));return;}
  const outgoing=httpRequest({hostname:'127.0.0.1',port:forwardPort,path:incoming.url,method:incoming.method,headers:incoming.headers},remote=>{
   const offset=Number(remote.headers['upload-offset']);
   if(incoming.method==='HEAD'&&incoming.url.includes('/model-uploads/'))evidence.heads.push({offset,at:new Date().toISOString()});
   if(incoming.method==='PATCH')evidence.patch_offsets.push(Number(incoming.headers['upload-offset']));
   if(!injected&&incoming.method==='PATCH'&&remote.statusCode===204&&offset>0&&offset<item.size){
    injected=true;blackout=true;evidence.fault_at=new Date().toISOString();evidence.saved_offset=offset;
    response.destroy();remote.resume();
    restoreTimer=setTimeout(()=>{
     blackout=false;evidence.restored_at=new Date().toISOString();
     for(const req of held)req.destroy();held.clear();
    },75000);
    return;
   }
   response.writeHead(remote.statusCode,remote.headers);remote.pipe(response);
  });
  upstreams.add(outgoing);outgoing.on('close',()=>upstreams.delete(outgoing));
  outgoing.on('error',()=>response.destroy());incoming.on('aborted',()=>outgoing.destroy());incoming.pipe(outgoing);
 });
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(18080,'127.0.0.1',resolve);});
 let baseSsh;
 if(remoteConfig){baseSsh=[...remoteConfig.sshArgs];}
 else{
  await docker('run','-d','--name',name,'-p','127.0.0.1::22','-e','SEED_START_SSH=1','-e','PUBLIC_KEY='+(await readFile(path.join(work,'key.pub'),'utf8')).trim(),'-e','SEED_PAIRING_SECRET='+secret,evidence.image);created=true;
  const remote=await docker('port',name,'22/tcp');assert.match(remote,/^127\.0\.0\.1:\d+$/);
  baseSsh=['-p',remote.split(':')[1],'-i',path.join(work,'key'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile='+path.join(work,'known_hosts'),'root@127.0.0.1'];
 }
 const target=baseSsh.pop();
 const ssh=[...baseSsh,'-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-L',`127.0.0.1:${forwardPort}:127.0.0.1:8080`,target];
 supervisor=spawn(process.execPath,[path.join(repo,'operations/tunnel.mjs'),repo,tunnelConfig,...ssh],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 supervisorClosed=new Promise(resolve=>supervisor.once('close',resolve));supervisor.stderr.on('data',chunk=>supervisorLog+=chunk);
 await poll(async()=>{const response=await request('/worker/v1/status');await response.body?.cancel();return response.status===401;});
 const unlocked=await request('/worker/v1/unlock',{method:'POST',body:{pairing_secret:secret},headers:{Origin:origin}});assert.equal(unlocked.status,200);
 const cookie=unlocked.headers.getSetCookie().map(x=>x.split(';')[0]).join(';');await unlocked.body?.cancel();
 const code=await json('/worker/v1/pairing-codes',{method:'POST',body:{},headers:{Origin:origin,Cookie:cookie}});
 const payload=JSON.parse(Buffer.from(code.connection_code.slice(8),'base64url'));
 connection={...await json('/worker/v1/exchange',{method:'POST',body:{exchange_token:payload.exchange_token}}),endpoint:origin};
 await writeFile(path.join(config,'worker-connection.json'),JSON.stringify(connection),{mode:0o600});
 const runner=path.join(work,'run.mjs');
 await writeFile(runner,`import {prepareWorker} from ${JSON.stringify(pathToFileURL(path.join(repo,'operations/preparation.mjs')).href)};import * as lifecycle from ${JSON.stringify(pathToFileURL(path.join(repo,'dist/server/lifecycle.js')).href)};const app={repo:${JSON.stringify(work)},paths:{config:${JSON.stringify(config)}},state:{paired_worker:${JSON.stringify(connection.worker_instance_id)}},env:{},lifecycle};try{console.log(JSON.stringify(await prepareWorker(app)))}catch(error){console.error(error.message);process.exitCode=1}`);
 evidence.invoked_at=new Date().toISOString();
 cli=spawn(process.execPath,[runner],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 cliClosed=new Promise(resolve=>cli.once('close',resolve));cli.stdout.on('data',chunk=>cliLog+=chunk);cli.stderr.on('data',chunk=>cliLog+=chunk);
 const watchdog=setTimeout(()=>cli.kill(),240000);
 let codeResult;try{codeResult=await cliClosed;}finally{clearTimeout(watchdog);}
 assert.equal(codeResult,0,'Production prepare invocation failed; see preparation-owner.log');assert.ok(injected,'Upload fault was never injected');assert.ok(evidence.restored_at,'Upload completed without waiting for restored network');
 evidence.completed_at=new Date().toISOString();
 const final=await json('/worker/v1/preparation');assert.equal(final.state,'ready');
 const status=await json('/worker/v1/status');assert.equal(status.worker_instance_id,connection.worker_instance_id);assert.equal(status.workspace_id,connection.workspace_id);
 const remoteHash=(remoteConfig?await remoteExec('sha256sum /workspace/ComfyUI/models/'+item.path):await docker('exec',name,'sha256sum','/workspace/ComfyUI/models/'+item.path)).split(' ')[0];assert.equal(remoteHash,item.sha256);
 assert.ok(evidence.heads.some(x=>x.offset===evidence.saved_offset&&x.at>evidence.restored_at),'No authoritative resumed HEAD after restoration');
 evidence.recovery_seconds=(Date.parse(evidence.completed_at)-Date.parse(evidence.restored_at))/1000;
 assert.ok(evidence.recovery_seconds<=90,'Preparation did not progress within recovery acceptance budget');
 evidence.checks.push('one production preparation invocation','75-second blackout after acknowledged partial','same supervisor credential and worker identity','nonzero authoritative HEAD resume','remote SHA256 matches complete local model','no manual reconnect or retry');evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=redact(error.message);process.exitCode=1;}
finally{
 clearTimeout(restoreTimer);await terminate(cli,cliClosed);
 if(supervisor&&supervisor.exitCode===null){
  const lifecycle=await import(pathToFileURL(path.join(repo,'dist/server/lifecycle.js')).href);
  if(await lifecycle.control({config:tunnelConfig},'stop'))await supervisorClosed;
 }
 if(created)await writeFile(artifact('worker.log'),redact(await docker('logs',name).catch(error=>error.stderr||error.message)));
 if(created||remoteConfig)for(const file of ['tusd','comfy']){
  const logs=await (remoteConfig?remoteExec(`tail -c 65536 /var/lib/seed/${file}.log`):docker('exec',name,'cat',`/var/lib/seed/${file}.log`)).catch(error=>error.stderr||error.message);
  await writeFile(artifact(file+'.log'),redact(logs));
 }
 if(created)await docker('rm','-f',name);
 await terminate(supervisor,supervisorClosed);
 for(const req of held)req.destroy();for(const req of upstreams)req.destroy();proxy?.closeAllConnections();if(proxy)await new Promise(resolve=>proxy.close(resolve));
 await writeFile(artifact('owner.log'),redact(cliLog));await writeFile(artifact('ssh.log'),redact(supervisorLog));
 await rm(work,{recursive:true,force:true});
 evidence.finished_at=new Date().toISOString();await writeFile(artifact('recovery.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}
