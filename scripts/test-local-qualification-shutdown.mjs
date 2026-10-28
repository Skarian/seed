import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settleQualificationEngine} from './local-qualification-shutdown.mjs';
const identity={workspace_id:'workspace',engine_session_id:'session',pid:42};
const ack={...identity,stop_id:'stop',state:'parked',prepared:true,worker_alive:true,cancel_running:true,revision:{supported:true,pins_digest:'pins'},sync:{result:'ok'}};
const options={workspaceId:'workspace',sessionId:'session',pinsDigest:'pins',members:()=>[{pid:42,created:'1'}],isExited:()=>false,poll:1,stopId:'stop'};
test('waits for matching parked barrier, not an idle queue',async()=>{
  let calls=0;
  const result=await settleQualificationEngine({...options,request:async(route,init)=>{
    if(route==='/studio/session')return identity;
    assert.equal(route,'/studio/quiesce');assert.deepEqual(JSON.parse(init.body),{stop_id:'stop',cancel_running:true});
    return ++calls<3?{...ack,state:'synchronizing'}:ack;
  }});
  assert.equal(calls,3);assert.equal(result.stop_id,'stop');
});
for(const invalid of ['sync_failed','wrong_session','wrong_pid','unsupported','offline'])test('retains ownership for '+invalid,async()=>{
  let calls=0;
  const result=await settleQualificationEngine({...options,isExited:()=>calls>=3,request:async route=>{
    if(route==='/studio/session')return identity;
    calls++;
    if(invalid==='offline')throw Error('fixture');
    return {...ack,...(invalid==='sync_failed'?{state:'sync_failed'}:invalid==='wrong_session'?{engine_session_id:'other'}:invalid==='wrong_pid'?{pid:99}:{revision:{supported:false}})};
  }});
  assert.equal(result,undefined);assert.equal(calls,3);
});
