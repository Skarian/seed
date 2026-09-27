// Run after npm pack. Uses real dependency installation in an isolated prefix.
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';

const archive=path.resolve(process.argv[2] ?? '');
if(!archive.endsWith('.tgz'))throw Error('Usage: node scripts/test-package.mjs PACKAGE.tgz');
const root=await mkdtemp(path.join(os.tmpdir(),'seed-package-'));
const env={...process.env,STUDIO_DEV_ROOT:path.join(root,'data'),APPDATA:path.join(root,'profile')};
for(const key of Object.keys(env))if(/_(KEY|TOKEN|SECRET|PASSWORD)$/i.test(key)||/^(TAILSCALE_|TS_)/i.test(key)||['NODE_OPTIONS','SEED_MANAGED'].includes(key))delete env[key];
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
 await run([cli,'setup','--port',String(port)]);
 const guide=path.join(env.STUDIO_DEV_ROOT,'config','prompting','chat','standard.md');
 assert.match(await readFile(guide,'utf8'),/creative assistant/);
 await writeFile(guide,'Owner customized instructions');
 const marker=path.join(env.STUDIO_DEV_ROOT,'data','media','originals','preserved.txt');await writeFile(marker,'preserve me');
 assert.equal(JSON.parse(await run([cli,'version'])).generation_provider,'worker-pool');
 await run([cli,'start']);assert.match(await run([cli,'status']),/Running/);
 const origin=`http://127.0.0.1:${port}`;
 const admin=await fetch(origin+'/api/v1/admin',{headers:{Origin:origin}}).then(r=>r.json());
 assert.ok(Object.values(admin.credentials).every(value=>value.configured===false));
 // Persist a non-networked key through Admin, not a CLI prompt or environment.
 const save=await fetch(origin+'/api/v1/admin/credentials/openrouterApiKey',{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({value:'fixture-package-preserved'})});
 assert.equal(save.status,200);await run([cli,'stop']);
 const credentials=await readFile(path.join(env.STUDIO_DEV_ROOT,'config','credentials.json'),'utf8');
 await run([npm,'install','--prefix',root,archive,'--no-audit','--no-fund']);
 assert.equal(await readFile(marker,'utf8'),'preserve me');
 assert.equal(await readFile(guide,'utf8'),'Owner customized instructions');
 assert.equal(await readFile(path.join(env.STUDIO_DEV_ROOT,'config','credentials.json'),'utf8'),credentials);
 await run([cli,'start']);assert.match(await run([cli,'status']),/Running/);
 await run([cli,'stop']);
 // Synthetic next release: exercise npm's version replacement, then a broken
 // server startup and explicit reinstall of the known-good archive.
 const candidate=path.join(root,'candidate');
 const installed=path.join(root,'node_modules/@skarian/seed');
 await cp(installed,candidate,{recursive:true,filter:source=>!path.relative(installed,source).split(path.sep).includes('node_modules')});
 const manifest=JSON.parse(await readFile(path.join(candidate,'package.json'),'utf8'));
 const originalVersion=manifest.version;
 manifest.version='0.0.0-upgrade-fixture';
 await writeFile(path.join(candidate,'package.json'),JSON.stringify(manifest,null,2));
 const pack=async()=>{const result=JSON.parse(await run([npm,'pack',candidate,'--ignore-scripts','--json','--pack-destination',root]));return path.join(root,result[0].filename);};
 const upgrade=await pack();
 await run([npm,'install','--prefix',root,upgrade,'--no-audit','--no-fund']);
 assert.equal(JSON.parse(await run([cli,'version'])).version,manifest.version);
 await run([cli,'start']);assert.match(await run([cli,'status']),/Running/);await run([cli,'stop']);
 manifest.version='0.0.0-broken-fixture';
 await writeFile(path.join(candidate,'package.json'),JSON.stringify(manifest,null,2));
 await writeFile(path.join(candidate,'dist/server/main.js'),"throw new Error('Intentional package acceptance startup failure');\n");
 await run([npm,'install','--prefix',root,await pack(),'--no-audit','--no-fund']);
 await assert.rejects(run([cli,'start']),/did not start/);
 await run([npm,'install','--prefix',root,archive,'--no-audit','--no-fund']);
 assert.equal(JSON.parse(await run([cli,'version'])).version,originalVersion);
 assert.equal(await readFile(marker,'utf8'),'preserve me');
 assert.equal(await readFile(path.join(env.STUDIO_DEV_ROOT,'config','credentials.json'),'utf8'),credentials);
 await run([cli,'start']);assert.match(await run([cli,'status']),/Running/);
 console.log(JSON.stringify({passed:true,platform:process.platform,node:process.version,root,checks:['install','keyless-setup','admin-credentials','start-stop','idle-reinstall','synthetic-version-upgrade','failed-start-rollback','credential-and-media-preservation','restart']}));
} finally {await run([cli,'stop']);}
