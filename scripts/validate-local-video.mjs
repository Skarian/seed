/**
 * Runs the local video jobs Seed offers through the real app: HTTP, queue, engine, Library.
 * Run after `npm run build` with SEED_LOCAL_ROOT set. Prompts and references are synthetic.
 * Jobs run one at a time and print metadata only. A failed job is recorded and the next
 * job runs. Usage: node scripts/validate-local-video.mjs [case names]
 */
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {createApp} from '../dist/server/http.js';
import {resolvePaths} from '../dist/server/storage.js';

const ffmpeg=createRequire(import.meta.url)('ffmpeg-static');
const log=value=>console.log(JSON.stringify({at:new Date().toTimeString().slice(0,8),...value}));
const gpu=()=>Number(execFileSync('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true}).trim());
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const origin='http://127.0.0.1:'+port;
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(path.resolve('.local/tests/local-video-'));
const app=await createApp({paths:resolvePaths(root),port,webRoot:path.resolve('dist/web')});
await app.listen({host:'127.0.0.1',port});

const api=async(route,body,key)=>{
  const response=await fetch(origin+'/api/v1/'+route,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(60000),
    headers:{Origin:origin,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();
  if(!response.ok)throw Error(route+' failed: '+response.status+' '+JSON.stringify(value?.error?.message??''));
  return value;
};
async function upload(bytes,filename,kind,filetype){
  const metadata=Object.entries({kind,filename,filetype,mode:'sfw'}).map(([name,value])=>name+' '+Buffer.from(value).toString('base64')).join(',');
  const headers={Origin:origin,'Tus-Resumable':'1.0.0'};
  const start=await fetch(origin+'/api/v1/uploads',{method:'POST',headers:{...headers,'Upload-Length':String(bytes.length),'Upload-Metadata':metadata}});
  if(start.status!==201)throw Error('Upload start failed: '+start.status);
  const location=new URL(start.headers.get('location'),origin).href;
  const patched=await fetch(location,{method:'PATCH',headers:{...headers,'Content-Type':'application/offset+octet-stream','Upload-Offset':'0'},body:bytes});
  if(patched.status!==204)throw Error('Upload failed: '+patched.status);
  const id=location.split('/').pop();
  for(let i=0;i<300;i++){if((await api('assets/'+id)).state==='ready')return id;await delay(100);}
  throw Error('Synthetic upload did not become ready.');
}
async function run(name,request){
  const started=Date.now();let peak=0;
  try{
    const {jobs:[job]}=await api('jobs',{mode:'sfw',target:'local',seed:'41729',count:1,...request},crypto.randomUUID());
    for(;;){
      const status=await api('jobs/'+job.id+'/status');
      peak=Math.max(peak,gpu());
      if(['failed','cancelled','needs_attention'].includes(status.state)){log({name,state:status.state,seconds:(Date.now()-started)/1000,peak_vram_mib:peak,error:(await api('jobs/'+job.id)).error});return;}
      if(status.state==='completed')break;
      await delay(5000);
    }
    const saved=await api('jobs/'+job.id),asset=await api('assets/'+saved.outputs[0]);
    log({name,state:'completed',seconds:(Date.now()-started)/1000,peak_vram_mib:peak,width:asset.width,height:asset.height,duration:asset.duration,has_audio:asset.has_audio,size:asset.size,profile:saved.worker.profile});
  }catch(error){log({name,state:'error',seconds:(Date.now()-started)/1000,error:String(error.message)});}
}

const scene='integrated_multimodal_description: [Shot 1] A small stream flows over mossy stones in a green wood at dawn. Mist drifts between the trunks and low sun rakes in from the left. The camera performs a slow 1-meter push in.\noverall_soundscape: Water runs over stones. Birds call in the distance.\nnon_diegetic_music: N/A';
const talking='integrated_multimodal_description: [Shot 1] A medium shot of a baker in a white apron behind a wooden counter in a warm morning bakery. The baker (S1) lifts a loaf and says: <d>[English] Fresh from the oven this morning.</d> The baker smiles and sets the loaf down.\noverall_soundscape: Soft room tone and a quiet oven hum.\nnon_diegetic_music: N/A';
const text=(size,seconds,extra={})=>({workflow:'text-to-video',prompt:scene,output:{size,aspect:'16:9',duration_seconds:seconds},audio:{output:'generated'},steps:20,...extra});
const reference=(references,prompt,seconds=5,extra={})=>({workflow:'reference-to-video',prompt,references,output:{size:'768p',aspect:'16:9',duration_seconds:seconds},audio:{output:'generated'},steps:20,...extra});
const image=async index=>{
  const colors=['#6c906e','#8a5a44','#4a6fa5','#b08d57','#7a4e7e','#4f8a8b','#a55a5a','#5a7a4a','#8c8c5a'];
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1344" height="768"><rect width="1344" height="768" fill="${colors[index]}"/><circle cx="${300+index*90}" cy="${260+index*40}" r="170" fill="#ffffff55"/><rect x="${700-index*40}" y="420" width="360" height="220" fill="#00000044"/></svg>`;
  return upload(await sharp(Buffer.from(svg)).png().toBuffer(),`Synthetic ${index+1}.png`,'image','image/png');
};
const pictures=async(count,role='reference')=>Promise.all(Array.from({length:count},async(_,index)=>({id:'picture'+index,asset_id:await image(index),kind:'image',role,framing:'fit'})));
async function clip(){
  const file=path.join(root,'synthetic.mp4');
  execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=size=864x480:rate=24:duration=3','-pix_fmt','yuv420p',file],{windowsHide:true});
  const id=await upload(await readFile(file),'Synthetic clip.mp4','video','video/mp4');await rm(file);
  return {id:'clip',asset_id:id,kind:'video',role:'reference',range:{start_seconds:0,duration_seconds:3}};
}

const cases={
  'text-480-5':()=>text('480p',5),
  'text-480-15':()=>text('480p',15),
  'text-768-5-10steps':()=>text('768p',5,{steps:10}),
  'text-768-5-portrait':()=>({...text('768p',5),output:{size:'768p',aspect:'9:16',duration_seconds:5}}),
  'text-768-10-dialogue':()=>({...text('768p',10),prompt:talking}),
  'text-768-15':()=>text('768p',15),
  'text-768-5-30steps':()=>text('768p',5,{steps:30}),
  'full-768-15':()=>text('768p',15,{detail:'full'}),
  'ref-first-frame':async()=>{const [first]=await pictures(1,'first_frame');return reference([first],'<Picture 1>\n'+scene);},
  'ref-first-last':async()=>{const [first]=await pictures(1,'first_frame'),[last]=await pictures(1,'last_frame');return reference([first,{...last,id:'last'}],scene);},
  'ref-two-images':async()=>reference(await pictures(2),scene.replace('A small stream','<Picture 1> and <Picture 2> beside a small stream')),
  'ref-five-images-video':async()=>reference([...await pictures(5),await clip()],scene.replace('A small stream','Follow <Video 1> with <Picture 1>, <Picture 2>, <Picture 3>, <Picture 4> and <Picture 5> beside a small stream')),
  'ref-nine-images-15':async()=>reference(await pictures(9),scene.replace('A small stream','<Picture 1>, <Picture 2>, <Picture 3>, <Picture 4>, <Picture 5>, <Picture 6>, <Picture 7>, <Picture 8> and <Picture 9> beside a small stream'),15),
};

let closed=false;
try{
  const setup=await api('pool/local');
  if(!setup.setup.installed)throw Error('Run setup first.');
  await api('pool/local/actions',{action:'enable'});
  log({start:true,idle_vram_mib:gpu()});
  const selected=process.argv.slice(2);
  for(const [name,build] of Object.entries(cases)){
    if(selected.length&&!selected.includes(name))continue;
    await run(name,await build());
  }
  const started=Date.now();
  await api('pool/local/actions',{action:'unload'});
  log({unload_seconds:(Date.now()-started)/1000,vram_after_mib:gpu()});
  await app.close();closed=true;
  log({done:true,root});
}finally{if(!closed)await app.close();}
