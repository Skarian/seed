import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {superviseTunnel,terminalSshError} from '../../operations/tunnel.mjs';

function child(){const p=new EventEmitter();p.exitCode=null;p.killed=false;p.kill=()=>{p.killed=true;queueMicrotask(()=>p.emit('close',null));};return p;}

test('terminal SSH failures stop instead of retrying invalid keys or occupied ports',async()=>{
  for(const message of ['Permission denied (publickey).','REMOTE HOST IDENTIFICATION HAS CHANGED!','bind: Address already in use']){
    let starts=0,closed=0;const reported=[];
    await superviseTunnel([],{
      startControl:async()=>async()=>{closed++;},
      spawnProcess:()=>{starts++;const p=child();p.stderr=new EventEmitter();queueMicrotask(()=>{p.stderr.emit('data',Buffer.from(message));p.emit('close',255);});return p;},
      sleep:async()=>{throw Error('Must not retry terminal failure');},say:value=>reported.push(value),
    });
    assert.equal(starts,1);assert.equal(closed,1);assert.equal(reported[0],terminalSshError(message));
  }
  assert.equal(terminalSshError('Connection reset by peer'),null);
});

test('three failed transport probes reopen a stalled tunnel, preserving control',async()=>{
  let stop,starts=0,probes=0,closed=0;
  await superviseTunnel([],{
    startControl:async callback=>{stop=callback;return async()=>{closed++;};},
    spawnProcess:()=>{starts++;const p=child();if(starts===2)queueMicrotask(()=>void stop());return p;},
    probe:async()=>{probes++;return false;},probeInterval:2,sleep:async()=>{},say:()=>{},
  });
  assert.equal(starts,2);assert.equal(probes,3);assert.equal(closed,1);
});

test('stop during control startup closes control without starting SSH',async()=>{
  let closed=0;
  await superviseTunnel([],{
    startControl:async stop=>{await stop();return async()=>{closed++;};},
    spawnProcess:()=>{throw Error('Must not start after stop');},
  });
  assert.equal(closed,1);
});

test('tunnel reconnects with unchanged SSH arguments and one control endpoint',async()=>{
  let stop,starts=0,controls=0,closed=0;const waits=[],args=['-N','root@worker'];
  await superviseTunnel(args,{
    startControl:async callback=>{controls++;stop=callback;return async()=>{closed++;};},
    spawnProcess:(file,actual,options)=>{assert.equal(file,'ssh');assert.deepEqual(actual,args);assert.equal(options.windowsHide,true);starts++;const p=child();queueMicrotask(()=>starts<3?p.emit('close',255):void stop());return p;},
    sleep:async ms=>{waits.push(ms);},now:()=>0,say:()=>{},
  });
  assert.equal(starts,3);assert.equal(controls,1);assert.equal(closed,1);assert.deepEqual(waits,[1000,2000]);
});

test('stopping during reconnect backoff cancels retries',async()=>{
  let stop,starts=0,closed=0;
  await superviseTunnel([],{
    startControl:async callback=>{stop=callback;return async()=>{closed++;};},
    spawnProcess:()=>{starts++;const p=child();queueMicrotask(()=>p.emit('close',255));return p;},
    sleep:async(ms,value,{signal})=>{await stop();assert.equal(signal.aborted,true);throw Error('aborted');},say:()=>{},
  });
  assert.equal(starts,1);assert.equal(closed,1);
});

test('spawn errors retry and backoff caps at thirty seconds',async()=>{
  let stop,starts=0;const waits=[];
  await superviseTunnel([],{
    startControl:async callback=>{stop=callback;return async()=>{};},
    spawnProcess:()=>{starts++;const p=child();queueMicrotask(()=>{if(starts===9){void stop();return;}p.emit('error',Error('spawn failed'));p.emit('close',-2);});return p;},
    sleep:async ms=>{waits.push(ms);},now:()=>0,say:()=>{},
  });
  assert.deepEqual(waits,[1000,2000,4000,8000,16000,30000,30000,30000]);
});
