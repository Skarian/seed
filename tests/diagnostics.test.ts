import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Diagnostics,sanitize,boundedText} from '../server/diagnostics.js';
it('redacts nested JSON strings in the observed Vast SSH response shape',()=>{
  const response={key:JSON.stringify({id:1420984,public_key:'public-key-fixture',private_key:'private-key-fixture'})};
  expect(JSON.parse(sanitize(response).key)).toEqual({id:1420984,public_key:'[REDACTED]',private_key:'[REDACTED]'});
});
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {createProviders} from '../server/pool-providers.js';
import {fakePool} from './fake-pool.js';
import {WorkerPool} from '../server/pool.js';
import {Loras} from '../server/loras.js';
import {PoolError} from '../server/pool-errors.js';

async function fixture(fn:(f:any)=>Promise<void>) {
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/diagnostics-'));
  const paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data);
  try{await fn({root,paths,db});}finally{if(db.open)db.close();rmSync(root,{recursive:true,force:true});}
}
it('removes secrets recursively, from nested exceptions and URLs before persistence',()=>fixture(async({paths,db})=>{
  const key='example-private-key-123';writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({runpodApiKey:key}));
  const d=new Diagnostics(db,paths);d.registerSecret('pairing-very-private');
  d.event({category:'provider',operation:'create',worker_id:'worker',level:'error',data:{env:{CUSTOM:'anything'},extra_env:{CUSTOM:'unknown-private-environment'},log:"SECRET='unknown-quoted-secret'",prompt:'private art idea',
    response:{message:`failed with ${key} and pairing-very-private`,url:'https://files.example/model?X-Amz-Signature=do-not-log',nested:[{authorization:'other-secret'}]},
    error:new Error('failure '+key,{cause:new Error('token=unrecognized-value')})}});
  const stored=JSON.stringify(db.prepare('SELECT * FROM diagnostic_events').all())+JSON.stringify(db.prepare('SELECT * FROM acquisition_failures').all());
  for(const secret of [key,'pairing-very-private','do-not-log','private art idea','other-secret','unrecognized-value','anything','unknown-private-environment','unknown-quoted-secret'])expect(stored).not.toContain(secret);
  expect(stored).toContain('failed with');expect(stored).toContain('REDACTED');
}));
it('captures real adapter error bodies and request correlation while keeping public errors controlled',()=>fixture(async({paths,db})=>{
  writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({vastApiKey:'secret-test-credential'}));
  const d=new Diagnostics(db,paths),p=createProviders(paths,async()=>new Response(JSON.stringify({error:'insufficient_funds',msg:'Insufficient account balance',token:'secret-test-credential'}),{status:400,headers:{'x-request-id':'provider-trace-123'}}),d);
  await expect(d.within({worker_id:'worker-a',request_id:'request-a'},()=>p.vast.offers('image',{image:'image',disk_gb:160}))).rejects.toMatchObject({issue:{code:'insufficient_funds'}});
  const details=d.details('worker-a');expect(details.failures.some((f:any)=>f.data.response?.msg==='Insufficient account balance')).toBe(true);
  expect(details.events.some((e:any)=>e.request_id==='request-a'&&e.data.provider_request_id==='provider-trace-123')).toBe(true);
  expect(JSON.stringify(details)).not.toContain('secret-test-credential');
}));
it('retains acquisition outcomes and failure counts after restart and detailed-log expiry',()=>fixture(async({paths,db})=>{
  const f=fakePool(db,paths),d=new Diagnostics(db,paths,f.deps.now),pool=new WorkerPool(db,paths,new Loras(paths),f.deps,d);
  await pool.offers('image');await pool.launch({selections:[{offer_id:'vast-image',quantity:1}],max_hourly:1},'diagnostics-launch-key');
  await pool.tick();const w=pool.all()[0]!;
  d.annotate(w.id,{campaign:'regression',manual_intervention:true,note:'Recorded manual repair'});
  expect(()=>d.annotate(w.id,{manual_intervention:false})).toThrow('cannot be erased');
  for(let i=0;i<3;i++)d.event({category:'provider',operation:'GET instance',worker_id:w.id,level:'error',data:{status:503,response:{message:'Temporarily unavailable'}}});
  await pool.action(w.id,'quit');await pool.close();
  const before=d.history();expect(before.summary.ready).toBe(1);expect(before.summary.manually_assisted).toBe(1);expect(before.summary.ready_without_recovery).toBe(0);
  const reopened=new Diagnostics(db,paths,()=>Date.now()+91*86400000);reopened.event({category:'server',operation:'restart'});
  expect(reopened.details(w.id).events).toHaveLength(0);expect(reopened.details(w.id).failures.find((x:any)=>x.operation==='GET instance').occurrences).toBe(3);
  expect(reopened.history().items[0].released_at).toBeTruthy();expect(reopened.details(w.id).milestones.length).toBeGreaterThan(1);
  db.close();const db2=openDatabase(paths.data);try{expect(new Diagnostics(db2,paths).history().items[0].campaign).toBe('regression');}finally{db2.close();}
}));
it('labels old rentals as partial history and never invents an unassisted success',()=>fixture(async({paths,db})=>{
  const f=fakePool(db,paths);await f.ready();await f.pool.close();
  const d=new Diagnostics(db,paths),pool=new WorkerPool(db,paths,new Loras(paths),f.deps,d);
  expect(d.history().summary).toMatchObject({ready:1,legacy:1,ready_without_recovery:0});await pool.close();
}));
it('bounds response streams before decoding and rejects oversized error bodies',async()=>{
  await expect(boundedText(new Response('x'.repeat(1025)),1024)).rejects.toThrow('limit');
  expect(sanitize({error:{password:'hidden',message:'useful'}})).toEqual({error:{password:'[REDACTED]',message:'useful'}});
});
it('surfaces broken diagnostic storage without blocking provider cleanup',()=>fixture(async({paths,db})=>{
  const stderr=vi.spyOn(process.stderr,'write').mockReturnValue(true);
  const f=fakePool(db,paths),d=new Diagnostics(db,paths,f.deps.now),pool=new WorkerPool(db,paths,new Loras(paths),f.deps,d);
  try {
    await pool.offers('image');await pool.launch({selections:[{offer_id:'vast-image',quantity:1}],max_hourly:1},'diagnostics-failed-disk');
    await pool.tick();const w=pool.all()[0]!;
    for(const table of ['diagnostic_events','acquisition_events','acquisition_history'])
      db.exec(`CREATE TRIGGER fail_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(FAIL, 'test diagnostic storage unavailable'); END`);
    await pool.action(w.id,'quit');await pool.tick();
    expect(pool.all()[0]!.state).toBe('released');
    expect(d.history().diagnostics_write_failed).toBe(true);
    expect(readFileSync(path.join(paths.log,'diagnostics-errors.jsonl'),'utf8')).toContain('diagnostics_write_failed');
    expect(stderr).toHaveBeenCalledTimes(1);
  } finally {await pool.close();stderr.mockRestore();}
}));
it('waits for the provider release retry window and then verifies deletion automatically',()=>fixture(async({paths,db})=>{
  const f=fakePool(db,paths);await f.ready();const w=f.pool.all()[0]!;
  f.providers.vast.destroy.mockRejectedValueOnce(new PoolError({code:'rate_limited',message:'Rate limited',retryable:true},true,3000));
  await f.pool.action(w.id,'quit');await f.pool.tick();
  expect(f.pool.all()[0]!.state).toBe('releasing');
  f.advance(2000);await f.pool.tick();expect(f.providers.vast.destroy).toHaveBeenCalledTimes(1);
  f.advance(1000);await f.pool.tick();await new Promise(resolve=>setImmediate(resolve));
  expect(f.providers.vast.destroy).toHaveBeenCalledTimes(2);expect(f.pool.all()[0]!.state).toBe('released');
  await f.pool.close();
}));
