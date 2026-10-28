/** CPU-only recovery proof against real process identities; no lease or GPU. */
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const build=path.resolve(process.env.SEED_QA_SERVER_ROOT??'dist');
const {LocalRuntime}=await import(pathToFileURL(path.join(build,'server/local-runtime.js')));
const {resolvePaths}=await import(pathToFileURL(path.join(build,'server/storage.js')));
const root=path.resolve('.local/local-worker'),incarnation=randomUUID(),directory=path.join(root,'instances',incarnation);
const installed=JSON.parse(await readFile(path.join(root,'runtime-ready.json'),'utf8'));
const {stdout}=await promisify(execFile)(installed.roles.image.base_python,['-c',
  'import sys; from worker.local_members import Windows; a=Windows(); h=a.open(int(sys.argv[1])); print(a.created(h)); a.close(h)',String(process.pid)],
  {cwd:build,windowsHide:true});
const created=stdout.trim();assert.match(created,/^\d+$/);
const stops=[];
const runtime=new LocalRuntime(resolvePaths(path.resolve('.local/tests/ownership-profile')),root,undefined,record=>stops.push(record));
const owner={incarnation,owner_pid:process.ppid,owner_created:'1',supervisor_pid:process.pid,supervisor_created:created,
  members:[],role:'image',runtime_revision:'fixture',containment:'windows-nested-jobs-v2'};
await mkdir(directory,{recursive:true});
try{
  await writeFile(path.join(directory,'members.json'),'[]');
  await writeFile(path.join(directory,'launch-authorized.json'),'{}');
  assert.equal(await runtime.ownershipGone(owner),false,'a live exact supervisor cannot be released');
  owner.supervisor_created='1';
  assert.equal(await runtime.ownershipGone(owner),true,'aborted launch and reused PIDs must recover');
  await writeFile(path.join(directory,'members.json'),JSON.stringify([{pid:process.pid,created}]));
  assert.equal(await runtime.ownershipGone(owner),false,'a live exact member retains ownership');
  await writeFile(path.join(directory,'members.json'),JSON.stringify([{pid:process.pid,created:'1'}]));
  assert.equal(await runtime.ownershipGone(owner),true,'an unrelated process reusing a member PID cannot strand recovery');
  await writeFile(path.join(directory,'unresolved-members.json'),JSON.stringify([process.pid]));
  assert.equal(await runtime.ownershipGone(owner),false,'legacy unresolved identity stays unknown');
  await writeFile(path.join(directory,'unresolved-members.json'),JSON.stringify([{pid:process.pid,created:null,first_seen:String(BigInt(created)-1n)}]));
  assert.equal(await runtime.ownershipGone(owner),false,'wall-clock ordering cannot resolve an unknown process identity');
  console.log('Six real Windows recovery identity checks passed; no engine started.');
  await writeFile(path.join(directory,'unresolved-members.json'),'[]');
  const child=spawn(installed.roles.image.base_python,['-m','worker.local_supervisor','--parent-pid',String(process.pid),
    '--cwd',build,'--log',path.join(directory,'fixture.log'),'--diagnostics',directory,'--await-owner','--gateway-only',
    '--device-id','test-'+randomUUID(),'--',path.join(directory,'does-not-exist.exe')],
    {cwd:build,windowsHide:true,stdio:['pipe','pipe','pipe'],signal:AbortSignal.timeout(15000)});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();
  child.stdin.on('error',()=>{});child.stdin.end('launch\n');
  await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
  const events=output.trim().split('\n').map(line=>JSON.parse(line));
  const contained=events.find(event=>event.event==='contained');assert.ok(contained);
  assert.equal(events.at(-1).event,'launch_failed');
  runtime.rememberOwnership({...owner,owner_pid:process.pid,owner_created:contained.owner_created,
    supervisor_pid:contained.supervisor_pid,supervisor_created:contained.supervisor_created});
  assert.equal((await runtime.stop()).outcome,'stopped');
  assert.equal(stops.at(-1).receipt.result,'no_engine');assert.equal(stops.at(-1).receipt.reason,'launch_aborted');
  console.log('Real missing-executable launch recovered without Force and wrote a launch_aborted/no_engine receipt.');
}finally{
  const relative=path.relative(path.join(root,'instances'),directory);
  assert.equal(relative,incarnation);assert.match(relative,/^[\da-f-]{36}$/);
  await rm(directory,{recursive:true,force:true});
}
