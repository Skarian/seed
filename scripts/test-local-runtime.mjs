/** Exercise authenticated local transport without loading GPU models. */
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const build=path.resolve(process.env.SEED_QA_SERVER_ROOT??'dist');
const {LocalRuntime,processGone}=await import(pathToFileURL(path.join(build,'server/local-runtime.js')));
const {resolvePaths,prepareStorage}=await import(pathToFileURL(path.join(build,'server/storage.js')));
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(path.resolve('.local/tests/local-runtime-'));
const paths=resolvePaths(root);prepareStorage(paths);
let ownership;
const runtime=new LocalRuntime(paths,path.join(root,'runtime'),value=>ownership=value);
await mkdir(runtime.root,{recursive:true});
const installed=JSON.parse(await readFile('.local/local-worker/runtime-ready.json','utf8'));
// Isolated lease and synthetic device identity: this CPU test cannot reserve
// the user's actual GPU or edit the installed engine's custom nodes.
runtime.installation=async()=>({...installed,roles:{image:{...installed.roles.image,gpu_uuid:randomUUID()}}});
try{
  const connection=await runtime.start('image',true);
  const status=await connection.status({fresh:true});
  assert.equal(status.worker_class,'image');assert.equal(status.state,'preparing');assert.equal(status.engine_session_id,null);
  assert.ok(ownership);assert.equal(ownership.owner_pid,process.pid);
  await assert.rejects(connection.json('/comfy/session'));
  console.log('Authenticated recovery gateway passed; no engine started.');
}finally{await runtime.close();}
assert.ok(processGone(ownership.gateway_pid));assert.ok(processGone(ownership.supervisor_pid));
assert.ok(ownership.members.length>=1);
const receipt=JSON.parse(await readFile(path.join(runtime.root,'instances',ownership.incarnation,'termination.json'),'utf8'));
assert.equal(receipt.mode,'no_engine');
assert.deepEqual(receipt.members,ownership.members);
console.log('All recovery gateway members confirmed exited with a no-engine receipt; no GPU engine was started.');
