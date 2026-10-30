/** Maintainer command: resolve worker/engine.json into one hashed lockfile per OS. */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.env.SEED_LOCAL_ROOT||path.join(repo,'.local/local-worker'));
const spec=JSON.parse(await readFile(path.join(repo,'worker/engine.json'),'utf8'));
const uv=path.join(root,'tools/uv.exe');
if(!existsSync(uv))throw Error('Run node scripts/setup-local-worker.mjs runtime first; it installs uv.');
const comfy=await fetch('https://raw.githubusercontent.com/Comfy-Org/ComfyUI/'+spec.comfyui.revision+'/requirements.txt');
if(!comfy.ok)throw Error('Could not read the ComfyUI requirements.');
const pins=Object.entries(spec.packages).map(([name,version])=>name+'=='+version).join('\n');
const directory=await mkdtemp(path.join(root,'lock-'));
try{
  const input=path.join(directory,'requirements.in');
  await writeFile(input,await comfy.text()+'\n'+await readFile(path.join(repo,'worker/requirements.txt'),'utf8')+'\n'+pins+'\n');
  for(const [name,platform] of [['windows','x86_64-pc-windows-msvc'],['linux','x86_64-manylinux_2_28']]){
    const result=spawnSync(uv,['pip','compile',input,'--python-version',spec.python,'--python-platform',platform,'--generate-hashes','--no-header',
      '--no-annotate','--extra-index-url',spec.torch_index,'--index-strategy','unsafe-best-match','--output-file',path.join(repo,'worker/requirements-'+name+'.lock')],
      {env:{...process.env,UV_CACHE_DIR:path.join(root,'cache/uv'),UV_PYTHON_INSTALL_DIR:path.join(root,'python')},windowsHide:true,stdio:['ignore','ignore','inherit']});
    if(result.error)throw result.error;
    if(result.status!==0)throw Error('Lock generation failed for '+name);
    console.log('Locked '+name);
  }
}finally{await rm(directory,{recursive:true,force:true});}
