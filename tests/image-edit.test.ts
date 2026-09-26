import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {imageRequest} from '../server/workflows.js';
import {editDimensions} from '../server/image-edit.js';
import {prepareToolRequest,requestToolSchemas} from '../server/chat/request-tools.js';
import {graphFor} from '../server/worker-graphs.js';
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {fakePool} from './fake-pool.js';
import {inputLabels,remapReferences} from '../shared/reference-labels.js';
import {WorkerPool} from '../server/pool.js';
import {Loras} from '../server/loras.js';
const request={workflow:'image-to-image',mode:'sfw',prompt:'Make the sky pink, preserving the person.',references:[{id:'source',asset_id:'photo',kind:'image',role:'source'}],output:{aspect:'source',size:'1mp'},seed:'42',count:1};
it('requires exactly one image source and rejects unsupported controls',()=>{
  expect(imageRequest(request).workflow).toBe('image-to-image');
  for(const change of [{references:[]},{references:[{...request.references[0],kind:'video'}]},{references:[{...request.references[0],role:'reference'}]},{audio:{output:'silent'}},{output:{aspect:'16:9',size:'1mp'}},{loras:[{id:'krea',revision:'v1',scale:1}]},{references:[{...request.references[0],framing:'fill'}]},{count:0},{seed:'9007199254740991',count:2}])expect(()=>imageRequest({...request,...change})).toThrow();
});
it('bounds image size without cropping and rejects extreme inputs',()=>{
  expect(editDimensions(4000,2000)).toEqual({width:1440,height:736});
  expect(editDimensions(512,512)).toEqual({width:512,height:512});
  for(const [w,h] of [[10,10],[10000,100],[20000,20000]])expect(()=>editDimensions(w!,h!)).toThrow();
});
it('Chat uses image handles, preserves the source during reordering and rejects video assets',()=>{
  const assets=[{handle:'input1',asset_id:'photo',kind:'image' as const},{handle:'input2',asset_id:'style',kind:'image' as const}];
  const previous=prepareToolRequest({workflow:'image-to-image',mode:'sfw',assets,referenceMode:'stable'},{prompt:'Change [[input1]] using [[input2]].',inputs:[{asset:'input1',role:'source'},{asset:'input2',role:'reference'}]});
  expect(previous.prompt).toBe('Change <image1> using <image2>.');
  expect(previous.output).toEqual({aspect:'source',size:'1mp'});
  const changed=prepareToolRequest({workflow:'image-to-image',mode:'sfw',assets,previous,referenceMode:'stable'},{request_id:'card',inputs:[{id:'input2'},{id:'input1'}]});
  expect(changed.references?.[0]?.role).toBe('source');
  expect(changed.prompt).toBe(previous.prompt);
  const schema=requestToolSchemas('image-to-image','sfw',true);
  expect(schema.create.properties).not.toHaveProperty('loras');
  expect(schema.create.properties).not.toHaveProperty('duration_seconds');
  expect(()=>prepareToolRequest({workflow:'image-to-image',mode:'sfw',assets:[{handle:'input1',asset_id:'video',kind:'video'}]},{prompt:'Edit',inputs:[{asset:'input1',role:'source'}]})).toThrow();
});
it('remaps source/reference mentions by identity when a new source is chosen',()=>{
  const refs=[{id:'a',asset_id:'a',kind:'image' as const,role:'source'},{id:'b',asset_id:'b',kind:'image' as const,role:'reference'}];
  expect(remapReferences('Edit <image1> using <image2>.',inputLabels(refs),inputLabels(refs.map(r=>({...r,role:r.id==='b'?'source':'reference'}))))).toBe('Edit <image2> using <image1>.');
});

async function fixture(run:(f:any)=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/qwen-')),paths=resolvePaths(root);prepareStorage(paths);
  const db=openDatabase(paths.data),fake=fakePool(db,paths),jobs=new Jobs(db,paths,fake.pool);
  const file=path.join(paths.data,'media/originals/photo');mkdirSync(path.dirname(file),{recursive:true});
  await sharp({create:{width:256,height:128,channels:4,background:{r:10,g:50,b:90,alpha:.5}}}).png().toFile(file);
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('photo','image','Source photo','media/originals/photo',JSON.stringify({state:'ready',sha256:'fixture-photo',mode:'sfw'}),new Date().toISOString());
  const settle=async()=>{for(let i=0;i<5;i++)await jobs.reconcile();};
  try{await run({...fake,jobs,db,paths,settle});}finally{await jobs.close();await fake.pool.close();await jobs.media.close();db.close();rmSync(root,{recursive:true,force:true});}
}
it('waits for an editing-capable worker, preserves alpha and saves results with lineage',async()=>fixture(async f=>{
  await f.ready();const {jobs:[job]}=await f.jobs.submit(request,'qwen-idempotent-test');await f.settle();
  expect(f.jobs.get(job.id).state).toBe('queued');expect(f.worker.submit).not.toHaveBeenCalled();
  const original=f.worker.prepare.getMockImplementation();f.worker.prepare.mockImplementation(async (w:any)=>({...await original(w),workflows:['text-to-image','image-to-image']}));
  await f.pool.tick();await f.settle();
  const complete=f.jobs.get(job.id);expect(complete.state).toBe('completed');
  expect(f.worker.submit.mock.calls[0][1].route).toBe('image-edit');
  const input=await sharp(complete.prepared[0].file).metadata();expect(input.hasAlpha).toBe(true);
  expect(f.jobs.media.get(complete.outputs[0]).metadata).toMatchObject({source_asset_id:'photo',runtime_profile:'qwen-edit-int8-v1',resolved_width:256,resolved_height:128});
  expect((await f.jobs.submit(request,'qwen-idempotent-test')).jobs[0].id).toBe(job.id);expect(f.worker.submit).toHaveBeenCalledTimes(1);
  const graph=complete.worker.graph;expect(graph['4'].inputs['images.image_1']).toEqual(['100',0]);expect(graph['7'].inputs.latent_image).toEqual(['4',2]);
}));
it('cancels queued edits without acquiring compute',async()=>fixture(async f=>{
  const {jobs:[job]}=await f.jobs.submit(request,'qwen-cancellation-test');await f.jobs.cancel(job.id);await f.settle();
  expect(f.jobs.get(job.id).state).toBe('cancelled');expect(f.providers.vast.create).not.toHaveBeenCalled();
}));
it('rejects unavailable and hidden source assets before accepting a job',async()=>fixture(async f=>{
  await expect(f.jobs.submit({...request,references:[{...request.references[0],asset_id:'gone'}]},'qwen-missing-input-test')).rejects.toThrow();
  f.db.prepare('UPDATE assets SET metadata_json=? WHERE id=?').run(JSON.stringify({state:'ready',mode:'nsfw'}),'photo');
  await expect(f.jobs.submit(request,'qwen-hidden-input-test')).rejects.toThrow('unavailable');expect(f.jobs.all()).toHaveLength(0);
}));

async function editingWorker(f:any){
 const original=f.worker.prepare.getMockImplementation();f.worker.prepare.mockImplementation(async(w:any)=>({...await original(w),workflows:['text-to-image','image-to-image']}));
 return (await f.ready())[0];
}
it('routes Krea, quantity-four edits, and Krea again without leaking graph or seed state',async()=>fixture(async f=>{
 await editingWorker(f);
 const krea={workflow:'text-to-image',mode:'sfw',prompt:'A mountain lake.',output:{aspect:'16:9',size:'1mp'},seed:'100',count:1};
 await f.jobs.submit(krea,'krea-before-edit-test');await f.settle();
 const batch=await f.jobs.submit({...request,count:4},'four-qwen-edits-test');await f.settle();
 await f.jobs.submit(krea,'krea-after-edit-test');await f.settle();
 expect(f.jobs.all().every((j:any)=>j.state==='completed')).toBe(true);
 expect(batch.jobs.map((j:any)=>j.seed)).toEqual(['42','43','44','45']);
 expect(f.worker.submit.mock.calls.map((c:any)=>c[1].route)).toEqual(['image','image-edit','image-edit','image-edit','image-edit','image']);
 expect(f.pool.all()[0].state).toBe('ready');expect(f.providers.vast.destroy).not.toHaveBeenCalled();
}));
it('keeps a preparing Image worker for its accepted edits when finishing',async()=>fixture(async f=>{
 const worker=await editingWorker(f);
 f.db.prepare('UPDATE pool_workers SET snapshot_json=? WHERE id=?').run(JSON.stringify({...f.pool.get(worker.id),ready:false,ready_at:undefined,workflows:undefined,state:'preparing'}),worker.id);
 const accepted=await f.jobs.submit(request,'edit-before-finish');
 f.advance(1000);await f.pool.action(worker.id,'finish');await f.pool.tick();
 expect(f.pool.get(worker.id).state).not.toBe('released');expect(f.providers.vast.destroy).not.toHaveBeenCalled();
 await f.settle();expect(f.jobs.get(accepted.jobs[0].id).state).toBe('completed');
 await f.pool.tick();expect(f.pool.get(worker.id).state).toBe('released');
}));
it('reconciles an accepted edit receipt after server restart without resubmission',async()=>fixture(async f=>{
 await editingWorker(f);const receipt=f.worker.receipt.getMockImplementation();f.worker.receipt.mockImplementation(async()=>({submission:{graph_digest:'fixture'}}));
 const accepted=await f.jobs.submit(request,'restart-qwen-edit');await f.settle();expect(f.jobs.get(accepted.jobs[0].id).state).toBe('running');
 await f.jobs.close();await f.pool.close();f.worker.receipt.mockImplementation(receipt);
 const pool=new WorkerPool(f.db,f.paths,new Loras(f.paths),f.deps),jobs=new Jobs(f.db,f.paths,pool);
 try{await pool.tick();for(let i=0;i<5;i++)await jobs.reconcile();expect(jobs.get(accepted.jobs[0].id)?.state).toBe('completed');expect(f.worker.submit).toHaveBeenCalledTimes(1);}finally{await jobs.close();await jobs.media.close();await pool.close();}
}));
it('prepares EXIF-rotated inputs with a separate image editing cache recipe',async()=>fixture(async f=>{
 const file=path.join(f.paths.data,'media/originals/photo');await sharp({create:{width:256,height:128,channels:3,background:'#123456'}}).jpeg().withMetadata({orientation:6}).toFile(file+'.jpg');
 f.db.prepare('UPDATE assets SET relative_path=? WHERE id=?').run('media/originals/photo.jpg','photo');
 await editingWorker(f);const accepted=await f.jobs.submit(request,'rotate-qwen-edit');await f.settle();const job=f.jobs.get(accepted.jobs[0].id);
 expect(job.state).toBe('completed');expect(await sharp(job.prepared[0].file).metadata()).toMatchObject({width:128,height:256});
}));
