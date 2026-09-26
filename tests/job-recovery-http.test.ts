import {it, expect} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/http.js';
import {Jobs} from '../server/jobs.js';
import {openDatabase} from '../server/db.js';
import {resolvePaths, prepareStorage} from '../server/storage.js';
import {fakePool} from './fake-pool.js';
import {jobNeedsAttention} from '../shared/jobs.js';

it('serves recovery immediately, projects its state, and accepts no replacement settings', async () => {
  mkdirSync('.local/tests', {recursive:true});
  const root=mkdtempSync(path.resolve('.local/tests/recovery-http-')), paths=resolvePaths(root);
  prepareStorage(paths);
  const db=openDatabase(paths.data), fake=fakePool(db,paths), jobs=new Jobs(db,paths,fake.pool);
  let app:Awaited<ReturnType<typeof createApp>>|undefined;
  let release:()=>void=()=>{};
  try {
    await fake.ready();
    fake.worker.submit.mockRejectedValueOnce(Error('Submission transport unavailable.'));
    const {jobs:[original]}=await jobs.submit({workflow:'text-to-image',prompt:'Public test fixture',mode:'sfw',output:{aspect:'16:9',size:'1mp'},seed:'42',count:1},'http-recovery-fixture');
    await jobs.reconcile();await jobs.reconcile();
    jobs.acknowledge(original!.id);await jobs.close();
    app=await createApp({paths,port:4311,webRoot:path.resolve('dist/web'),poolDependencies:fake.deps});
    const host='127.0.0.1:4311',headers={host,origin:'http://'+host},url='/api/v1/jobs/'+original!.id+'/recover';
    expect((await app.inject({method:'POST',url,payload:{},headers:{host}})).statusCode).toBe(403);
    for(const payload of [{seed:'43'},{worker_id:'another'},{request:{prompt:'replacement'}}])
      expect((await app.inject({method:'POST',url,payload,headers})).statusCode).toBe(400);
    const probe=fake.worker.probe.getMockImplementation()!;
    const held=new Promise<void>(resolve=>release=resolve);
    fake.worker.probe.mockImplementationOnce(async worker=>{await held;return probe(worker);});
    const response=await app.inject({method:'POST',url,payload:{},headers});
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({id:original!.id,recovery:{pending:true,worker_id:jobs.get(original!.id)!.worker!.id}});
    const second=await app.inject({method:'POST',url,payload:{},headers});
    expect(second.json().recovery.pending).toBe(true);
    const listed=(await app.inject({url:'/api/v1/jobs?mode=sfw',headers})).json().items[0];
    const single=(await app.inject({url:'/api/v1/jobs/'+original!.id,headers})).json();
    expect(listed.recovery.pending).toBe(true);expect(single.recovery.pending).toBe(true);
    expect(jobNeedsAttention(single)).toBe(true);
    expect((await app.inject({url:'/api/v1/studio',headers})).json().activity.needs_attention).toBe(1);
    expect((await app.inject({url:'/api/v1/pool',headers})).json().workers[0]).toMatchObject({state:'needs_attention',current_activity:'Checking request…'});
    expect(fake.worker.submit).toHaveBeenCalledTimes(1);
    release();
    let completed=single;
    for(let i=0;i<200&&completed.state!=='completed';i++) {
      await new Promise(resolve=>setTimeout(resolve,10));
      completed=(await app.inject({url:'/api/v1/jobs/'+original!.id,headers})).json();
    }
    expect(completed.state).toBe('completed');expect(completed.recovery).toBeUndefined();
    expect(fake.worker.submit).toHaveBeenCalledTimes(2);
    expect(fake.worker.submit.mock.calls[1]![1]).toEqual(fake.worker.submit.mock.calls[0]![1]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({n:1});
  } finally {
    release();await app?.close();await jobs.close();await jobs.media.close();await fake.pool.close();db.close();
    rmSync(root,{recursive:true,force:true});
  }
});
