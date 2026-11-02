/**
 * Real GPU acceptance through Seed: HTTP, queue, gateway, engine, Library, Unload now.
 * Run after `npm run build` with SEED_LOCAL_ROOT set. Jobs run serially with
 * synthetic prompts in a temporary profile. Prints metadata only. It never
 * terminates an engine: stopping always uses Unload now or app close.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {createApp} from '../dist/server/http.js';
import {resolvePaths} from '../dist/server/storage.js';

const log=value=>console.log(JSON.stringify(value));
const gpu=()=>{
  const output=execFileSync('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true});
  return Number(output.trim());
};
// nvidia-smi often reports no per-process memory, so the engine's own exit record is the proof.
const lastExit=async()=>{
  const instances=path.join(process.env.SEED_LOCAL_ROOT,'instances');
  const named=await Promise.all((await readdir(instances)).map(async name=>({name,at:(await stat(path.join(instances,name))).mtimeMs})));
  const latest=named.sort((a,b)=>b.at-a.at)[0].name;
  return JSON.parse(await readFile(path.join(instances,latest,'engine-exit.json'),'utf8')).exit_code;
};
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const origin='http://127.0.0.1:'+port;
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(path.resolve('.local/tests/local-engine-'));
const paths=resolvePaths(root);
// One unused LoRA pair: proves the adapter path without any real LoRA or download.
const header=Buffer.from(JSON.stringify({'fixture.lora_A.weight':{dtype:'F32',shape:[1],data_offsets:[0,4]},'fixture.lora_B.weight':{dtype:'F32',shape:[1],data_offsets:[4,8]}}));
const length=Buffer.alloc(8);length.writeBigUInt64LE(BigInt(header.length));
const adapter=Buffer.concat([length,header,Buffer.alloc(8)]);
const sha256=createHash('sha256').update(adapter).digest('hex');
const adapterEntry=(id,route)=>({id,name:'Synthetic '+route,revision:sha256,route,format:'lora',compatibility:'untested',
  source:{provider:'civitai',model_id:1,version_id:2,file_id:3,url:'https://civitai.com/api/download/models/2',sha256,size_bytes:adapter.length}});
const adapterFolder=path.join(paths.data,'local-workspace/ComfyUI/models/loras');
await mkdir(adapterFolder,{recursive:true});await mkdir(paths.config,{recursive:true});
await writeFile(path.join(adapterFolder,`seed-${sha256}.safetensors`),adapter);
await writeFile(path.join(paths.config,'loras.json'),JSON.stringify([adapterEntry('synthetic-fl','fl'),adapterEntry('synthetic-ref','ref')]));
const selected=id=>[{id,revision:sha256,scale:.5}];
const app=await createApp({paths,port,webRoot:path.resolve('dist/web')});
await app.listen({host:'127.0.0.1',port});

const api=async(route,body,key)=>{
  const response=await fetch(origin+'/api/v1/'+route,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(60000),
    headers:{Origin:origin,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();
  if(!response.ok)throw Error(route+' failed: '+response.status+' '+JSON.stringify(value?.error?.message??''));
  return value;
};
async function upload(bytes,filename){
  const metadata=Object.entries({kind:'image',filename,filetype:'image/png',mode:'sfw'}).map(([name,value])=>name+' '+Buffer.from(value).toString('base64')).join(',');
  const headers={Origin:origin,'Tus-Resumable':'1.0.0'};
  const start=await fetch(origin+'/api/v1/uploads',{method:'POST',headers:{...headers,'Upload-Length':String(bytes.length),'Upload-Metadata':metadata}});
  assert.equal(start.status,201);
  const location=new URL(start.headers.get('location'),origin).href;
  const patched=await fetch(location,{method:'PATCH',headers:{...headers,'Content-Type':'application/offset+octet-stream','Upload-Offset':'0'},body:bytes});
  assert.equal(patched.status,204);
  const id=location.split('/').pop();
  for(let i=0;i<100;i++){if((await api('assets/'+id)).state==='ready')return id;await delay(100);}
  throw Error('Synthetic upload did not become ready.');
}
async function run(name,request){
  const started=Date.now();let peak=0;
  const {jobs:[job]}=await api('jobs',{mode:'sfw',target:'local',seed:'41729',count:1,...request},crypto.randomUUID());
  for(;;){
    const status=await api('jobs/'+job.id+'/status');
    peak=Math.max(peak,gpu());
    if(['failed','cancelled'].includes(status.state)||(await api('pool/local')).worker?.issue){log({name,state:status.state,has_error:status.has_error,error:(await api('jobs/'+job.id)).error});throw Error(name+' did not complete.');}
    if(status.state==='completed')break;
    await delay(2000);
  }
  const saved=await api('jobs/'+job.id);
  assert.equal(saved.worker.executor,'local');assert.equal(saved.outputs.length,1);
  const asset=await api('assets/'+saved.outputs[0]);
  assert.equal(asset.executor,'local');
  log({name,state:'completed',seconds:(Date.now()-started)/1000,peak_vram_mib:peak,width:asset.width,height:asset.height,duration:asset.duration,has_audio:asset.has_audio,
    size:asset.size,profile:saved.worker.profile});
  return saved.outputs[0];
}

let closed=false;
try{
  const setup=await api('pool/local');
  assert.equal(setup.setup.installed,true,'Run setup first.');
  await api('pool/local/actions',{action:'enable'});
  log({workflows:(await api('pool/local')).worker.workflows,idle_vram_mib:gpu()});
  const prompt='A blue ceramic teapot on a wooden table in soft morning light.';
  const chosen=process.argv.slice(2);
  const wanted=name=>!chosen.length||chosen.includes(name);
  if(wanted('krea'))await run('krea',{workflow:'text-to-image',prompt,output:{size:'image-768',aspect:'16:9'}});
  const source=await sharp({create:{width:1024,height:768,channels:3,background:'#6c906e'}}).png().toBuffer();
  if(wanted('qwen')){
    const asset=await upload(source,'Synthetic source.png');
    await run('qwen',{workflow:'image-to-image',prompt:'Make the background a warm orange.',references:[{id:'source',asset_id:asset,kind:'image',role:'source'}],output:{aspect:'source',size:'image-768'}});
  }
  const sound='integrated_multimodal_description: [Shot 1] A small stream flows over mossy stones in a green wood. The camera holds still.\noverall_soundscape: Water runs over stones.\nnon_diegetic_music: N/A';
  const video={output:{size:'768p',aspect:'16:9',duration_seconds:5},audio:{output:'generated'},steps:20};
  if(wanted('text-video'))await run('text-video',{...video,workflow:'text-to-video',prompt:sound});
  if(wanted('long-video'))await run('long-video',{...video,output:{...video.output,duration_seconds:15},workflow:'text-to-video',prompt:sound});
  if(wanted('full-video'))await run('full-video',{...video,detail:'full',workflow:'text-to-video',prompt:sound});
  if(wanted('reference-video')){
    const asset=await upload(source,'Synthetic reference.png');
    await run('reference-video',{...video,workflow:'reference-to-video',prompt:sound.replace('A small stream','<Picture 1> A small stream'),references:[{id:'reference',asset_id:asset,kind:'image',role:'reference',framing:'fit'}]});
  }
  if(wanted('first-last')){
    const first=await upload(source,'Synthetic first.png'),last=await upload(source,'Synthetic last.png');
    await run('first-last',{...video,workflow:'reference-to-video',prompt:sound,references:[{id:'first',asset_id:first,kind:'image',role:'first_frame'},{id:'last',asset_id:last,kind:'image',role:'last_frame'}]});
  }
  if(wanted('lora-video'))await run('lora-video',{...video,workflow:'text-to-video',prompt:sound,loras:selected('synthetic-fl')});
  if(wanted('lora-reference')){
    const asset=await upload(source,'Synthetic LoRA reference.png');
    await run('lora-reference',{...video,workflow:'reference-to-video',prompt:sound.replace('A small stream','<Picture 1> A small stream'),references:[{id:'reference',asset_id:asset,kind:'image',role:'reference',framing:'fit'}],loras:selected('synthetic-ref')});
  }
  const loaded=gpu();
  const before=(await api('pool/local')).worker;
  assert.equal(before.state,'ready');
  const started=Date.now();
  await api('pool/local/actions',{action:'unload'});
  const after=(await api('pool/local')).worker;
  assert.equal(after.state,'sleeping');assert.equal(after.current_job_id,undefined);
  log({unload_seconds:(Date.now()-started)/1000,vram_before_mib:loaded,vram_after_mib:gpu(),engine_exit_code:await lastExit()});
  await app.close();closed=true;
  console.log(JSON.stringify({passed:true,root}));
}finally{if(!closed)await app.close();}
