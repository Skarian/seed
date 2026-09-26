import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,cp,copyFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.env.SEED_OFFERS_ROOT??'.local/worker-offers-atlas');
await mkdir(root,{recursive:true});
const webRoot=await mkdtemp(path.resolve('.local/worker-offers-web-'));
const serverRoot=await mkdtemp(path.resolve('.local/worker-offers-server-'));
const id=new Date().toISOString();
await writeFile(path.join(root,'run.json'),JSON.stringify({id,webRoot,serverRoot},null,2));
const env={...process.env,SEED_OFFERS_ROOT:root,SEED_QA_SERVER_ROOT:serverRoot,SEED_QA_WEB_ROOT:webRoot,SEED_ATLAS_RUN_ID:id};
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:'inherit',env});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
let code=await run(['node_modules/typescript/bin/tsc','-p','tsconfig.server.json','--outDir',serverRoot]);if(code)process.exit(code);
await cp('prompting',path.join(serverRoot,'prompting'),{recursive:true});
await mkdir(path.join(serverRoot,'worker'),{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json'])await copyFile('worker/'+name,path.join(serverRoot,'worker',name));
code=await run(['node_modules/vite/bin/vite.js','build','--outDir',webRoot]);if(code)process.exit(code);
if(process.argv.includes('--live')){code=await run(['scripts/capture-worker-offers.mjs']);if(code)process.exit(code);}
const spec=process.argv.includes('--gpu-filter')?'gpu-type-filter.spec.ts':'worker-offers-atlas.spec.ts';
const tested=await run(['scripts/test-browser.mjs',spec,'worker-pool-actions.spec.ts','worker-forms.spec.ts']);
Object.assign(env,{SEED_ATLAS_ROOT:root,SEED_ATLAS_SPEC:'tests/browser/'+spec,SEED_ATLAS_COVERAGE:'Current Vast and RunPod catalog offers, replayed through the real picker in an isolated app. Catalog capture is read-only. No rentals, user requests or private conversations. Desktop and mobile screenshots reviewed individually; mosaics are navigation aids. Unknown-field edge cases are labeled separately.'});
const reported=await run(['scripts/visual-atlas.mjs']);process.exitCode=tested||reported;
