/** Explicit native Windows setup. Never run at application startup. */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {localLease} from './local-lock.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.SEED_LOCAL_ROOT || path.join(repo, '.local/local-worker'));
const spec = JSON.parse(await readFile(path.join(repo, 'worker/engine.json'), 'utf8'));
const mode = process.argv[2] || 'runtime';
if (!['runtime', 'models', 'klein'].includes(mode)) throw Error('Use runtime, models or klein.');
if (process.platform !== 'win32') throw Error('Local setup currently targets Windows.');
await mkdir(root, {recursive:true});
const release=await localLease(root);
// A coordinator owns this pipe; its disappearance stops the complete setup
// tree, including curl and uv. Standalone maintainer setup has no such pipe.
// The gated Klein download takes the Hugging Face token from the first stdin line (never argv or the environment).
let stdinLine='';
const firstLine=new Promise(resolve=>{process.stdin.on('data',chunk=>{stdinLine+=chunk;const at=stdinLine.indexOf('\n');if(at>=0)resolve(stdinLine.slice(0,at).trim());});process.stdin.once('end',()=>resolve(stdinLine.trim()));});
if(process.env.SEED_SETUP_PARENT){
  process.stdin.resume();
  process.stdin.once('end',()=>{spawn('taskkill',['/PID',String(process.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});});
}
const env = {...process.env, UV_CACHE_DIR:path.join(root,'cache/uv'), UV_PYTHON_INSTALL_DIR:path.join(root,'python'), UV_LINK_MODE:'hardlink', PYTHONUNBUFFERED:'1'};
function log(data) { console.log(JSON.stringify({at:new Date().toISOString(),...data})); }
async function run(command, args, options={}) {
  await new Promise((resolve,reject) => {
    const child=spawn(command,args,{cwd:repo,env,windowsHide:true,stdio:'inherit',...options});
    child.on('error',reject); child.on('exit',(code,signal)=>code===0?resolve():reject(Error(path.basename(command)+' exited '+(signal??code))));
  });
}
async function capture(command,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:repo,env,windowsHide:true,stdio:['ignore','pipe','inherit']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);
    child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error('Runtime probe failed: '+code)));
  });
}
async function sha256(file) { const hash=createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function acquire(url, file, expectedHash, expectedSize, token) {
  await mkdir(path.dirname(file),{recursive:true});
  if (existsSync(file)) {
    if ((!expectedSize || (await stat(file)).size===expectedSize) && (!expectedHash || await sha256(file)===expectedHash)) {log({verified:path.basename(file),cached:true});return;}
    throw Error('Existing file failed verification: '+file);
  }
  const partial=file+'.part';
  log({downloading:path.basename(file),bytes:expectedSize??null});
  const args=['--fail','--location','--silent','--show-error','--retry','5','--retry-delay','3','--connect-timeout','30','--continue-at','-','--output',partial,url];
  if(!token)await run('curl.exe',args);
  // A token reaches curl through its config on stdin, so it never appears in a process list.
  else await new Promise((resolve,reject)=>{
    const child=spawn('curl.exe',['--config','-',...args],{cwd:repo,env,windowsHide:true,stdio:['pipe','inherit','inherit']});
    child.stdin.end('header = "Authorization: Bearer '+token.replace(/["\\\r\n]/g,'')+'"\n');
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('curl.exe exited '+code+' (check the Hugging Face licence and token)')));
  });
  if (expectedSize && (await stat(partial)).size!==expectedSize) throw Error('Download size mismatch: '+file);
  const actual=await sha256(partial);
  if (expectedHash && actual!==expectedHash) throw Error('Download checksum mismatch: '+file);
  await rename(partial,file); log({verified:path.basename(file),sha256:actual});
}
async function expand(archive,destination) {
  await mkdir(destination,{recursive:true});
  // Paths are passed through environment values, never interpolated as shell code.
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:SEED_ARCHIVE -DestinationPath $env:SEED_EXTRACT -Force'],{env:{...env,SEED_ARCHIVE:archive,SEED_EXTRACT:destination}});
}
const worker=async name=>JSON.parse(await readFile(path.join(repo,'worker',name),'utf8'));
async function models() {
  const ready=JSON.parse(await readFile(path.join(root,'runtime-ready.json'),'utf8'));
  const profile=(await worker('hardware.json')).find(item=>new RegExp(item.gpu,'i').test(ready.gpu));
  const qwen=await worker('qwen-model.json');
  const entries=[...new Map([...await worker('models-image.json'),...(profile?await worker(profile.manifest):[]),
    ...qwen.files.map(file=>({...file,url:'https://huggingface.co/'+qwen.repository+'/resolve/'+qwen.revision+'/'+file.path}))].map(file=>[file.path,file])).values()];
  log({modelFiles:entries.length,totalBytes:entries.reduce((n,file)=>n+file.size,0),root});
  // Two streaming transfers; hash verification runs before each file becomes usable.
  const pending=[...entries];
  // Keep the installation lease until both transfer workers have stopped,
  // including when one download or checksum fails first.
  const transfers=await Promise.allSettled([0,1].map(async()=>{for(;;){const entry=pending.shift();if(!entry)return;await acquire(entry.url,path.join(root,'models',entry.path),entry.sha256,entry.size);}}));
  const failed=transfers.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  await writeFile(path.join(root,'models-verified.json'),JSON.stringify({at:new Date().toISOString(),files:entries},null,2));
}
async function klein() {
  const spec=await worker('klein-model.json');
  const token=process.env.SEED_SETUP_PARENT?await firstLine:process.env.HF_TOKEN;
  if(!token)throw Error('FLUX 3 Image Klein needs a Hugging Face token.');
  for(const file of spec.files)await acquire('https://huggingface.co/'+spec.repository+'/resolve/'+spec.revision+'/'+file.path,path.join(root,'models',file.path),file.sha256,file.size,token);
  log({klein:true});
}
async function runtime() {
  const uvArchive=path.join(root,'downloads/uv-'+spec.uv.version+'.zip');
  await acquire(spec.uv.url,uvArchive,spec.uv.sha256);
  const uvDirectory=path.join(root,'tools'); const uv=path.join(uvDirectory,'uv.exe');
  if(!existsSync(uv))await expand(uvArchive,uvDirectory);
  await run(uv,['python','install',spec.python,'--no-bin','--no-registry']);
  const {revision,sha256:digest}=spec.comfyui;
  const engine=path.join(root,'engine');const source=path.join(engine,'ComfyUI-'+revision);
  const archive=path.join(root,'downloads/ComfyUI-'+revision+'.zip');
  await acquire('https://codeload.github.com/Comfy-Org/ComfyUI/zip/'+revision,archive,digest);
  if(!existsSync(path.join(source,'main.py')))await expand(archive,engine);
  const venv=path.join(engine,'venv');const python=path.join(venv,'Scripts/python.exe');
  if(!existsSync(python))await run(uv,['venv',venv,'--python',spec.python]);
  await run(uv,['pip','sync','--python',python,'--extra-index-url',spec.torch_index,'--index-strategy','unsafe-best-match','--require-hashes',path.join(repo,'worker/requirements-windows.lock')]);
  const probe=JSON.parse(await capture(python,['-c',"import json,torch,sys,importlib.metadata as m; p=torch.cuda.get_device_properties(0); print(json.dumps({'base_python':sys._base_executable,'torch':torch.__version__,'gpu':p.name,'vram_bytes':p.total_memory,'gpu_uuid':str(p.uuid),'device_count':torch.cuda.device_count(),'kitchen':m.version('comfy-kitchen'),'aimdo':m.version('comfy-aimdo')}))"]));
  if(probe.device_count!==1||probe.torch!==spec.packages.torch||probe.kitchen!==spec.packages['comfy-kitchen']||probe.aimdo!==spec.packages['comfy-aimdo'])throw Error('Runtime probe does not match the pinned single-GPU environment.');
  const readyFile=path.join(root,'runtime-ready.json');
  await writeFile(readyFile+'.tmp',JSON.stringify({revision:spec.revision,source,python,...probe},null,2));
  await rename(readyFile+'.tmp',readyFile);
  log({source,python,ready:true,...probe});
}
try { await (mode==='models'?models():mode==='klein'?klein():runtime()); } finally {await release();process.stdin.pause();}
log({complete:mode});
