/** Exercise authenticated local transport without starting a GPU engine. */
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const build=path.resolve(process.env.SEED_QA_SERVER_ROOT??'dist');
const {LocalRuntime}=await import(pathToFileURL(path.join(build,'server/local-runtime.js')));
const {resolvePaths,prepareStorage}=await import(pathToFileURL(path.join(build,'server/storage.js')));
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(path.resolve('.local/tests/local-runtime-'));
const paths=resolvePaths(root);prepareStorage(paths);
const runtime=new LocalRuntime(paths,path.join(root,'runtime'));
await mkdir(runtime.root,{recursive:true});
const source=path.resolve(process.env.SEED_LOCAL_ROOT??'.local/local-worker');
const installed=JSON.parse(await readFile(path.join(source,'runtime-ready.json'),'utf8'));
// Isolated lease and synthetic device identity: this CPU test cannot reserve
// the user's actual GPU or edit the installed engine's custom nodes.
runtime.installation=async()=>({...installed,gpu_uuid:randomUUID()});
try{
  const connection=await runtime.start(true);
  const status=await connection.status({fresh:true});
  assert.equal(status.worker_class,'all');assert.equal(status.state,'preparing');assert.equal(status.engine_session_id,null);
  await assert.rejects(connection.json('/comfy/session'));
  console.log('Authenticated recovery gateway passed; no engine started.');
}finally{assert.deepEqual(await runtime.close(),{outcome:'stopped'});}
assert.equal(runtime.alive,false);
console.log('The recovery gateway stopped with its supervisor.');
