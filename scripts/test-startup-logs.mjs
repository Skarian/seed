import {mkdir,mkdtemp,writeFile,cp,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const root=path.resolve('.local/startup-logs-atlas');await mkdir(root,{recursive:true});
const webRoot=await mkdtemp(path.resolve('.local/startup-logs-web-')),serverRoot=await mkdtemp(path.resolve('.local/startup-logs-server-')),id=new Date().toISOString();
await writeFile(path.join(root,'run.json'),JSON.stringify({id,webRoot,serverRoot},null,2));
const env={...process.env,SEED_ATLAS_ROOT:root,SEED_ATLAS_RUN_ID:id,SEED_QA_WEB_ROOT:webRoot,SEED_QA_SERVER_ROOT:serverRoot};
function run(args,extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:'inherit',env:{...env,...extra}});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
for(const args of [['node_modules/typescript/bin/tsc','-p','tsconfig.server.json','--outDir',serverRoot],['node_modules/vite/bin/vite.js','build','--outDir',webRoot]]){const code=await run(args);if(code)process.exit(code);}
await cp('prompting',path.join(serverRoot,'prompting'),{recursive:true});await mkdir(path.join(serverRoot,'worker'),{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json'])await copyFile('worker/'+name,path.join(serverRoot,'worker',name));
const tested=await run(['scripts/test-browser.mjs','startup-logs-atlas.spec.ts',...process.argv.slice(2)],{SEED_VISUAL_ATLAS:'1'});
const report=await run(['scripts/visual-atlas.mjs'],{SEED_ATLAS_SPEC:'tests/browser/startup-logs-atlas.spec.ts',SEED_ATLAS_COVERAGE:'Startup logs through Ready and release: provider boot, empty/delayed reads, download/verification/engine progress, failures, retained evidence and long output. Desktop and mobile, isolated fixture only. Each screenshot reviewed separately; mosaics are navigation aids.'});
process.exitCode=tested||report;
