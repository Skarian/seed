/** Cooperatively stop a benchmark; do not kill a process with CUDA work in flight. */
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

if(!process.argv[2])throw Error('Provide the qualification run directory.');
const run=path.resolve(process.argv[2]);
const runtime=JSON.parse(await readFile(path.join(run,'runtime.json'),'utf8'));
const origin=new URL(runtime.origin);
if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.origin!==runtime.origin)throw Error('Expected a private loopback benchmark.');
async function request(route,options={}){
  const response=await fetch(origin.origin+route,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Benchmark request failed: '+response.status);
  return response.json();
}
const session=await request('/studio/session');
if(session.workspace_id!==runtime.workspaceId)throw Error('Benchmark workspace identity changed.');
if(runtime.engine_session_id&&session.engine_session_id!==runtime.engine_session_id)throw Error('Benchmark engine identity changed.');
const queue=await request('/queue');
for(const item of [...queue.queue_running,...queue.queue_pending]){
  const id=item[1];if(typeof id!=='string'||!/^[a-f\d-]{36}$/i.test(id))throw Error('Invalid benchmark execution identity.');
  await access(path.join(run,id,'submission.json'));
  await request('/studio/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Engine-Session':session.engine_session_id},body:JSON.stringify({job_id:id})});
  console.log('Cancellation requested for '+id);
}
const deadline=Date.now()+60000;
while(Date.now()<deadline){
  const current=await request('/queue').catch(()=>null);
  // The benchmark normally exits its engine after the terminal manifest.
  if(!current){console.log('Engine disconnected after cancellation; verify the run result.');process.exitCode=0;break;}
  if(!current.queue_running.length&&!current.queue_pending.length){console.log('Benchmark queue is idle.');break;}
  await delay(500);
  if(Date.now()>=deadline)throw Error('Cancellation is still pending. No process was force-terminated.');
}
