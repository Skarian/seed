/** Maintainer command: freeze tested native environments and resolve hashes. */
import {execFileSync,spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.env.SEED_LOCAL_ROOT||path.join(repo,'.local/local-worker'));
const manifest=JSON.parse(await readFile(path.join(repo,'worker/local-runtime.json'),'utf8'));
const uv=path.join(root,'tools/uv.exe');
const env={...process.env,UV_CACHE_DIR:path.join(root,'cache/uv'),UV_PYTHON_INSTALL_DIR:path.join(root,'python')};
for(const role of ['image','video']){
  const python=path.join(root,role,'venv/Scripts/python.exe'),input=path.join(root,role,'installed.txt');
  await writeFile(input,execFileSync(uv,['pip','freeze','--python',python],{env,windowsHide:true,encoding:'utf8'}));
  await new Promise((resolve,reject)=>{
    const child=spawn(uv,['pip','compile',input,'--python',python,'--generate-hashes','--no-header','--extra-index-url',manifest.torch_index,
      '--index-strategy','unsafe-best-match','--output-file',path.join(repo,'worker/requirements-local-'+role+'.lock')],{env,windowsHide:true,stdio:['ignore','ignore','inherit']});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Lock generation failed: '+code)));
  });
  console.log('Locked '+role);
}
