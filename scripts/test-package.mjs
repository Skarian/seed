// Run after npm pack. Uses real dependency installation in an isolated prefix.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';

const archive=path.resolve(process.argv[2] ?? '');
if(!archive.endsWith('.tgz'))throw Error('Usage: node scripts/test-package.mjs PACKAGE.tgz');
const root=await mkdtemp(path.join(os.tmpdir(),'seed-package-'));
const env={...process.env,STUDIO_DEV_ROOT:path.join(root,'data'),APPDATA:path.join(root,'profile'),VAST_API_KEY:'fixture-test-key',HF_TOKEN:'fixture-test-key'};
for(const key of ['RUNPOD_API_KEY','CIVITAI_API_TOKEN','NODE_OPTIONS','SEED_MANAGED'])delete env[key];
const npm=process.env.npm_execpath;
if(!npm)throw Error('Run via npm run test:package -- PACKAGE.tgz.');
const run=(args)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,args,{env,cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 child.once('error',reject);child.once('close',code=>code===0?resolve(output):reject(Error(output)));
});
const cli=path.join(root,'node_modules/@skarian/seed/dist/server/cli.js');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
await run([npm,'install','--prefix',root,archive,'--no-audit','--no-fund']);
try {
 await run([cli,'setup','--provider','vast','--no-cache-models','--no-startup','--port',String(port)]);
 const marker=path.join(env.STUDIO_DEV_ROOT,'data','media','originals','preserved.txt');await writeFile(marker,'preserve me');
 assert.match(await run([cli,'gpu','vast','doctor']),/"built": true/);
 await run([cli,'start']);assert.match(await run([cli,'status']),/Running/);await run([cli,'stop']);
 const credentials=await readFile(path.join(env.STUDIO_DEV_ROOT,'config','credentials.json'),'utf8');
 await run([npm,'install','--prefix',root,archive,'--no-audit','--no-fund']);
 assert.equal(await readFile(marker,'utf8'),'preserve me');
 assert.equal(await readFile(path.join(env.STUDIO_DEV_ROOT,'config','credentials.json'),'utf8'),credentials);
 await run([cli,'start']);assert.match(await run([cli,'status']),/Running/);
 console.log(JSON.stringify({passed:true,platform:process.platform,node:process.version,root,checks:['install','setup','provider-module-resolution','start-stop','idle-reinstall','credential-and-media-preservation','restart']}));
} finally {await run([cli,'stop']);}
