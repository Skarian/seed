/** Fault-injection tests of the actual Windows ownership boundary. No GPU use. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const python=process.env.SEED_TEST_PYTHON || path.resolve('.local/local-worker/image/venv/Scripts/python.exe');
const supervisorPython=execFileSync(python,['-c','import sys; print(sys._base_executable)'],{encoding:'utf8',windowsHide:true}).trim();
const repo=path.resolve('.');
if(process.platform!=='win32')throw Error('Windows containment must be tested on Windows.');
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(path.resolve('.local/tests/local-supervisor-'));
const fixture=path.join(root,'tree.py');
const deviceId='test-'+randomUUID();
await writeFile(fixture,"import subprocess,sys,os,json,time\nchild=subprocess.Popen([sys.executable,'-c','import time; time.sleep(120)'])\nprint(json.dumps({'engine':os.getpid(),'descendant':child.pid}),flush=True)\ntime.sleep(120)\n");
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function eventually(fn){for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw Error('Process lifetime assertion timed out.');}
for(const mode of ['normal-command','external-handle','no-engine-rejected','engine-exit','gateway-exit','unconfirmed','supervisor-death','coordinator-death']){
  const log=path.join(root,mode+'.log');
  const ownerScript=path.join(root,mode+'.mjs');
  const diagnosticDirectory=path.join(root,mode);
  const supervisorArgs=['-m','worker.local_supervisor','--parent-pid','PARENT','--cwd',repo,'--log',log,'--device-id',deviceId,
    '--diagnostics',diagnosticDirectory,'--system-required','--',python,fixture];
  if(mode==='unconfirmed'){
    const injected=path.join(root,'unconfirmed-supervisor.py');
    await writeFile(injected,`import worker.local_supervisor as s\nfrom worker.local_members import Windows\noriginal=Windows.open\nfirst=[None]\ndef denied(self,pid):\n if first[0] is None: first[0]=pid\n if pid!=first[0]: raise OSError('fixture access denied')\n return original(self,pid)\nWindows.open=denied\nclock=[0]\ndef tick():\n clock[0]+=10\n return clock[0]\ns.time.monotonic=tick\ns.main()\n`);
    supervisorArgs.splice(0,2,injected);
  }
  await writeFile(ownerScript,`import {spawn} from 'node:child_process';\nconst args=${JSON.stringify(supervisorArgs)}.map(v=>v==='PARENT'?String(process.pid):v);\nconst p=spawn(${JSON.stringify(supervisorPython)},args,{cwd:${JSON.stringify(repo)},env:{...process.env,PYTHONPATH:${JSON.stringify(repo)}},windowsHide:true,stdio:['pipe','pipe','inherit']});p.stdout.pipe(process.stdout);process.stdin.on('data',d=>p.stdin.write(d));p.on('exit',()=>process.exit(0));`);
  const owner=spawn(process.execPath,[ownerScript],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  let output='';owner.stdout.on('data',d=>output+=d);
  let tree,started,holder;
  try{
    await eventually(async()=>{try{tree=JSON.parse((await readFile(log,'utf8')).trim());started=output.split('\n').filter(Boolean).map(l=>JSON.parse(l)).find(v=>v.event==='started');return !!started;}catch{return false;}});
    assert.ok(alive(tree.engine)&&alive(tree.descendant));
    if(mode!=='unconfirmed')await eventually(()=>output.split('\n').filter(Boolean).map(JSON.parse).some(event=>event.event==='member'&&event.pid===tree.descendant));
    const duplicate=spawn(supervisorPython,supervisorArgs.map(v=>v==='PARENT'?String(process.pid):v),{cwd:repo,env:{...process.env,PYTHONPATH:repo},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let duplicateOutput='';duplicate.stdout.on('data',d=>duplicateOutput+=d);
    await eventually(()=>duplicate.exitCode!==null);
    assert.notEqual(duplicate.exitCode,0);assert.ok(!duplicateOutput.split('\n').filter(Boolean).some(line=>['started','member'].includes(JSON.parse(line).event)));
    assert.ok(alive(tree.engine)&&alive(tree.descendant),'Rejected duplicate must not disturb the owner');
    if(mode==='external-handle'){
      holder=spawn(supervisorPython,['-c',"import sys; from worker.local_members import Windows; api=Windows(); h=api.open(int(sys.argv[1])); print('held',flush=True); sys.stdin.readline(); api.close(h)",String(tree.descendant)],
        {cwd:repo,env:{...process.env,PYTHONPATH:repo},windowsHide:true,stdio:['pipe','pipe','inherit']});
      let held=false;holder.stdout.on('data',()=>held=true);await eventually(()=>held);
    }
    if(mode==='no-engine-rejected'){
      owner.stdin.write(JSON.stringify({op:'terminate',stop_id:'rejected-stop',mode:'no_engine',reason:'fixture'})+'\n');
      await eventually(()=>output.includes('engine_member_present'));
      assert.ok(alive(tree.engine)&&alive(tree.descendant));
    }
    if(['normal-command','external-handle','no-engine-rejected','unconfirmed'].includes(mode))owner.stdin.write(JSON.stringify({op:'terminate',stop_id:'fixture-stop',mode:'quiesced',reason:'fixture'})+'\n');
    else if(mode==='engine-exit'){process.kill(tree.descendant,'SIGKILL');process.kill(tree.engine,'SIGKILL');}
    else if(mode==='gateway-exit'){
      process.kill(tree.engine,'SIGKILL');
      await eventually(()=>output.includes('gateway_exit'));
      await delay(2000);
      assert.ok(alive(tree.descendant),'Gateway death must not kill its live descendant');
      assert.ok(alive(started.supervisor_pid));
      owner.stdin.write('stop\n');
    }
    else if(mode==='supervisor-death')process.kill(started.supervisor_pid,'SIGKILL');
    else owner.kill('SIGKILL');
    if(mode==='unconfirmed'){
      await eventually(()=>output.includes('termination_unconfirmed'));
      assert.ok(!output.includes('"event": "terminated"'));
      assert.ok(alive(started.supervisor_pid));
      const duplicate=spawn(supervisorPython,['-m','worker.local_supervisor','--parent-pid',String(process.pid),'--cwd',repo,'--log',path.join(root,'duplicate.log'),'--device-id',deviceId,'--',python,fixture],
        {cwd:repo,env:{...process.env,PYTHONPATH:repo},windowsHide:true,stdio:['ignore','ignore','ignore']});
      await eventually(()=>duplicate.exitCode!==null);assert.notEqual(duplicate.exitCode,0,'Named GPU fence stays held after unconfirmed termination');
      owner.kill('SIGKILL');
    }
    await eventually(()=>!alive(tree.engine)&&!alive(tree.descendant));
    if(['normal-command','external-handle','no-engine-rejected','engine-exit','gateway-exit'].includes(mode)){
      await eventually(async()=>{try{return (await readFile(path.join(diagnosticDirectory,'lifecycle.jsonl'),'utf8')).includes('system_required_released');}catch{return false;}});
      const journal=(await readFile(path.join(diagnosticDirectory,'lifecycle.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
      const terminated=journal.find(row=>row.event==='terminated');
      assert.ok(terminated);assert.ok(terminated.members.some(member=>member.pid===tree.descendant));
      assert.equal(terminated.mode,['engine-exit','gateway-exit'].includes(mode)?'forced':'quiesced');
      if(mode==='engine-exit')assert.equal(terminated.reason,'engine_exited');
      if(holder)assert.ok(alive(holder.pid),'An external retained process handle does not delay confirmed termination');
      assert.ok(journal.filter(row=>row.event==='member').length>=2);
      assert.ok(journal.some(row=>row.event==='system_required_acquired'));
      assert.ok(journal.some(row=>row.event==='system_required_released'));
    }
    console.log(JSON.stringify({mode,passed:true}));
  }finally{if(holder){holder.stdin.end('\n');await eventually(()=>holder.exitCode!==null);}if(alive(owner.pid))owner.kill('SIGKILL');}
}
