import {it, expect, vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {openDatabase} from '../server/db.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import {StartupLogs} from '../server/startup-logs.js';
import {Diagnostics} from '../server/diagnostics.js';
import {LogCollectionError} from '../server/provider-logs.js';
import type {RentalRecord,ProviderDriver} from '../server/pool-contracts.js';

async function fixture(run:(f:any)=>Promise<void>) {
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/startup-')),paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data);
  let now=Date.now();const d=new Diagnostics(db,paths,()=>now),logs=new StartupLogs(db,d,()=>now);
  const w={id:'worker',provider:'vast',state:'starting',manifest:[{path:'model.bin'}],requested_loras:[],resource:{id:'resource'},issue:undefined} as unknown as RentalRecord;
  function save(change:Partial<RentalRecord>={},observe=true){const old=db.prepare('SELECT snapshot_json FROM pool_workers WHERE id=?').get(w.id) as any;Object.assign(w,change);db.prepare('INSERT INTO pool_workers VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(w.id,JSON.stringify(w));if(observe)logs.observe(w,old?JSON.parse(old.snapshot_json):null);}
  save();
  try{await run({db,w,logs,d,save,advance:(ms=60000)=>{now+=ms;},restart:()=>new StartupLogs(db,d,()=>now)});}finally{logs.close();db.close();rmSync(root,{recursive:true,force:true});}
}
const result={source:'Vast startup',text:'Downloading container layer',truncated:false};
const driver=(collect:any)=>({collectStartupLogs:collect} as ProviderDriver);
const preparation={phase:'downloading',stage:'downloading' as const,bytes_done:10,bytes_total:100,files:[{path:'model.bin',name:'Model',optional:false,ready:false,state:'downloading'}]};

it('coalesces reads, throttles and serves cache without any new provider call',()=>fixture(async({logs,w})=>{
  let resolve!:(r:any)=>void;const collect=vi.fn(()=>new Promise(r=>resolve=r)),p=logs.collect(w,driver(collect));
  await logs.collect(w,driver(collect));resolve(result);await p;await logs.collect(w,driver(collect));
  expect(logs.read(w.id).sections[0].text).toContain('container');expect(collect).toHaveBeenCalledOnce();
}));
for(const [label,change] of Object.entries({handoff:{preparation},ready:{ready:true,ready_at:'2026-09-25T00:00:00Z'},foreign:{adapters_frozen:true},quit:{quit_mode:'now'},released:{state:'released',released_at:'2026-09-25T00:00:00Z'}})) {
  it(`discards a late result after ${label}`,()=>fixture(async({logs,w,save,db})=>{
    let resolve!:(r:any)=>void;const collect=vi.fn(()=>new Promise(r=>resolve=r));const p=logs.collect(w,driver(collect));save(change);
    resolve({...result,text:'PRIVATE_SENTINEL'});await p;
    expect(JSON.stringify(db.prepare('SELECT * FROM worker_startup_logs').all())).not.toContain('PRIVATE_SENTINEL');
    expect((collect.mock.calls[0] as any)[1].aborted).toBe(true);
  }));
}
it('checks authoritative state even when a seal was not saved',()=>fixture(async({logs,w,save,db})=>{
  let resolve!:(r:any)=>void;const p=logs.collect(w,driver(()=>new Promise(r=>resolve=r)));
  save({adapters_frozen:true},false);resolve({...result,text:'PRIVATE_SENTINEL'});await p;
  expect(JSON.stringify(db.prepare('SELECT * FROM worker_startup_logs').all())).not.toContain('PRIVATE_SENTINEL');
}));
it('retains provider evidence, preparation failure and retry through readiness/restart/release',()=>fixture(async({logs,w,save,advance,restart})=>{
  await logs.collect(w,driver(async()=>result));advance();save({preparation:{...preparation,error:'Checksum mismatch',files:[{...preparation.files[0],error:'Checksum mismatch'}]}});
  logs.action(w.id,'retry_preparation');save({preparation:{...preparation,stage:'starting_engine'}});save({ready:true,ready_at:'2026-09-25T00:00:00Z'});
  const restored=restart();expect(JSON.stringify(restored.read(w.id))).toMatch(/Checksum mismatch/);expect(JSON.stringify(restored.read(w.id))).toContain('Retrying');
  expect(restored.read(w.id).collection).toBe('sealed');save({state:'released',released_at:'2026-09-25T00:01:00Z',ready:false});
  const collect=vi.fn();advance();await restored.collect(w,driver(collect));expect(collect).not.toHaveBeenCalled();expect(JSON.stringify(restored.read(w.id))).toContain('container layer');
}));
it('does not capture legacy workers or expose old mixed diagnostic events',()=>fixture(async({logs,w,db})=>{
  db.prepare('DELETE FROM worker_startup_logs').run();const collect=vi.fn();await logs.collect(w,driver(collect));
  expect(logs.read(w.id).sealed_reason).toBe('legacy');expect(collect).not.toHaveBeenCalled();
}));
it('retains text on temporary errors and suspends auth failures until credentials change',()=>fixture(async({logs,w,advance})=>{
  await logs.collect(w,driver(async()=>result));advance();const collect=vi.fn(async()=>{throw new LogCollectionError('Access denied',true);});
  await logs.collect(w,driver(collect));expect(logs.read(w.id).availability).toBe('unavailable');expect(JSON.stringify(logs.read(w.id))).toContain('container layer');
  advance();await logs.collect(w,driver(collect));expect(collect).toHaveBeenCalledOnce();logs.credentialsChanged();await logs.collect(w,driver(collect));expect(collect).toHaveBeenCalledTimes(2);
}));
it('bounds retained data, avoids duplicate snapshots, and scrubs before persistence',()=>fixture(async({logs,w,save,advance,db,d})=>{
  d.registerSecret('fixture-private-key');
  for(let i=0;i<120;i++){advance();save({preparation:{...preparation,error:`Failure ${i} fixture-private-key `+'x'.repeat(900)}});}
  const before=logs.read(w.id).revision;save({});expect(logs.read(w.id).revision).toBe(before);
  const raw=(db.prepare('SELECT snapshot_json FROM worker_startup_logs').get() as any).snapshot_json;
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64000);expect(raw).not.toContain('fixture-private-key');expect(logs.read(w.id).truncated).toBe(true);
}));
it('storage failures do not prevent closing collection or observing shutdown',()=>fixture(async({logs,w,save,db})=>{
  db.exec("CREATE TRIGGER fail_startup BEFORE UPDATE ON worker_startup_logs BEGIN SELECT RAISE(FAIL,'disk fixture'); END;");
  expect(()=>save({quit_mode:'now'})).not.toThrow();const collect=vi.fn();await logs.collect(w,driver(collect));expect(collect).not.toHaveBeenCalled();
}));
