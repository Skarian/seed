import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,cp,copyFile} from 'node:fs/promises';
import path from 'node:path';

// Builds and test storage are isolated from the running Seed installation.
const root=path.resolve('.local/remote-access-atlas');
await mkdir(root,{recursive:true});
const webRoot=await mkdtemp(path.resolve('.local/remote-access-web-'));
const serverRoot=await mkdtemp(path.resolve('.local/remote-access-server-'));
const id=new Date().toISOString();
await writeFile(path.join(root,'run.json'),JSON.stringify({id,webRoot,serverRoot},null,2));
const env={...process.env,SEED_QA_SERVER_ROOT:serverRoot,SEED_QA_WEB_ROOT:webRoot,SEED_ATLAS_ROOT:root,SEED_ATLAS_RUN_ID:id};
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:'inherit',env});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
let code=await run(['node_modules/typescript/bin/tsc','-p','tsconfig.server.json','--outDir',serverRoot]);if(code)process.exit(code);
await cp('prompting',path.join(serverRoot,'prompting'),{recursive:true});
await mkdir(path.join(serverRoot,'worker'),{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json'])await copyFile('worker/'+name,path.join(serverRoot,'worker',name));
code=await run(['node_modules/vite/bin/vite.js','build','--outDir',webRoot]);if(code)process.exit(code);
const proxy=await run(['scripts/test-remote-proxy.mjs']);
if(proxy)process.exit(proxy);
const browser=await run(['scripts/test-browser.mjs','admin-access.spec.ts',...process.argv.slice(2)]);
Object.assign(env,{SEED_ATLAS_SPEC:'tests/browser/admin-access.spec.ts',SEED_ATLAS_COVERAGE:'Real isolated settings persistence and HTTP origin checks, real local TLS reverse proxy, chunked uploads/resume, media byte ranges, chat events and reconnect. Desktop/mobile settings states; persistence failure is explicitly simulated in the browser. No real user content, external tunnel, or GPU requests.'});
const report=await run(['scripts/visual-atlas.mjs']);
if(!browser&&!report){
  const index=path.join(root,'index.html');
  const html=await readFile(index,'utf8');
  await writeFile(index,html.replace('</header>','<p><a href="mobile-narrow/935.png">935 · Save failure at 320px mobile width</a></p></header>'));
}
process.exitCode=browser||report;
