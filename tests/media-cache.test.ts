import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,rmdirSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {openDatabase} from '../server/db.js';
import {Media,type PreparedReference} from '../server/media.js';
import {removeAssetCaches,sweepMediaCaches} from '../server/media-cache.js';
import {Previews} from '../server/previews.js';
import {Sequences} from '../server/sequences.js';
import {Jobs,type Job} from '../server/jobs.js';
import {createApp} from '../server/http.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import {fakePool} from './fake-pool.js';

const faults=vi.hoisted(()=>({locked:new Set<string>(),renameTarget:'',wait:undefined as Promise<void>|undefined,entered:()=>{}}));
vi.mock('node:fs',async original=>{
  const actual=await original<typeof import('node:fs')>();
  return {...actual,unlinkSync:(file:Parameters<typeof actual.unlinkSync>[0])=>{
    if(faults.locked.has(String(file)))throw Object.assign(Error('Fixture file is locked'),{code:'EBUSY'});
    return actual.unlinkSync(file);
  }};
});
vi.mock('node:fs/promises',async original=>{
  const actual=await original<typeof import('node:fs/promises')>();
  return {...actual,rename:async(...args:Parameters<typeof actual.rename>)=>{
    if(String(args[1])===faults.renameTarget){faults.entered();await faults.wait;}
    return actual.rename(...args);
  }};
});
afterEach(()=>{faults.locked.clear();faults.renameTarget='';faults.wait=undefined;faults.entered=()=>{};});

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
function fixture(){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/cache-')),paths=resolvePaths(root);prepareStorage(paths);
  const db=openDatabase(paths.data),media=new Media(db,paths),records:Job[]=[],inFlight=new Set<string>();
  const jobs={all:()=>records,isInFlight:(id:string)=>inFlight.has(id),save:()=>{}};
  async function image(id:string){
    const file=path.join(paths.data,'media/originals',id),bytes=await sharp({create:{width:256,height:128,channels:3,background:'#abc123'}}).png().toBuffer();
    writeFileSync(file,bytes);db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(id,'image','Fixture image','media/originals/'+id,JSON.stringify({state:'ready',width:256,height:128,sha256:createHash('sha256').update(bytes).digest('hex')}),new Date().toISOString());
    return file;
  }
  const ref=(asset_id:string)=>({id:asset_id,asset_id,kind:'image' as const,role:'source' as const});
  function job(id:string,prepared:PreparedReference[],state:Job['state']='completed'){
    const record={id,state,request:{workflow:'image-to-image',mode:'sfw',prompt:'Fixture edit',count:1,seed:'42',references:prepared.map(ref=>({id:ref.id,asset_id:ref.asset_id,kind:ref.kind,role:ref.role})),output:{aspect:'source',size:'1mp'}},prepared,outputs:[],created_at:'2026-09-25T00:00:00Z',updated_at:'2026-09-25T00:00:00Z',seed:'42',submission_id:id,submission_index:0,error:null} as Job;
    records.push(record);return record;
  }
  function persist(record:Job){db.prepare('INSERT INTO submissions VALUES (?,?,?)').run(record.submission_id,record.id+'-idempotency','{}');db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)').run(record.id,record.request.workflow,record.state,JSON.stringify(record),record.created_at,record.updated_at,record.submission_id,0);}
  const close=async()=>{await media.close();db.close();rmSync(root,{recursive:true,force:true});};
  return {root,paths,db,media,records,inFlight,jobs,image,ref,job,persist,close};
}

it('deletes ordinary Library originals, both thumbnail sizes and their prepared copy through the API',async()=>{
  const f=fixture();const app=await createApp({paths:f.paths,port:4371});const headers={host:'127.0.0.1:4371',origin:'http://127.0.0.1:4371'};
  try{
    const original=await f.image('photo');const prepared=await f.media.prepare(f.ref('photo'),'source',5);f.persist(f.job('completed-edit',[prepared]));
    for(const size of [384,1280])expect((await app.inject({url:`/api/v1/assets/photo/preview?size=${size}`,headers})).statusCode).toBe(200);
    expect((await app.inject({method:'DELETE',url:'/api/v1/assets/photo',headers})).statusCode).toBe(204);
    for(const file of [original,prepared.file,...[384,1280].map(size=>path.join(f.paths.cache,'previews',`photo-${size}.webp`))])expect(existsSync(file)).toBe(false);
    expect(f.media.get('photo')).toBeNull();expect((await app.inject({method:'DELETE',url:'/api/v1/assets/photo',headers})).statusCode).toBe(204);
  }finally{await app.close();await f.close();}
});

it('retains a shared Qwen copy until its last live source is deleted',async()=>{
  const f=fixture();try{
    await f.image('one');await f.image('two');const first=await f.media.prepare(f.ref('one'),'source',5),second=await f.media.prepare(f.ref('two'),'source',5);
    expect(first.file).toBe(second.file);f.job('first',[first]);f.job('second',[second]);
    removeAssetCaches(f.db,f.paths,f.jobs,['one']);expect(existsSync(first.file)).toBe(true);
    f.db.prepare('DELETE FROM assets WHERE id=?').run('one');
    removeAssetCaches(f.db,f.paths,f.jobs,['two']);expect(existsSync(first.file)).toBe(false);
    expect(existsSync(path.join(f.paths.data,'media/originals','two'))).toBe(true);
  }finally{await f.close();}
});

it('fences a second thumbnail size while a real preview write drains, then leaves no recreated derivative',async()=>{
  const f=fixture(),held=deferred(),entered=deferred();try{
    const original=await f.image('photo'),previews=new Previews(f.paths.data,f.paths.cache);
    faults.renameTarget=path.join(f.paths.cache,'previews','photo-384.webp');faults.wait=held.promise;faults.entered=entered.release;
    const writing=previews.get('photo','media/originals/photo',384);await entered.promise;
    let removed=false;const deleting=previews.withDeletion(['photo'],[],()=>{
      removeAssetCaches(f.db,f.paths,f.jobs,['photo']);unlinkSync(original);f.db.prepare('DELETE FROM assets WHERE id=?').run('photo');removed=true;
    });
    await expect(previews.get('photo','media/originals/photo',1280)).rejects.toThrow('being deleted');expect(removed).toBe(false);
    held.release();await Promise.all([writing,deleting]);expect(removed).toBe(true);
    expect(existsSync(faults.renameTarget)).toBe(false);expect(existsSync(faults.renameTarget+'.part')).toBe(false);
  }finally{held.release();await f.close();}
});

it('fences sequence pages too and lets failed deletion be retried',async()=>{
  const f=fixture();try{
    await f.image('photo');const previews=new Previews(f.paths.data,f.paths.cache),held=deferred();
    const deleting=previews.withDeletion(['photo'],['seq'],async()=>{await held.promise;throw Error('Fixture deletion failed');});
    await expect(previews.sheet('seq',0,1,[{relative_path:'media/originals/photo'}],256,128)).rejects.toThrow('being deleted');
    held.release();await expect(deleting).rejects.toThrow('Fixture deletion failed');
    expect(existsSync(await previews.get('photo','media/originals/photo',1280))).toBe(true);
  }finally{await f.close();}
});

it('keeps the original and record when a derivative unlink fails, then retries successfully',async()=>{
  const f=fixture();const app=await createApp({paths:f.paths,port:4372});const headers={host:'127.0.0.1:4372',origin:'http://127.0.0.1:4372'};
  try{
    const original=await f.image('photo'),prepared=await f.media.prepare(f.ref('photo'),'source',5);f.persist(f.job('completed-edit',[prepared]));faults.locked.add(prepared.file);
    const failed=await app.inject({method:'DELETE',url:'/api/v1/assets/photo',headers});expect(failed.statusCode).toBe(409);expect(failed.json().error.message).toContain('cached copy');
    expect(existsSync(original)).toBe(true);expect(f.media.get('photo')).not.toBeNull();
    faults.locked.clear();expect((await app.inject({method:'DELETE',url:'/api/v1/assets/photo',headers})).statusCode).toBe(204);expect(existsSync(prepared.file)).toBe(false);
  }finally{faults.locked.clear();await app.close();await f.close();}
});

it.each(['queued','running','blocked','needs_attention','cancel_requested'] as const)('protects %s job inputs from deletion',async state=>{
  const f=fixture();try{await f.image('photo');const prepared=await f.media.prepare(f.ref('photo'),'source',5);f.job('using-file',[prepared],state);
    expect(()=>removeAssetCaches(f.db,f.paths,f.jobs,['photo'])).toThrow('still needs');expect(existsSync(prepared.file)).toBe(true);
  }finally{await f.close();}
});

it('protects a cancelled job until its real upload task unwinds',async()=>{
  const f=fixture(),fake=fakePool(f.db,f.paths),jobs=new Jobs(f.db,f.paths,fake.pool),held=deferred(),entered=deferred();
  try{
    const previous=fake.worker.prepare.getMockImplementation()!;fake.worker.prepare.mockImplementation(async w=>({...await previous(w),workflows:['image-to-image']}));
    const [worker]=await fake.ready();await f.image('photo');
    const submitted=await jobs.submit({workflow:'image-to-image',mode:'sfw',prompt:'Fixture edit',seed:'42',count:1,references:[f.ref('photo')],output:{aspect:'source',size:'1mp'}},'cache-inflight-fixture');
    fake.worker.upload.mockImplementation(async()=>{entered.release();await held.promise;});await jobs.reconcile(true);await entered.promise;
    await fake.pool.action(worker!.id,'quit');const id=submitted.jobs[0]!.id;
    expect(jobs.get(id)?.state).toBe('cancelled');expect(jobs.isInFlight(id)).toBe(true);expect(jobs.usesAsset('photo')).toBe(true);
    expect(()=>removeAssetCaches(f.db,f.paths,jobs,['photo'])).toThrow('still needs');
    held.release();await jobs.reconcile();expect(jobs.usesAsset('photo')).toBe(false);removeAssetCaches(f.db,f.paths,jobs,['photo']);
    expect(existsSync(submitted.jobs[0]!.prepared![0]!.file)).toBe(false);
  }finally{held.release();await jobs.close();await jobs.media.close();await fake.pool.close();await f.close();}
});

it('sweeps abandoned preparations and deleted previews, retaining live cache files and logging failures for retry',async()=>{
  const f=fixture();try{
    await f.image('live');const ref=await f.media.prepare(f.ref('live'),'source',5);f.job('live-job',[ref]);
    const abandoned=path.join(f.paths.data,'media/prepared','a'.repeat(64)+'.png');writeFileSync(abandoned,'abandoned preparation');writeFileSync(abandoned+'.tmp','partial');
    const previews=path.join(f.paths.cache,'previews');mkdirSync(previews,{recursive:true});writeFileSync(path.join(previews,'deleted-384.webp'),'cache');writeFileSync(path.join(previews,'live-384.webp.part'),'active preview');
    const unknown=path.join(previews,'notes.txt');writeFileSync(unknown,'preserve unknown file');faults.locked.add(abandoned);
    const report=vi.fn();expect(sweepMediaCaches(f.db,f.paths,f.jobs,report)).toEqual({removed:2,failed:1});expect(report).toHaveBeenCalledWith({area:'prepared',code:'EBUSY'});
    expect(existsSync(ref.file)).toBe(true);expect(existsSync(path.join(previews,'live-384.webp.part'))).toBe(true);expect(existsSync(unknown)).toBe(true);
    faults.locked.clear();expect(sweepMediaCaches(f.db,f.paths,f.jobs,report)).toEqual({removed:1,failed:0});
  }finally{await f.close();}
});

it('never follows forged job paths or cache-directory links outside the intended root',async()=>{
  const f=fixture();try{
    await f.image('photo');const outside=path.join(f.root,'outside');mkdirSync(outside);const file=path.join(outside,'b'.repeat(64)+'.png');writeFileSync(file,'keep');
    f.job('forged',[{...f.ref('photo'),file,filename:path.basename(file),sha256:'fixture'}]);removeAssetCaches(f.db,f.paths,f.jobs,['photo']);expect(readFileSync(file,'utf8')).toBe('keep');
    const prepared=path.join(f.paths.data,'media/prepared');rmdirSync(prepared);symlinkSync(outside,prepared,'junction');
    const report=vi.fn();expect(sweepMediaCaches(f.db,f.paths,f.jobs,report).failed).toBe(1);expect(report).toHaveBeenCalledWith({area:'prepared',code:'UNSAFE_CACHE_PATH'});expect(readFileSync(file,'utf8')).toBe('keep');
  }finally{await f.close();}
});

it('preserves sequence originals on cache failure and recovers pending deletion with the same cleanup helper',async()=>{
  const f=fixture();try{
    const original=await f.image('frame'),prepared=await f.media.prepare(f.ref('frame'),'source',5);f.job('edit-frame',[prepared]);
    f.db.prepare('INSERT INTO sequences(id,mode,created_at) VALUES (?,?,?)').run('seq','sfw',new Date().toISOString());f.db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('seq','frame',0);
    const previews=new Previews(f.paths.data,f.paths.cache),page=await previews.sheet('seq',0,0,[{relative_path:'media/originals/frame'}],256,128);
    const sequences=new Sequences(f.db,f.paths.data,f.paths.cache,f.jobs as unknown as Jobs);faults.locked.add(prepared.file);
    expect(()=>sequences.prune('seq',[],0,true)).toThrow('cached copy');expect(existsSync(original)).toBe(true);expect(sequences.get('seq')?.cleanup_pending).toBe(true);expect(sequences.assetIds('seq')).toEqual(['frame']);
    const report=vi.fn();sequences.recover(report);expect(report).toHaveBeenCalledWith({code:'EBUSY'});expect(existsSync(original)).toBe(true);
    faults.locked.clear();sequences.recover(report);expect(sequences.get('seq')).toBeNull();for(const file of [original,prepared.file,page])expect(existsSync(file)).toBe(false);
  }finally{await f.close();}
});
