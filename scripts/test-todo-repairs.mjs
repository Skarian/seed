// Isolated application/browser QA. Never contacts GPU providers or opens real user data.
import {mkdir,mkdtemp,writeFile,readFile,cp,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

const root=path.resolve(process.env.SEED_ATLAS_ROOT??'.local/todo-repair-atlas');
await mkdir(root,{recursive:true});
const webRoot=await mkdtemp(path.resolve('.local/todo-repair-web-'));
const serverRoot=await mkdtemp(path.resolve('.local/todo-repair-server-'));
const id=new Date().toISOString();
await writeFile(path.join(root,'run.json'),JSON.stringify({id,webRoot,serverRoot},null,2));
const env={...process.env,SEED_ATLAS_ROOT:root,SEED_ATLAS_RUN_ID:id,SEED_QA_WEB_ROOT:webRoot,SEED_QA_SERVER_ROOT:serverRoot};
function run(args,extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:'inherit',env:{...env,...extra}});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
for(const args of [['node_modules/typescript/bin/tsc','-p','tsconfig.server.json','--outDir',serverRoot],['node_modules/vite/bin/vite.js','build','--outDir',webRoot]]){const code=await run(args);if(code)process.exit(code);}
await cp('prompting',path.join(serverRoot,'prompting'),{recursive:true});await mkdir(path.join(serverRoot,'worker'),{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json'])await copyFile('worker/'+name,path.join(serverRoot,'worker',name));
const pool=await run(['scripts/test-browser.mjs','launch-failures-atlas.spec.ts','progress-atlas.spec.ts','--workers=1'],{SEED_VISUAL_ATLAS:'1'});
const recovery=await run(['scripts/test-browser.mjs','app-recovery.spec.ts','chat-branch.spec.ts','chat-branch-lifecycle.spec.ts','media-preview-lan.spec.ts','worker-pool-actions.spec.ts','worker-forms.spec.ts','worker-notifications.spec.ts','--workers=1'],{SEED_VISUAL_ATLAS:'0'});
const specs=['app-recovery','launch-failures-atlas','progress-atlas'];
const blocks=await Promise.all(specs.map(async spec=>(await readFile(`tests/browser/${spec}.spec.ts`,'utf8')).match(/const catalog = \[([\s\S]*?)\] as const;/)[1]));
const catalog=path.join(root,'catalog.ts');await writeFile(catalog,'const catalog = ['+blocks.join('')+'] as const;');
const report=await run(['scripts/visual-atlas.mjs'],{SEED_ATLAS_SPEC:catalog,SEED_ATLAS_COVERAGE:'Failed launches, startup reporting and crash recovery. Isolated app and provider boundaries; no rentals or private requests. Every capture is reviewed individually; mosaics are navigation aids. A forced render failure tests recovery, not reproduction of the intermittent Branch report.'});
process.exitCode=pool||recovery||report;
