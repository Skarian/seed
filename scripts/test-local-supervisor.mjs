/** Windows containment with CPU-only child processes. Never starts a GPU engine. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

if(process.platform!=='win32')throw Error('This test requires Windows.');
const python=process.argv[2];
if(!python)throw Error('Pass a Python executable.');
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(path.resolve('.local/tests/local-supervisor-'));

const gone=pid=>{try{process.kill(pid,0);return false;}catch{return true;}};
const until=async(check,label)=>{for(let i=0;i<200;i++){const value=await check();if(value)return value;await delay(50);}throw Error(label);};
const supervise=(log,deviceId,code)=>spawn(python,['-m','worker.local_supervisor','--device-id',deviceId,'--cwd',process.cwd(),'--log',log,'--venv-python',python,'--',python,'-c',code],
  {cwd:process.cwd(),env:{...process.env,PYTHONPATH:process.cwd(),PYTHONUNBUFFERED:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});
const fixture=(name,code)=>{
  const log=path.join(root,name+'.log'),deviceId=randomUUID(),child=supervise(log,deviceId,code);
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();
  return {child,log,deviceId,events:()=>output.split('\n').filter(Boolean).map(line=>JSON.parse(line))};
};
// The gateway prints its child's PID, then both wait until something ends them.
const family=`import os,subprocess,sys,time
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(600)'])
print(os.getpid(),child.pid,flush=True)
time.sleep(600)`;
const pids=log=>until(async()=>{const text=await readFile(log,'utf8').catch(()=>'');return text.trim()?text.trim().split(/\s+/).map(Number):null;},'Fixture did not start.');

// The coordinator's pipe closing ends the whole tree.
const contained=fixture('contained',family);
const [gateway,grandchild]=await pids(contained.log);
assert.ok(contained.events().some(event=>event.event==='started'));
contained.child.stdin.end();
await once(contained.child,'close');
await until(()=>gone(gateway)&&gone(grandchild),'A contained process survived its coordinator.');
console.log('Pipe closure ended every member.');

// One device has one supervisor at a time.
const holder=fixture('holder',family);
await pids(holder.log);
const duplicate=supervise(path.join(root,'duplicate.log'),holder.deviceId,'pass');
let refused='';duplicate.stderr.on('data',chunk=>refused+=chunk);duplicate.stdout.resume();
await once(duplicate,'close');
assert.match(refused,/already belongs/);
holder.child.stdin.end();await once(holder.child,'close');
console.log('A second supervisor for the same GPU was refused.');

// A normal exit needs no signal: the supervisor follows once the Job is empty.
const normal=fixture('normal','import time; time.sleep(0.2)');
const [code]=await once(normal.child,'close');
assert.equal(code,0);
console.log('The supervisor exited after its members exited.');

// Losing the gateway while a member lives is reported, and containment still holds.
const orphan=fixture('orphan',`import os,subprocess,sys
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(600)'])
print(child.pid,flush=True)
os._exit(3)`);
const [survivor]=await pids(orphan.log);
await until(()=>orphan.events().some(event=>event.event==='gateway_exit'),'Gateway loss was not reported.');
assert.equal(gone(survivor),false);
orphan.child.stdin.end();await once(orphan.child,'close');
await until(()=>gone(survivor),'The orphan survived containment.');
console.log('Gateway loss was reported and containment still ended the orphan.');

// Keep-awake commands reach the supervisor without disturbing its members.
const awake=fixture('awake',family);
await pids(awake.log);
awake.child.stdin.write('keep_awake on\nkeep_awake off\n');await delay(300);
assert.equal(awake.child.exitCode,null);
awake.child.stdin.end();await once(awake.child,'close');
console.log('Containment test passed.');
