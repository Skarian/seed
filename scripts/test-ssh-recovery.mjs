// Acceptance: the production Jobs timer owns retries through a real SSH tunnel.
// Test-only graph uses real Comfy LoadImage/SaveImage, no weights or GPU required.
import {execFile,spawn,fork} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,request as httpRequest} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {superviseTunnel} from '../operations/tunnel.mjs';
import {WorkerConnection} from '../dist/server/worker.js';
import {Jobs} from '../dist/server/jobs.js';
import {openDatabase} from '../dist/server/db.js';
import {resolvePaths,prepareStorage} from '../dist/server/storage.js';
import {remoteFixture} from './fixtures/remote-worker.mjs';

const execute=promisify(execFile),name='seed-ssh-recovery-'+process.pid;
const docker=async(...args)=>(await execute('docker',args,{windowsHide:true,maxBuffer:8*1024*1024})).stdout.trim();
const directory=path.resolve('.local/networking');await mkdir(directory,{recursive:true});
const root=await mkdtemp(path.join(directory,'ssh-recovery-')),paths=resolvePaths(root);prepareStorage(paths);
const evidence={started_at:new Date().toISOString(),faults:[],checks:[]};
const secret=randomBytes(32).toString('hex');let created=false,child,stopSupervisor,supervisor,proxy,jobs,db;
const baseline=process.argv.includes('--baseline'),beforeAcceptance=process.argv.includes('--before-acceptance'),blackhole=process.argv.includes('--blackhole');
const restart=process.argv.includes('--restart');let dispatcher,dispatcherClosed,restartRequested;
const generationOutage=process.argv.includes('--generation-outage');
const streamStall=process.argv.includes('--stream-stall');
if(generationOutage&&beforeAcceptance)throw Error('Generation-outage mode requires accepted prompt response loss.');
const remoteIndex=process.argv.indexOf('--remote-config');let remote;
let origin,blackholeUntil=0;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function poll(check,description,seconds=120){const end=Date.now()+seconds*1000;while(Date.now()<end){const result=await check();if(result)return result;await delay(100);}throw Error('Timed out: '+description);}
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
try {
  const fixture=fileURLToPath(new URL('./fixtures/ssh-worker.py',import.meta.url));
  let sshArgs,workerPort=8080;
  if(remoteIndex>=0){
    remote=await remoteFixture(JSON.parse(await readFile(process.argv[remoteIndex+1],'utf8')),fixture,secret);sshArgs=[...remote.sshArgs];workerPort=remote.workerPort;
  }else{
    await execute('ssh-keygen',['-q','-t','ed25519','-f',path.join(root,'key'),'-N',''],{windowsHide:true});
    await docker('run','-d','--name',name,'-p','127.0.0.1::22','--mount',`type=bind,source=${fixture},target=/ssh-worker.py,readonly`,'-e','PUBLIC_KEY='+(await readFile(path.join(root,'key.pub'),'utf8')).trim(),'-e','SEED_PAIRING_SECRET='+secret,process.env.SEED_NETWORK_TEST_IMAGE||'seed-worker:network-dev','/opt/venv/bin/python','/ssh-worker.py');created=true;
    const mapping=await docker('port',name,'22/tcp');sshArgs=['-p',mapping.split(':')[1],'-i',path.join(root,'key'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile='+path.join(root,'known_hosts'),'root@127.0.0.1'];
  }
  const sshPort=await port(),sshOrigin='http://127.0.0.1:'+sshPort,target=sshArgs.pop();
  const diagnostics=[];
  supervisor=superviseTunnel([...sshArgs,'-N','-o','ExitOnForwardFailure=yes','-L',`127.0.0.1:${sshPort}:127.0.0.1:${workerPort}`,target],{
    startControl:async stop=>{stopSupervisor=stop;return async()=>{};},
    spawnProcess:(...args)=>{child=spawn(...args);return child;},
    probe:async()=>{try{const response=await fetch((origin||sshOrigin)+'/worker/v1/status',{signal:AbortSignal.timeout(1000)});await response.body?.cancel();return response.status===401;}catch{return false;}},
    say:message=>diagnostics.push({at:new Date().toISOString(),message}),
  });
  const flags={input:!baseline,prompt:!baseline&&!streamStall,output:!baseline&&!streamStall,receipt:!baseline&&!streamStall};
  const stalledInputs=new WeakSet();
  const ranges=[];
  function cut(kind){if(!flags[kind])return false;flags[kind]=false;evidence.faults.push({kind,at:new Date().toISOString()});if(restart&&['output','receipt'].includes(kind))restartRequested=kind;if(blackhole&&kind==='input'){blackholeUntil=Date.now()+75000;}else if(!(streamStall&&kind==='input')){if(generationOutage&&kind==='prompt')blackholeUntil=Date.now()+20000;child?.kill();}return true;}
  proxy=createServer((incoming,outgoing)=>{
    if(Date.now()<blackholeUntil)return; // No response or close: a real stalled HTTP stream.
    if(beforeAcceptance&&incoming.url==='/comfy/prompt'&&cut('prompt')){incoming.destroy();outgoing.destroy();return;}
    if(incoming.url.includes('/outputs/'))ranges.push(incoming.headers.range||'bytes=0-');
    const upstream=httpRequest(sshOrigin+incoming.url,{method:incoming.method,headers:incoming.headers});
    upstream.on('error',()=>outgoing.destroy());incoming.on('error',()=>upstream.destroy());
    let sent=0;
    incoming.on('data',chunk=>{if(Date.now()<blackholeUntil||stalledInputs.has(incoming))return;sent+=chunk.length;if(incoming.url==='/comfy/upload'&&sent>1024*1024&&cut('input')){if(streamStall)stalledInputs.add(incoming);else if(!blackhole){incoming.destroy();upstream.destroy();}return;}upstream.write(chunk);});
    incoming.on('end',()=>{if(Date.now()>=blackholeUntil&&!stalledInputs.has(incoming))upstream.end();});
    upstream.on('response',response=>{
      response.on('error',()=>outgoing.destroy());
      if((incoming.url==='/comfy/prompt'&&cut('prompt'))||(incoming.url.endsWith('/receipt')&&cut('receipt'))){response.destroy();outgoing.destroy();return;}
      outgoing.writeHead(response.statusCode,response.headers);let received=0;
      response.on('data',chunk=>{received+=chunk.length;if(incoming.url.includes('/outputs/')&&received>1024*1024&&cut('output')){response.destroy();outgoing.destroy();return;}outgoing.write(chunk);});
      response.on('end',()=>outgoing.end());
    });
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+proxy.address().port;
  const raw=async(route,body,headers={})=>{const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error(route+' HTTP '+response.status);return response;};
  await poll(async()=>{try{return (await fetch(origin+'/worker/v1/status',{signal:AbortSignal.timeout(1000)})).status===401;}catch{return false;}},'worker SSH bootstrap');
  const unlocked=await raw('/worker/v1/unlock',{pairing_secret:secret},{Origin:'http://127.0.0.1:18080'});
  const cookie=unlocked.headers.getSetCookie().map(x=>x.split(';')[0]).join(';');await unlocked.body.cancel();
  const code=await (await raw('/worker/v1/pairing-codes',{}, {Origin:'http://127.0.0.1:18080',Cookie:cookie})).json();
  const payload=JSON.parse(Buffer.from(code.connection_code.slice(8),'base64url'));payload.endpoint=origin;
  const worker=new WorkerConnection(paths,origin);await worker.pair('studio1.'+Buffer.from(JSON.stringify(payload)).toString('base64url'));
  const cap=await poll(async()=>{try{const c=await worker.json('/comfy/capabilities');return c.ready?c:null;}catch{return null;}},'real Comfy CPU engine',180);
  db=openDatabase(paths.data);jobs=new Jobs(db,paths,worker);
  const png=await sharp(randomBytes(2048*2048*3),{raw:{width:2048,height:2048,channels:3}}).png().toBuffer();
  const file=path.join(root,'input.png');await writeFile(file,png);
  const submitted=await jobs.submit({workflow:'text-to-image',capabilities_revision:cap.revision,prompt:'Transport fixture',mode:'sfw',seed:'42',count:1,output:{aspect:'16:9',size:'1mp'}},'ssh-recovery-'+randomUUID());
  const job=submitted.jobs[0];
  // Fixture only: seed a valid model-free graph before the actual timer starts.
  job.prepared=[{file,filename:'input.png',sha256:hash(png),kind:'image'}];
  job.graph={'1':{class_type:'LoadImage',inputs:{image:'seed/'+job.id+'/input.png'}},'2':{class_type:'SeedTestDelay',inputs:{images:['1',0]}},'9':{class_type:'SaveImage',inputs:{images:['2',0],filename_prefix:'seed/'+job.id+'/image'}}};
  db.prepare('UPDATE jobs SET snapshot_json=? WHERE id=?').run(JSON.stringify(job),job.id);
  const startDispatcher=async()=>{
    dispatcher=fork(fileURLToPath(new URL('./fixtures/job-dispatcher.mjs',import.meta.url)),[root,origin],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    dispatcherClosed=new Promise(r=>dispatcher.once('exit',r));
    dispatcher.stderr.on('data',chunk=>{evidence.dispatcher_diagnostic=String(chunk).slice(-1000);});
    await new Promise((resolve,reject)=>{dispatcher.once('message',resolve);dispatcher.once('error',reject);dispatcher.once('exit',()=>reject(Error('Dispatcher exited before ready')));});
  };
  await startDispatcher();
  await poll(async()=>{
    if(restartRequested){
      const phase=restartRequested;restartRequested=null;
      dispatcher.kill('SIGKILL');await dispatcherClosed;await startDispatcher();
      evidence.checks.push('dispatcher process restarted from persisted state during '+phase);
    }
    const current=jobs.get(job.id);return current.state==='completed'&&current.cleanup_state==='complete'?current:null;
  },'unattended job and cleanup',240);
  assert.deepEqual(flags,{input:false,prompt:false,output:false,receipt:false});
  if(!baseline&&!streamStall)assert.ok(ranges.some(range=>/^bytes=[1-9][0-9]*-$/.test(range)),'output must resume from saved nonzero bytes');
  const insertions=(remote?await remote.read('queue-insertions.jsonl'):await docker('exec',name,'cat','/var/lib/seed/queue-insertions.jsonl')).split('\n').map(JSON.parse);
  assert.equal(insertions.filter(item=>item.job_id===job.id).length,1);
  if(generationOutage){
    const completions=(remote?await remote.read('completions.jsonl'):await docker('exec',name,'cat','/var/lib/seed/completions.jsonl')).split('\n').map(JSON.parse);
    const completed=completions.find(item=>item.job_id===job.id),fault=Date.parse(evidence.faults.find(item=>item.kind==='prompt').at);
    assert.ok(completed.at_ms>fault&&completed.at_ms<fault+20000,'native execution must finish while PC connection is unavailable');
    evidence.checks.push('native execution completed during the 20-second outage, then recovered without requeue');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets WHERE id=?').get(job.id+'-0').n,1);
  const output=await readFile(path.join(paths.data,'media/outputs',job.id+'-0.png'));
  const decoded=await sharp(output).raw().toBuffer(),expected=await sharp(png).raw().toBuffer();assert.equal(hash(decoded),hash(expected));
  evidence.checks.push(baseline?'baseline actual Comfy job completed':streamStall?'stalled input stream recovered while status and SSH remained healthy':`real production scheduler recovered all four injected failures without harness retry (${beforeAcceptance?'prompt lost before acceptance':'accepted prompt response lost'})`,'native Comfy queue insertion exactly once','one Library output with verified pixel content','receipt cleanup completed');
  if(streamStall)assert.equal(diagnostics.some(item=>item.message.includes('Worker transport stopped responding')),false);
  evidence.output_ranges=ranges;if(blackhole)evidence.checks.push('75-second unresponsive connection recovered without user intervention');
  evidence.ssh=diagnostics;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=error.stack;throw error;}
finally{
  if(dispatcher&&dispatcher.exitCode===null){dispatcher.kill('SIGKILL');await dispatcherClosed;}
  await jobs?.close();db?.close();proxy?.closeAllConnections();if(proxy)await new Promise(r=>proxy.close(r));await stopSupervisor?.();await supervisor;
  if(created){for(const [file,args]of [['container.log',['logs',name]],['comfy.log',['exec',name,'cat','/var/lib/seed/comfy.log']]])await writeFile(path.join(root,file),await docker(...args).catch(e=>e.stderr||e.message));await docker('rm','-f',name);}
  if(remote){for(const file of ['container.log','comfy.log'])await writeFile(path.join(root,file),await remote.read(file).catch(e=>e.message));await remote.stop();}
  await rm(path.join(root,'key'),{force:true});await rm(path.join(root,'key.pub'),{force:true});
  evidence.finished_at=new Date().toISOString();await writeFile(path.join(root,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({...evidence,evidence_directory:root},null,2));
}
