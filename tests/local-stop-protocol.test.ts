import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {drainLocalEngine,type EngineAck,type StopOutcome} from '../server/local-shutdown.js';
import {boundedLocalClose,closeService,closeManagedService} from '../server/service-close.js';
import {LocalRuntime} from '../server/local-runtime.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';

afterEach(()=>vi.useRealTimers());
const intent={stop_id:'stop',requested_at:'2026-10-25T00:00:00Z',reason:'normal'};
const ack=():EngineAck=>({stop_id:'stop',engine_session_id:'engine',pid:22,state:'parked',prepared:true,worker_alive:true,cancel_running:false,
  sync:{result:'ok'},revision:{supported:true,pins_digest:'pins'},faults:[],phases:{parked:100}});
const options=(request:()=>Promise<unknown>)=>({intent,session:'engine',gatewayPid:11,pinsDigest:'pins',members:()=>[{pid:11,created:'1'},{pid:22,created:'2'}],request,force:()=>false,timeout:0});

it.each(['session','stop','gateway','unknown_pid','revision','digest','prepared','alive','sync','cancel_policy'])('rejects an invalid parked acknowledgment: %s',async field=>{
  const value=ack();
  if(field==='session')value.engine_session_id='other';
  if(field==='stop')value.stop_id='other';
  if(field==='gateway')value.pid=11;
  if(field==='unknown_pid')value.pid=99;
  if(field==='revision')value.revision.supported=false;
  if(field==='digest')value.revision.pins_digest='other';
  if(field==='prepared')value.prepared=false;
  if(field==='alive')value.worker_alive=false;
  if(field==='sync')value.sync.result='failed';
  if(field==='cancel_policy')value.cancel_running=true;
  expect(await drainLocalEngine(options(async()=>value))).toHaveProperty('pending');
});
it.each(['sync_failed','worker_dead','unsupported'])('retains ownership for %s',async state=>{
  expect(await drainLocalEngine(options(async()=>({...ack(),state})))).toEqual({pending:state});
});
it('accepts persistence faults only after a valid barrier',async()=>{
  const value={...ack(),faults:[{kind:'terminal_persistence'}]};
  expect(await drainLocalEngine(options(async()=>value))).toEqual({ack:value});
});
it('accepts an already parked worker when cancellation arrives after execution finished',async()=>{
  const requested={...intent,cancel_running:true};
  expect(await drainLocalEngine({...options(async()=>ack()),intent:requested})).toHaveProperty('ack');
  expect(await drainLocalEngine({...options(async()=>({...ack(),state:'draining'})),intent:requested})).toHaveProperty('pending');
});
it.each(['collecting','synchronizing','sync_failed','worker_dead','unsupported'])('preserves %s when cancellation arrives after draining',async state=>{
  const requested={...intent,cancel_running:true};
  expect(await drainLocalEngine({...options(async()=>({...ack(),state})),intent:requested})).toEqual({pending:state});
});
it('times out without terminating, then converges when the same stop parks',async()=>{
  const request=vi.fn().mockResolvedValueOnce({...ack(),state:'synchronizing'}).mockResolvedValueOnce(ack());
  expect(await drainLocalEngine(options(request))).toEqual({pending:'synchronizing'});
  expect(await drainLocalEngine(options(request))).toHaveProperty('ack');
});
it('forces service stop at 90 seconds and returns unconfirmed at 120',async()=>{
  vi.useFakeTimers();
  const events:string[]=[],never=()=>new Promise<StopOutcome>(()=>{});
  const close=boundedLocalClose(()=>{events.push('drain');return never();},()=>{events.push('forced_intent');return never();},
    ()=>({outcome:'stop_pending',since:'fixture',phase:'termination_unconfirmed'}));
  await vi.advanceTimersByTimeAsync(89999);expect(events).toEqual(['drain']);
  await vi.advanceTimersByTimeAsync(1);expect(events).toEqual(['drain','forced_intent']);
  await vi.advanceTimersByTimeAsync(30000);expect(await close).toHaveProperty('phase','termination_unconfirmed');
});
it('a successful drain cancels the service force timer',async()=>{
  vi.useFakeTimers();const force=vi.fn();
  await boundedLocalClose(async()=>({outcome:'stopped'}),force,()=>({outcome:'stop_pending',since:'fixture',phase:'unreachable'}));
  await vi.advanceTimersByTimeAsync(120000);expect(force).not.toHaveBeenCalled();
});
it('a failed deadline journal still returns an unconfirmed outcome',async()=>{
  vi.useFakeTimers();const never=()=>new Promise<StopOutcome>(()=>{});
  const closing=boundedLocalClose(never,never,()=>{throw Error('fixture disk full');});
  await vi.advanceTimersByTimeAsync(120000);
  expect(await closing).toHaveProperty('phase','termination_unconfirmed');
});
it('cleanup reporting failure cannot skip cloud or jobs close',async()=>{
  const calls:string[]=[];
  await closeService({local:async()=>{throw Error('fixture');},background:[],failed:()=>{throw Error('fixture journal full');},
    cloud:async()=>{calls.push('cloud');},jobs:async()=>{calls.push('jobs');}});
  expect(calls).toEqual(['cloud','jobs']);
});
it('starts local close immediately and still closes cloud and jobs after failures',async()=>{
  const events:string[]=['intent'];let finish:()=>void=()=>{};
  const close=closeService({local:async()=>{events.push('local');throw Error('fixture');},
    background:[()=>{events.push('background');return new Promise<void>(resolve=>finish=resolve);}],
    cloud:async()=>{events.push('cloud');throw Error('fixture');},jobs:async()=>{events.push('jobs');},failed:stage=>{events.push('failed_'+stage);}});
  expect(events.slice(0,3)).toEqual(['intent','local','background']);finish();await close;
  expect(events.slice(-3)).toEqual(['cloud','failed_cloud','jobs']);
});
it.each(['app','control'])('managed shutdown exits at its overall deadline when %s cleanup hangs',async stage=>{
  vi.useFakeTimers();const exit=vi.fn(),never=()=>new Promise<void>(()=>{});
  const closing=closeManagedService(stage==='app'?never:async()=>{},stage==='control'?never:async()=>{},exit);
  await vi.advanceTimersByTimeAsync(139999);expect(exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);await closing;expect(exit).toHaveBeenCalledExactlyOnceWith(1);
});
it('managed shutdown closes control after an app failure and cancels its watchdog',async()=>{
  vi.useFakeTimers();const control=vi.fn(async()=>{}),exit=vi.fn();
  await closeManagedService(async()=>{throw Error('Synthetic failure');},control,exit);
  expect(control).toHaveBeenCalledOnce();expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  await vi.advanceTimersByTimeAsync(140000);expect(exit).toHaveBeenCalledOnce();
});

it('commits intent and receipt around quiesce and confirmed termination before release',async()=>{
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/stop-protocol-'));
  const paths=resolvePaths(root);prepareStorage(paths);const events:string[]=[];
  const runtime=new LocalRuntime(paths,root,undefined,value=>events.push(value.receipt?'receipt':'intent'));
  const internal=runtime as any;
  const current:any={intent:{...intent},engineSession:'engine',ownership:{gateway_pid:11,incarnation:'fixture'},members:[{pid:22,created:'2'}],
    directory:root,pinsDigest:'pins',paired:true,exited:false,recoverOnly:false,
    connection:{json:async()=>{events.push('quiesce');return ack();}},
    process:{stdin:{write:()=>{events.push('terminate');current.termination={stop_id:'stop',mode:'quiesced',reason:'normal'};current.exited=true;events.push('terminated');}}}};
  internal.current=current;internal.release=async()=>{events.push('release');};
  try{
    const result=await runtime.stop();
    expect(result).toMatchObject({outcome:'stopped',receipt:{result:'quiesced',engine_pid:22}});
    expect(events).toEqual(['intent','quiesce','terminate','terminated','receipt','release']);
  }finally{rmSync(root,{recursive:true,force:true});}
});

async function runtimeFixture(run:(runtime:LocalRuntime,current:any,events:any[])=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/stop-protocol-'));
  const paths=resolvePaths(root);prepareStorage(paths);const events:any[]=[];
  const runtime=new LocalRuntime(paths,root,undefined,value=>events.push(structuredClone(value)));
  const current:any={intent:{...intent},engineSession:'engine',ownership:{gateway_pid:11,incarnation:'fixture'},members:[{pid:22,created:'2'}],
    directory:root,pinsDigest:'pins',paired:true,exited:false,recoverOnly:false,launched:true,comfyOrigin:'http://127.0.0.1:1',
    connection:{json:vi.fn(async()=>ack())},process:{stdin:{write:vi.fn()}}};
  (runtime as any).current=current;(runtime as any).release=vi.fn(async()=>events.push('release'));
  try{await run(runtime,current,events);}finally{vi.unstubAllGlobals();rmSync(root,{recursive:true,force:true});}
}
it.each(['ownership','launch'])('concurrent recovery writes one receipt when the %s check overlaps',stage=>runtimeFixture(async(runtime,_current,events)=>{
  const internal=runtime as any;internal.current=undefined;
  runtime.rememberOwnership({incarnation:'fixture',owner_pid:1,supervisor_pid:2,role:'image',runtime_revision:'fixture'});
  let resume:(value:boolean)=>void=()=>{},entered:()=>void=()=>{};
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  const delayed=()=>{entered();return new Promise<boolean>(resolve=>{resume=resolve;});};
  runtime.ownershipGone=vi.fn().mockResolvedValue(true);
  internal.launchAborted=vi.fn().mockResolvedValue(false);
  (stage==='ownership'?runtime.ownershipGone:internal.launchAborted).mockImplementationOnce(delayed);
  const first=runtime.stop();await waiting;
  expect(await runtime.stop()).toHaveProperty('outcome','stopped');
  resume(stage==='ownership');
  expect(await first).toHaveProperty('outcome','stopped');
  expect(events.filter(event=>event.receipt)).toHaveLength(1);
  expect(events.filter(event=>event==='release')).toHaveLength(1);
  expect(internal.priorOwnership).toBeUndefined();
}));
it.each(['service_stop','gateway_lost','user_cancel'])('passes the running-job policy for %s',reason=>runtimeFixture(async(runtime,current)=>{
  current.intent={...intent,reason};
  current.connection.json.mockResolvedValue({...ack(),cancel_running:reason==='user_cancel'});
  current.process.stdin.write.mockImplementation(()=>{current.termination={stop_id:'stop',mode:'quiesced',reason};current.exited=true;});
  const result=await runtime.stop();
  expect(result).toHaveProperty('outcome','stopped');
  expect(current.connection.json.mock.calls[0][1].body).toEqual({stop_id:'stop',cancel_running:reason==='user_cancel'});
  expect((result as any).receipt.phase).toBeUndefined();
}));
it('reports a rejected termination immediately and allows explicit Force to supersede it',()=>runtimeFixture(async(runtime,current)=>{
  current.recoverOnly=true;
  current.process.stdin.write.mockImplementation(()=>{current.terminationRejected=true;});
  expect(await runtime.stop()).toHaveProperty('phase','termination_rejected');
  expect(await runtime.stop()).toHaveProperty('phase','termination_rejected');
  expect(current.process.stdin.write).toHaveBeenCalledOnce();
  current.process.stdin.write.mockImplementation(()=>{current.termination={stop_id:'stop',mode:'forced',reason:'explicit_emergency'};current.exited=true;});
  expect(await runtime.forceStop()).toMatchObject({outcome:'stopped',receipt:{result:'forced'}});
}));
it.each(['in_flight','pending'])('user cancellation escalates a non-cancelling drain: %s',mode=>runtimeFixture(async(runtime,current,events)=>{
  vi.useFakeTimers();current.intent={...intent,reason:'gateway_lost'};
  let respond:(value:EngineAck)=>void=()=>{};
  current.connection.json.mockImplementationOnce(()=>new Promise<EngineAck>(resolve=>{respond=resolve;}))
    .mockImplementation(async(_route:string,request:any)=>({...ack(),cancel_running:request.body.cancel_running}));
  current.process.stdin.write.mockImplementation(()=>{current.termination={stop_id:'stop',mode:'quiesced',reason:'user_cancel'};current.exited=true;});
  const initial=runtime.stop(false,{timeout:mode==='pending'?0:1000});
  expect(current.connection.json.mock.calls[0][1].body.cancel_running).toBe(false);
  if(mode==='pending'){
    respond({...ack(),state:'draining'});expect(await initial).toHaveProperty('outcome','stop_pending');
  }
  const cancelled=runtime.stop(false,{reason:'user_cancel'});
  if(mode==='in_flight')respond({...ack(),state:'draining'});
  await vi.advanceTimersByTimeAsync(300);
  expect(await cancelled).toMatchObject({outcome:'stopped',receipt:{result:'quiesced',reason:'user_cancel',cancel_running:true}});
  await initial;
  expect(current.connection.json.mock.calls.at(-1)[1].body).toEqual({stop_id:'stop',cancel_running:true});
  expect(events.some(event=>event.reason==='user_cancel'&&!event.receipt&&event.cancel_running)).toBe(true);
}));

it('retains the barrier and fault receipt across delayed termination confirmation',()=>runtimeFixture(async(runtime,current,events)=>{
  current.connection.json.mockResolvedValue({...ack(),faults:[{kind:'terminal_persistence'}]});
  expect(await runtime.stop(false,{terminationTimeout:0})).toHaveProperty('phase','termination_unconfirmed');
  expect(events).not.toContain('release');
  current.termination={stop_id:'stop',mode:'quiesced',reason:'normal'};current.exited=true;
  expect(await runtime.stop()).toMatchObject({outcome:'stopped',receipt:{result:'quiesced',engine_pid:22,faults:['terminal_persistence']}});
  expect(current.connection.json).toHaveBeenCalledOnce();expect(events.at(-1)).toBe('release');
}));
it('supervisor death retains ownership until every recorded member is proven gone',()=>runtimeFixture(async(runtime,current,events)=>{
  current.exited=true;runtime.ownershipGone=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await runtime.stop()).toHaveProperty('phase','termination_unconfirmed');expect(events).not.toContain('release');
  expect(await runtime.stop()).toMatchObject({outcome:'stopped',receipt:{result:'forced',reason:'supervisor_lost'}});
  expect(events.at(-1)).toBe('release');expect(current.process.stdin.write).not.toHaveBeenCalled();
}));
it.each(['unpaired','gateway_lost'])('uses direct owned-engine quiesce for %s',mode=>runtimeFixture(async(runtime,current)=>{
  current.engineSession=undefined;
  if(mode==='unpaired')current.paired=false;else current.error=Error('gateway lost');
  const request=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/session')?{engine_session_id:'engine',pid:22}:ack()),{headers:{'Content-Type':'application/json'}}));
  vi.stubGlobal('fetch',request);
  current.process.stdin.write.mockImplementation(()=>{current.termination={stop_id:'stop',mode:'quiesced',reason:'normal'};current.exited=true;});
  expect(await runtime.stop()).toHaveProperty('outcome','stopped');
  expect(request.mock.calls.map(call=>call[0])).toEqual(['http://127.0.0.1:1/studio/session','http://127.0.0.1:1/studio/quiesce']);
  expect(current.connection.json).not.toHaveBeenCalled();
}));
it('Force stop retries termination when the in-flight normal drain ends pending',()=>runtimeFixture(async(runtime,current)=>{
  let release:()=>void=()=>{};
  current.stop=new Promise<StopOutcome>(resolve=>{release=()=>{current.stop=undefined;resolve({outcome:'stop_pending',since:'fixture',phase:'sync_failed'});};});
  current.process.stdin.write.mockImplementation((line:string)=>{const command=JSON.parse(line);expect(command.mode).toBe('forced');
    current.termination={stop_id:'stop',mode:'forced',reason:'explicit_emergency'};current.exited=true;});
  const forced=runtime.forceStop();release();
  expect(await forced).toMatchObject({outcome:'stopped',receipt:{result:'forced'}});
}));
