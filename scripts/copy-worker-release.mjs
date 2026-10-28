import {mkdir,copyFile,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
const destination=path.join(process.argv[2]??'dist','worker');
await mkdir(destination,{recursive:true});
for(const name of await readdir('worker')){
  if((name.endsWith('.py')&&!name.startsWith('test_'))||name.endsWith('.json')||name.startsWith('requirements-local-'))
    await copyFile('worker/'+name,path.join(destination,name));
}
for(const name of ['comfy_seed','static'])await cp('worker/'+name,path.join(destination,name),{recursive:true,filter:source=>!source.includes('__pycache__')});
const scripts=path.join(path.dirname(destination),'scripts');await mkdir(scripts,{recursive:true});
for(const name of ['setup-local-worker.mjs','local-lock.mjs'])await copyFile('scripts/'+name,path.join(scripts,name));
