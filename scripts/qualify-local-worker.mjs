/** Run the real Seed graphs in a disposable, contained native Windows engine. */
import {spawn,execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import {graphFor} from '../dist/server/worker-graphs.js';
import {imageRequest} from '../dist/server/workflows.js';
import {videoProfile,DEFAULT_VIDEO_STEPS,isVideoSteps} from '../dist/shared/video-settings.js';
import {Media,probe} from '../dist/server/media.js';
import {openDatabase} from '../dist/server/db.js';
import {resolvePaths,prepareStorage} from '../dist/server/storage.js';
import {localLease} from './local-lock.mjs';
import {settleQualificationEngine} from './local-qualification-shutdown.mjs';

const {positionals,values} = parseArgs({allowPositionals:true,options:{
  size:{type:'string'},seconds:{type:'string',default:'5'},repeat:{type:'string',default:'1'},steps:{type:'string',default:String(DEFAULT_VIDEO_STEPS)},
  aspect:{type:'string',default:'16:9'},reference:{type:'string',multiple:true},prompt:{type:'string'},
  'reference-manifest':{type:'string'},
  'fast-disk':{type:'boolean'},'disable-pinned-memory':{type:'boolean'},
  'reserve-vram':{type:'string'},'vram-headroom':{type:'string'},
  'disable-compiler':{type:'boolean'},timeout:{type:'string',default:'7200'},
}});
const route=positionals[0]||'image';
if(!['image','image-edit','fl','ref'].includes(route))throw Error('Use image|image-edit|fl|ref.');
const role=route.startsWith('image')?'image':'video';
if(role==='video'&&!isVideoSteps(Number(values.steps)))throw Error('Choose 10, 15, 20, or 30 steps.');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.env.SEED_LOCAL_ROOT||path.join(repo,'.local/local-worker'));
const runtime=JSON.parse(await readFile(path.join(repo,'worker/local-runtime.json'),'utf8'));
const installed=JSON.parse(await readFile(path.join(root,'runtime-ready.json'),'utf8'));
const referenceInputs=(values.reference??[]).map(file=>({path:path.resolve(file),kind:'image'}));
if(values['reference-manifest']){
  const file=path.resolve(values['reference-manifest']);
  const inputs=JSON.parse(await readFile(file,'utf8'));
  if(!Array.isArray(inputs))throw Error('Reference manifest must be an array.');
  for(const input of inputs){
    if(!['image','video','audio'].includes(input.kind)||typeof input.path!=='string')throw Error('Each reference needs a path and kind.');
    referenceInputs.push({...input,path:path.resolve(path.dirname(file),input.path)});
  }
}
if(referenceInputs.length>(route==='fl'?2:route==='image-edit'?10:12)||referenceInputs.filter(ref=>ref.kind==='image').length>(route==='image-edit'?10:9))throw Error('Reference count exceeds the workflow limit.');
if(route==='image'&&referenceInputs.length)throw Error('Text to image does not accept references.');
if(route!=='ref'&&referenceInputs.some(ref=>ref.kind!=='image'))throw Error('Only the ref route accepts video/audio inputs.');
if(['ref','image-edit'].includes(route)&&!referenceInputs.length)throw Error(route+' requires references.');
const release=await localLease(root);
const source=path.join(root,role,'ComfyUI-'+runtime.roles[role].comfy_revision);
const python=path.join(root,role,'venv/Scripts/python.exe');
// The Windows venv executable is a redirector. The supervisor must be a
// direct child of Node so that Node owns the process lifetime handle.
const supervisorPython=execFileSync(python,['-c','import sys; print(sys._base_executable)'],{encoding:'utf8',windowsHide:true}).trim();
const run=path.join(root,'qualification',new Date().toISOString().replace(/[:.]/g,'-')+'-'+route);
const workspace=path.join(run,'workspace'),workspaceId=randomUUID();
const repeat=Number(values.repeat),timeout=Number(values.timeout)*1000;
if(!Number.isInteger(repeat)||repeat<1||repeat>100||!Number.isFinite(timeout)||timeout<=0)throw Error('Invalid repetition count or timeout.');
const save=async(file,data)=>writeFile(file,JSON.stringify(data,null,2),{flush:true});
const log=data=>console.log(JSON.stringify({at:new Date().toISOString(),...data}));
for(const sub of ['.seed/spool/inputs','.seed/spool/outputs','.seed/adapters','user'])await mkdir(path.join(workspace,sub),{recursive:true});
await save(path.join(workspace,'.seed/workspace.json'),{workspace_id:workspaceId});
await save(path.join(workspace,'.seed/adapters/installed.json'),[]);
const mediaPaths=resolvePaths(path.join(run,'preparation'));prepareStorage(mediaPaths);
const mediaDb=openDatabase(mediaPaths.data),media=new Media(mediaDb,mediaPaths);
const referenceRequests=[];
for(const [index,input] of referenceInputs.entries()){
  const assetId=randomUUID(),filename=assetId+path.extname(input.path),file=path.join(mediaPaths.data,'media/originals',filename);
  await cp(input.path,file);
  const metadata=input.kind==='image'?await sharp(file).metadata():await probe(file);
  const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
  mediaDb.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(assetId,input.kind,path.basename(input.path),'media/originals/'+filename,JSON.stringify({...metadata,state:'ready',sha256}),new Date().toISOString());
  referenceRequests.push({id:randomUUID(),asset_id:assetId,kind:input.kind,
    role:route==='image-edit'&&index===0?'source':route==='fl'?(index===0?'first_frame':'last_frame'):'reference',
    ...(input.kind==='image'?{}:{range:input.range,...(input.kind==='video'?{include_audio:input.include_audio??false}:{})})});
}
await cp(path.join(repo,'worker/comfy_seed'),path.join(source,'custom_nodes/comfy_seed'),{recursive:true});
await cp(path.join(repo,'worker/spool.py'),path.join(source,'custom_nodes/comfy_seed/spool.py'));
const paths=path.join(run,'models.yaml');
await save(paths,{seed:{base_path:path.join(root,'models'),diffusion_models:'diffusion_models',text_encoders:'text_encoders',vae:'vae',loras:'loras'}});
const port=await new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const origin='http://127.0.0.1:'+port;
const flags=['--listen','127.0.0.1','--port',String(port),'--disable-auto-launch','--extra-model-paths-config',paths,
  '--input-directory',path.join(workspace,'.seed/spool/inputs'),'--output-directory',path.join(workspace,'.seed/spool/outputs'),
  '--user-directory',path.join(workspace,'user'),'--disable-all-custom-nodes','--whitelist-custom-nodes','comfy_seed'];
if(role==='video'||values['disable-compiler'])flags.push('--disable-comfy-compiler');
for(const flag of ['fast-disk','disable-pinned-memory'])if(values[flag])flags.push('--'+flag);
for(const flag of ['reserve-vram','vram-headroom'])if(values[flag]!==undefined){const amount=Number(values[flag]);if(!Number.isFinite(amount)||amount<0||amount>16)throw Error(flag+' must be between 0 and 16 GiB.');flags.push('--'+flag+'='+amount);}
const runInfo={runtime,role,route,flags,origin,workspaceId,references:referenceInputs,started_at:new Date().toISOString()};
await save(path.join(run,'runtime.json'),runInfo);
const pins=path.join(run,'quiesce-pins.json'),site=path.join(root,role,'venv/Lib/site-packages');
await save(pins,runtime.roles[role].quiesce);
const revision=JSON.parse(execFileSync(supervisorPython,['-m','worker.local_revision','--source',source,'--site',site,'--pins',pins],{cwd:repo,encoding:'utf8',windowsHide:true}));
const child=spawn(supervisorPython,['-m','worker.local_supervisor','--parent-pid',String(process.pid),'--device-id',installed.roles[role].gpu_uuid,'--cwd',source,'--log',path.join(run,'engine.log'),'--metrics',path.join(run,'memory.jsonl'),'--diagnostics',run,'--',python,'main.py',...flags],{
  cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONPATH:repo+path.delimiter+path.join(root,role,'venv/Lib/site-packages'),PYTHONUNBUFFERED:'1',
    SEED_WORKSPACE:workspace,SEED_WORKER_CLASS:role,SEED_COMFY_URL:origin,SEED_EXECUTOR:'local',SEED_COMFY_ROOT:source,SEED_SITE_ROOT:site,SEED_QUIESCE_PINS:pins,PATH:path.dirname(ffmpeg)+path.delimiter+process.env.PATH},
});
let exited=false,exitCode,error,stopping,buffer='',cancelled=false,cancelRequested=false,timedOut=false,session;
const submittedJobs=new Set();
const members=[];let terminated=false;
const cancellationTimer=setInterval(()=>{if(existsSync(path.join(run,'cancel-requested.json')))cancelRequested=true;},250);
child.on('error',value=>{error=value;exited=true;});
child.on('exit',code=>{exited=true;exitCode=code;});
child.stdout.on('data',data=>{buffer+=data;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);const event=JSON.parse(line);if(event.event==='member')members.push({pid:event.pid,created:event.created});if(event.event==='terminated')terminated=true;log({supervisor:event});}});
child.stderr.on('data',data=>process.stderr.write(data));
async function stop(){
  if(stopping)return stopping;
  stopping=(async()=>{
    const result=await settleQualificationEngine({request:fetchJson,workspaceId,sessionId:session?.engine_session_id,
      pinsDigest:revision.pins_digest,members:()=>members,isExited:()=>exited,onWait:message=>log({waiting_for_orderly_stop:message})});
    if(!exited&&result)child.stdin.write(JSON.stringify({op:'terminate',stop_id:result.stop_id,mode:'quiesced',reason:'qualification_finished'})+'\n');
    while(!exited)await delay(100);
    while(!terminated){
      try{const check=JSON.parse(execFileSync(supervisorPython,['-m','worker.local_members','--prior',path.join(run,'members.json')],{cwd:repo,encoding:'utf8',windowsHide:true}));if(check.gone&&check.members.length)break;}catch{}
      log({termination_unconfirmed:true});await delay(1000);
    }
  })();return stopping;
}
child.stdin.on('error',()=>{});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{cancelRequested=true;});
const fetchJson=async(url,options={})=>{const response=await fetch(origin+url,{signal:AbortSignal.timeout(10000),...options});const body=await response.json();if(!response.ok)throw Error(response.status+' '+JSON.stringify(body));return body;};
log({run,role,route,starting:true});
try {
  const startup=Date.now();
  while(Date.now()-startup<180000){
    if(cancelRequested){cancelled=true;throw Error('Benchmark deliberately cancelled during startup.');}
    if(exited)throw error||Error('Engine exited during startup: '+exitCode);
    try{session=await fetchJson('/studio/session');break;}catch{await delay(1000);}
  }
  if(!session||session.workspace_id!==workspaceId)throw Error('Engine readiness or workspace identity failed.');
  await save(path.join(run,'capabilities.json'),await fetchJson('/studio/capabilities'));
  runInfo.startup_seconds=(Date.now()-startup)/1000;runInfo.engine_session_id=session.engine_session_id;await save(path.join(run,'runtime.json'),runInfo);
  log({ready:true,startup_seconds:(Date.now()-startup)/1000,session:session.engine_session_id});
  for(let iteration=0;iteration<repeat;iteration++){
    if(cancelRequested){cancelled=true;throw Error('Benchmark deliberately cancelled.');}
    const id=randomUUID(),directory=path.join(run,id);await mkdir(directory);
    const request={workflow:route==='image'?'text-to-image':route==='image-edit'?'image-to-image':route==='ref'||referenceInputs.length?'reference-to-video':'text-to-video',
      prompt:values.prompt??(route==='image-edit'?'Change the blue teapot to a red ceramic teapot. Keep the composition, table, lighting, and background unchanged.':role==='image'?'A blue ceramic teapot on a wooden table beside a window, soft morning sunlight, detailed realistic photograph.':'A small stream flows gently over stones in a green woodland, leaves move in a light breeze, natural water sounds, steady camera.'),
      mode:'sfw',seed:String(41729+iteration),count:1,output:{size:values.size||(route==='image-edit'?'1mp':role==='image'?'image-768':'480p'),aspect:values.aspect,
        ...(role==='video'?{duration_seconds:Number(values.seconds),format:'video'}:{})},...(role==='video'?{steps:Number(values.steps),audio:{output:'generated'}}:{})};
    const refs=[],preparation=Date.now();
    if(referenceRequests.length)request.references=referenceRequests;
    if(route==='image-edit')request.output.aspect='source';
    imageRequest(request); // Use the same limits and validation as the app.
    for(const reference of referenceRequests){
      const prepared=await media.prepare(reference,request.output.aspect,Number(values.seconds),request.output.size);
      const input=path.join(workspace,'.seed/spool/inputs/seed',id);await mkdir(input,{recursive:true});
      await cp(prepared.file,path.join(input,prepared.filename));
      if(prepared.audio_file)await cp(prepared.audio_file,path.join(input,prepared.audio_filename));
      refs.push(prepared);
    }
    await save(path.join(directory,'prepared-references.json'),refs);
    const preparation_seconds=(Date.now()-preparation)/1000;
    const graph=graphFor(request,id,request.seed,[],refs,true);
    const body={prompt_id:id,prompt:graph,route,loras:[],...(role==='video'?{video_profile:videoProfile(request,true)}:{})};
    await save(path.join(directory,'request.json'),request);await save(path.join(directory,'submission.json'),body);
    const start=Date.now();
    if(cancelRequested){cancelled=true;throw Error('Benchmark deliberately cancelled before submission.');}
    // An HTTP timeout can occur after acceptance, so track ownership before sending.
    submittedJobs.add(id);
    const acceptance=await fetchJson('/studio/prompt',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Engine-Session':session.engine_session_id},body:JSON.stringify(body)});
    log({submitted:id,iteration,acceptance});
    const manifest=path.join(workspace,'.seed/spool/jobs',id,'manifest.json');let lastProgress;
    const events=[];
    while(!existsSync(manifest)){
      if(exited)throw Error('Engine exited during generation: '+exitCode);
      if(cancelRequested){cancelled=true;throw Error('Benchmark deliberately cancelled.');}
      if(Date.now()-start>timeout){timedOut=true;throw Error('Generation exceeded qualification timeout.');}
      try{const current=await fetchJson('/studio/session');const progress=JSON.stringify([current.execution_activity,current.sampling_progress]);if(progress!==lastProgress){const event={job:id,seconds_since_submit:(Date.now()-start)/1000,activity:current.execution_activity,sampling:current.sampling_progress};events.push(event);log(event);await save(path.join(directory,'events.json'),events);lastProgress=progress;}}catch{}
      await delay(2000);
    }
    const result=JSON.parse(await readFile(manifest,'utf8'));result.elapsed_seconds=(Date.now()-start)/1000;result.preparation_seconds=preparation_seconds;
    await save(path.join(directory,'events.json'),events);
    await save(path.join(directory,'result.json'),result);
    await save(path.join(directory,'history.json'),await fetchJson('/history/'+id));
    log({job:id,...result});
    if(result.state==='cancelled')cancelled=true;
    if(result.state!=='completed')throw Error(cancelled?'Benchmark deliberately cancelled.':'Generation failed; inspect '+path.join(run,'engine.log'));
  }
  await save(path.join(run,'result.json'),{passed:true,repeat,finished_at:new Date().toISOString()});
}catch(error){
  await save(path.join(run,'result.json'),{passed:false,...(cancelled?{cancelled:true}:{}),...(timedOut?{timed_out:true}:{}),
    ...(cancelled||timedOut?{outcome:'incomplete'}:{}),error:String(error),finished_at:new Date().toISOString()});throw error;
}finally{clearInterval(cancellationTimer);await stop();mediaDb.close();await release();log({run,stopped:true});}
