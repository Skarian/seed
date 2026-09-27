import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.SEED_CARDS_ROOT ?? '.local/request-card-atlas');
await mkdir(root, { recursive: true });
const webRoot = await mkdtemp(path.resolve('.local/request-cards-web-'));
const serverRoot = await mkdtemp(path.resolve('.local/request-cards-server-'));
const runId = new Date().toISOString();
await writeFile(path.join(root,'run.json'),JSON.stringify({id:runId,webRoot,serverRoot,filters:process.argv.slice(2)},null,2));
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: 'inherit', env: {...process.env,...env} });
    child.once('error',reject); child.once('exit',code=>resolve(code??1));
  });
}
// The live server and rented workers keep running. Only the isolated fixture uses this build.
const compiled = await run(['node_modules/typescript/bin/tsc','-p','tsconfig.server.json','--outDir',serverRoot]);
if(compiled)process.exit(compiled);
await cp('prompting',path.join(serverRoot,'prompting'),{recursive:true});
await mkdir(path.join(serverRoot,'worker'),{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json'])await copyFile('worker/'+name,path.join(serverRoot,'worker',name));
const built = await run(['node_modules/vite/bin/vite.js','build','--outDir',webRoot]);
if (built) process.exit(built);
const tested = await run(['scripts/test-browser.mjs','request-card-atlas.spec.ts','chat-branch.spec.ts','chat-branch-lifecycle.spec.ts','chat-approval-lifecycle.spec.ts','chat-approval-refresh.spec.ts',...process.argv.slice(2)], {SEED_VISUAL_ATLAS:'0',SEED_QA_WEB_ROOT:webRoot,SEED_QA_SERVER_ROOT:serverRoot,SEED_CARDS_ROOT:root,SEED_ATLAS_RUN_ID:runId});
const scenarioCount=[...(await readFile('tests/browser/request-card-atlas.spec.ts','utf8')).matchAll(/\['\d{3}',/g)].length;
const reported = await run(['scripts/visual-atlas.mjs'],{SEED_ATLAS_RUN_ID:runId,SEED_ATLAS_ROOT:root,SEED_ATLAS_SPEC:'tests/browser/request-card-atlas.spec.ts',SEED_ATLAS_COVERAGE:`${scenarioCount} request-card scenarios on desktop and touch-enabled mobile; 10 widths per scenario (320–1440px), plus landscape and a 720px CSS viewport equivalent to a 1440px window at 200% zoom. All four workflows, zero to three LoRAs, short/medium/long/unbroken/multilingual/missing names, versions, lifecycle states, drafts and reviews. Scenarios 244–262 check approval → queued → running at every width, including heading Edit, attached actions, compact height and working Edit. Approval coverage also includes waiting siblings, preparation, retry, interruption and Stop. These are deterministic rendering checks; no paid providers are called. Screenshots are reviewed individually; mosaics are navigation aids.`});
process.exitCode = tested || reported;
