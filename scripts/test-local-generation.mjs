/** Real HTTP -> queue -> authenticated gateway -> GPU -> Library, with crashes. */
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {processGone} from '../dist/server/local-runtime.js';
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(path.resolve('.local/tests/local-generation-')),results=[];
const cases=['engine-interrupted','saved-before-ack','mixed','idle'];
const selected=process.argv.slice(2);if(selected.some(mode=>!cases.includes(mode)))throw Error('Choose engine-interrupted, saved-before-ack, mixed, or idle.');
if((selected.length?selected:cases).some(mode=>['engine-interrupted','saved-before-ack'].includes(mode))&&process.env.SEED_ALLOW_GPU_FAULT_TESTS!=='1')
  throw Error('GPU process-death cases require separate authorization and SEED_ALLOW_GPU_FAULT_TESTS=1.');
const installed=JSON.parse(await readFile('.local/local-worker/runtime-ready.json','utf8'));
async function ownershipGone(owner){
  if(!processGone(owner.supervisor_pid)||!owner.members?.length)return false;
  const file=path.join(root,owner.incarnation+'-members.json');await writeFile(file,JSON.stringify(owner.members));
  return JSON.parse(execFileSync(installed.roles.image.base_python,['-m','worker.local_members','--prior',file],{encoding:'utf8',windowsHide:true})).gone;
}
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)&&!key.startsWith('T3_')));
async function until(check,label,timeout=180000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await check();if(value)return value;}catch(error){last=error;}await delay(500);}throw Error(label+': '+(last?.message??'timed out'));}
for(const mode of selected.length?selected:cases){
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const origin='http://127.0.0.1:'+port,directory=path.join(root,mode);
  let child,checkpoint,stderr='';
  async function start(crashAt=''){
    let ready=false;checkpoint=undefined;
    child=fork('scripts/local-generation-fixture.mjs',[],{windowsHide:true,silent:true,env:{...env,SEED_LOCAL_ROOT:path.resolve('.local/local-worker'),SEED_TEST_ROOT:directory,SEED_TEST_PORT:String(port),SEED_TEST_CHECKPOINT:crashAt}});
    child.stdout.resume();child.stderr.on('data',data=>stderr+=data);child.on('message',event=>{if(event.ready)ready=true;if(event.checkpoint)checkpoint=event;});
    await until(()=>{if(child.exitCode!==null)throw Error(stderr);return ready;},'app start',30000);
  }
  const api=async(route,body,key)=>{const response=await fetch(origin+'/api/v1/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
  async function stop(abrupt=false){if(!child||child.exitCode!==null)return;const exited=once(child,'exit');if(abrupt)child.kill('SIGKILL');else child.send('close');const abort=new AbortController();try{await Promise.race([exited,delay(150000,undefined,{signal:abort.signal}).then(()=>{throw Error('Test app shutdown remains pending; its processes and ownership are retained.');})]);}finally{abort.abort();}}
  try{
    await start(mode);const initial=await api('pool/local');assert.equal(initial.worker,null);assert.equal(initial.setup.installed,true);
    await api('pool/local/actions',{action:'enable'});
    const {jobs:[submitted]}=await api('jobs',{workflow:'text-to-image',prompt:'A blue ceramic teapot on a wooden table, morning sunlight.',mode:'sfw',target:'local',output:{size:'image-768',aspect:'16:9'},seed:'41729',count:1},'local-real-'+mode);
    let first;
    if(['engine-interrupted','saved-before-ack'].includes(mode)){
      await until(()=>checkpoint,'crash checkpoint');first=(await api('jobs')).items[0];
      if(mode==='engine-interrupted'){process.kill(checkpoint.ownership.supervisor_pid,'SIGKILL');}
      else{const owner=checkpoint.ownership;await stop(true);await until(()=>ownershipGone(owner),'coordinator containment');await start();}
    }
    if(mode==='engine-interrupted'){
      const interrupted=await until(async()=>{const value=(await api('jobs')).items.find(job=>job.id===submitted.id);return value?.recovery?.action==='retry_local'?value:false;},'explicit local retry available');
      assert.equal(interrupted.worker.execution_id,first.worker.execution_id);
      await api('jobs/'+submitted.id+'/recover',{});
    }
    const job=await until(async()=>{const job=(await api('jobs')).items.find(value=>value.id===submitted.id);if(job?.state==='failed')throw Error(job.error);return job?.state==='completed'&&job.worker?.acknowledged?job:false;},'saved and acknowledged output',240000);
    assert.equal(job.outputs.length,1);assert.equal(job.worker.executor,'local');assert.equal((await api('assets')).items.length,1);
    const media=await api('assets/'+job.outputs[0]);assert.equal(media.width,1344);assert.equal(media.height,768);assert.equal(media.executor,'local');
    if(mode==='engine-interrupted'){assert.equal(job.worker.local_retry_count,1);assert.notEqual(job.worker.execution_id,first.worker.execution_id);assert.equal(job.seed,first.seed);}
    if(mode==='saved-before-ack'){assert.equal(job.worker.execution_id,first.worker.execution_id);assert.equal(job.worker.local_retry_count,undefined);}
    if(mode==='mixed'){
      let previous=(await api('pool/local')).worker;
      for(const [index,request] of [
        {workflow:'text-to-video',output:{size:'480p',aspect:'16:9',duration_seconds:5},audio:{output:'generated'},prompt:'A small stream flows over stones in a green woodland. Natural water sounds, steady camera.'},
        {workflow:'text-to-image',output:{size:'2mp',aspect:'16:9'},prompt:'A blue ceramic teapot on a wooden table, morning sunlight.'},
      ].entries()){
        const {jobs:[next]}=await api('jobs',{...request,mode:'sfw',target:'local',seed:'41729',count:1},'mixed-'+index);
        const completed=await until(async()=>{const value=(await api('jobs')).items.find(item=>item.id===next.id);return value?.state==='completed'&&value.worker?.acknowledged?value:false;},'mixed role output',300000);
        const current=(await api('pool/local')).worker;
        assert.equal(current.id,previous.id);assert.notEqual(current.ownership.incarnation,previous.ownership.incarnation);
        assert.ok(await ownershipGone(previous.ownership));
        const output=await api('assets/'+completed.outputs[0]);assert.equal(output.executor,'local');
        assert.equal(output.width,index===0?864:1920);assert.equal(output.height,index===0?480:1080);
        if(index===0){assert.equal(output.duration,5);assert.equal(output.has_audio,true);}
        previous=current;
      }
      assert.equal((await api('assets')).items.length,3);
    }
    if(mode==='idle'){
      const worker=(await api('pool/local')).worker,owner=worker.ownership,start=Date.now();assert.equal(worker.current_job_id,undefined);assert.ok(owner);
      await until(async()=>{const value=(await api('pool/local')).worker;return value.state==='sleeping'&&!value.ownership;},'20-minute idle exit',1_230_000);
      assert.ok(Date.now()-start>=1_195_000);assert.ok(await ownershipGone(owner));
    }
    results.push({mode,passed:true,job_id:job.id,execution_id:job.worker.execution_id,asset:job.outputs[0]});await writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
  }finally{await stop();}
}
await writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({root,passed:true}));
