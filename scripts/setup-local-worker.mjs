/** Explicit native Windows qualification setup. Never run at application startup. */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {localLease} from './local-lock.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.SEED_LOCAL_ROOT || path.join(repo, '.local/local-worker'));
const manifest = JSON.parse(await readFile(path.join(repo, 'worker/local-runtime.json'), 'utf8'));
const mode = process.argv[2] || 'runtime';
const roles = process.argv.slice(3).length ? process.argv.slice(3) : ['image', 'video'];
if (!['runtime', 'models'].includes(mode) || roles.some(role => !manifest.roles[role])) throw Error('Use runtime|models [image] [video].');
if (process.platform !== 'win32') throw Error('This qualification setup currently targets Windows.');
await mkdir(root, {recursive:true});
const release=await localLease(root);
// A coordinator owns this pipe; its disappearance stops the complete setup
// tree, including curl and uv. Standalone maintainer setup has no such pipe.
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
async function acquire(url, file, expectedHash, expectedSize) {
  await mkdir(path.dirname(file),{recursive:true});
  if (existsSync(file)) {
    if ((!expectedSize || (await stat(file)).size===expectedSize) && (!expectedHash || await sha256(file)===expectedHash)) {log({verified:path.basename(file),cached:true});return;}
    throw Error('Existing file failed verification: '+file);
  }
  const partial=file+'.part';
  log({downloading:path.basename(file),bytes:expectedSize??null});
  await run('curl.exe',['--fail','--location','--silent','--show-error','--retry','5','--retry-delay','3','--connect-timeout','30','--continue-at','-','--output',partial,url]);
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
try { if (mode==='models') {
  const entries=[];
  for(const role of roles) entries.push(...JSON.parse(await readFile(path.join(repo,'worker',role==='video'?'models-local-video.json':'models-image.json'),'utf8')));
  if(roles.includes('image')) {
    const qwen=JSON.parse(await readFile(path.join(repo,'worker/qwen-model.json'),'utf8'));
    entries.push(...qwen.files.map(file=>({...file,url:'https://huggingface.co/'+qwen.repository+'/resolve/'+qwen.revision+'/'+file.path})));
  }
  log({modelFiles:entries.length,totalBytes:entries.reduce((n,file)=>n+file.size,0),root});
  // Two streaming transfers; hash verification runs before each file becomes usable.
  const pending=[...entries];
  // Keep the installation lease until both transfer workers have stopped,
  // including when one download or checksum fails first.
  const transfers=await Promise.allSettled([0,1].map(async()=>{for(;;){const entry=pending.shift();if(!entry)return;await acquire(entry.url,path.join(root,'models',entry.path),entry.sha256,entry.size);}}));
  const failed=transfers.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  await writeFile(path.join(root,'models-verified.json'),JSON.stringify({at:new Date().toISOString(),files:entries},null,2));
} else {
  const uvArchive=path.join(root,'downloads/uv-'+manifest.uv.version+'.zip');
  await acquire(manifest.uv.url,uvArchive,manifest.uv.sha256);
  const uvDirectory=path.join(root,'tools'); const uv=path.join(uvDirectory,'uv.exe');
  if(!existsSync(uv))await expand(uvArchive,uvDirectory);
  await run(uv,['python','install',manifest.python,'--no-bin','--no-registry']);
  for(const role of roles) {
    const revision=manifest.roles[role].comfy_revision;
    const roleRoot=path.join(root,role);const source=path.join(roleRoot,'ComfyUI-'+revision);
    const archive=path.join(root,'downloads/ComfyUI-'+revision+'.zip');
    await acquire('https://codeload.github.com/Comfy-Org/ComfyUI/zip/'+revision,archive,manifest.roles[role].comfy_sha256);
    if(!existsSync(path.join(source,'main.py')))await expand(archive,roleRoot);
    const venv=path.join(roleRoot,'venv');const python=path.join(venv,'Scripts/python.exe');
    if(!existsSync(python))await run(uv,['venv',venv,'--python',manifest.python]);
    await run(uv,['pip','sync','--python',python,'--extra-index-url',manifest.torch_index,'--index-strategy','unsafe-best-match','--require-hashes',path.join(repo,'worker/requirements-local-'+role+'.lock')]);
    await cp(path.join(repo,'worker/comfy_seed'),path.join(source,'custom_nodes/comfy_seed'),{recursive:true});
    await cp(path.join(repo,'worker/spool.py'),path.join(source,'custom_nodes/comfy_seed/spool.py'));
    const probe=JSON.parse(await capture(python,['-c',"import json,torch,sys,importlib.metadata as m; p=torch.cuda.get_device_properties(0); print(json.dumps({'base_python':sys._base_executable,'torch':torch.__version__,'cuda':torch.version.cuda,'gpu':p.name,'vram_bytes':p.total_memory,'gpu_uuid':str(p.uuid),'device_count':torch.cuda.device_count(),'kitchen':m.version('comfy-kitchen'),'aimdo':m.version('comfy-aimdo')}))"]));
    if(probe.device_count!==1||probe.torch!==manifest.torch||probe.kitchen!==manifest.roles[role].kitchen||probe.aimdo!==manifest.roles[role].aimdo)throw Error('Runtime probe does not match the pinned single-GPU environment.');
    const readyFile=path.join(root,'runtime-ready.json');
    const prior=existsSync(readyFile)?JSON.parse(await readFile(readyFile,'utf8')):{roles:{}};
    await writeFile(readyFile+'.tmp',JSON.stringify({revision:manifest.revision,roles:{...(prior.revision===manifest.revision?prior.roles:{}),[role]:{source,python,...probe}}},null,2));
    await rename(readyFile+'.tmp',readyFile);
    log({role,...probe});
    log({role,source,python,ready:true});
  }
}
} finally {await release();process.stdin.pause();}
log({complete:mode});
