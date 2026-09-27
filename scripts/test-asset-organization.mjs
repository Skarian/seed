import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,cp,copyFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(process.env.SEED_ORGANIZATION_ROOT??'.local/asset-organization-atlas');
await mkdir(root,{recursive:true});
const webRoot=await mkdtemp(path.resolve('.local/asset-organization-web-'));
const serverRoot=await mkdtemp(path.resolve('.local/asset-organization-server-'));
const id=new Date().toISOString();
await writeFile(path.join(root,'run.json'),JSON.stringify({id,webRoot,serverRoot},null,2));
const env={...process.env,SEED_ORGANIZATION_ROOT:root,SEED_QA_SERVER_ROOT:serverRoot,SEED_QA_WEB_ROOT:webRoot,SEED_ATLAS_RUN_ID:id};
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:'inherit',env});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
let code=await run(['node_modules/typescript/bin/tsc','-p','tsconfig.server.json','--outDir',serverRoot]);if(code)process.exit(code);
await cp('prompting',path.join(serverRoot,'prompting'),{recursive:true});
await mkdir(path.join(serverRoot,'worker'),{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json'])await copyFile('worker/'+name,path.join(serverRoot,'worker',name));
code=await run(['node_modules/vite/bin/vite.js','build','--outDir',webRoot]);if(code)process.exit(code);
const tested=await run(['scripts/test-browser.mjs','asset-organization.spec.ts',...process.argv.slice(2)]);
Object.assign(env,{SEED_ATLAS_ROOT:root,SEED_ATLAS_SPEC:'tests/browser/asset-organization.spec.ts',SEED_ATLAS_COVERAGE:'Isolated real server and database. Public fixture images, video and audio uploaded through the real media API; favorites and collection writes use real application routes. Targeted delayed/error responses are explicitly simulated. No user media, private conversations, GPU rentals or outside requests.'});
const reported=await run(['scripts/visual-atlas.mjs']);process.exitCode=tested||reported;
