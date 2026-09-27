import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const root=path.resolve('.local/batch-preview-atlas');await mkdir(root,{recursive:true});
const webRoot=await mkdtemp(path.resolve('.local/batch-preview-web-')),id=new Date().toISOString();
await writeFile(path.join(root,'run.json'),JSON.stringify({id,webRoot},null,2));
const env={...process.env,SEED_ATLAS_ROOT:root,SEED_ATLAS_RUN_ID:id,SEED_QA_WEB_ROOT:webRoot,SEED_ORGANIZATION_ROOT:path.join(root,'organization-regression')};
function run(args,extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:'inherit',env:{...env,...extra}});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
const built=await run(['node_modules/vite/bin/vite.js','build','--outDir',webRoot]);if(built)process.exit(built);
const tested=await run(['scripts/test-browser.mjs','batch-preview.spec.ts',...process.argv.slice(2)]);
const reported=await run(['scripts/visual-atlas.mjs'],{SEED_ATLAS_SPEC:'tests/browser/batch-preview.spec.ts',SEED_ATLAS_COVERAGE:'Batch navigation in Chat and Generate. Fixture generation records, real local uploads and asset/organization APIs; no generation, provider calls or private user content. Desktop/mobile, native touch gestures, keyboard, loading/error recovery, and preview regressions.'});
process.exitCode=tested||reported;
