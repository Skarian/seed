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
import {capabilityFor,executionProfile,executionRoute,supportsWorkflow,KLEIN_PROFILE} from '../shared/workflows.js';
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
  expect(previous.output).toEqual({aspect:'source',size:'image-768'});
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

it('FLUX 3 Image Klein makes a new shot at the draft shape from reference images, following the official template',()=>{
  const klein=imageRequest({...request,engine:'klein',output:{aspect:'16:9',size:'image-768'},references:[...request.references,{id:'mara',asset_id:'sheet',kind:'image',role:'reference'}]});
  expect(klein).toMatchObject({engine:'klein',output:{aspect:'16:9',size:'image-768'}});
  expect(()=>imageRequest({...request,output:{aspect:'16:9',size:'image-768'}})).toThrow();
  expect(()=>imageRequest({...request,engine:'other'})).toThrow();
  expect([executionProfile(klein),executionRoute(klein),capabilityFor(klein)]).toEqual([KLEIN_PROFILE,'image-klein','image-to-image:klein']);
  expect(capabilityFor(request as any)).toBe('image-to-image');
  expect(supportsWorkflow({worker_class:'image',workflows:['text-to-image','image-to-image']},'image-to-image:klein')).toBe(false);
  expect(supportsWorkflow({worker_class:'image',workflows:['image-to-image:klein']},'image-to-image:klein')).toBe(true);
  const refs=[{id:'source',role:'source',filename:'a.png',width:1024,height:1024},{id:'mara',role:'reference',filename:'b.png',width:1024,height:1536}] as any;
  const g:any=graphFor(klein,'job','42',[],refs);
  expect(g['2'].inputs).toMatchObject({clip_name:'qwen3vl_4b_int8_convrot.safetensors',type:'flux3'});
  expect(g['6']).toEqual({class_type:'EmptyFlux2LatentImage',inputs:{width:1344,height:768,batch_size:1}});
  expect(g['7'].inputs).toMatchObject({latent_image:['6',0],positive:['10',0],negative:['10',1],steps:16,cfg:1,sampler_name:'euler',scheduler:'simple'});
  expect(g['10'].inputs).toMatchObject({negative:['5',0],resolution:'resize','resolution.megapixels':1,'images.image0':['100',0],'images.image1':['101',0]});
  expect(g['5'].class_type).toBe('ConditioningZeroOut');
  expect(graphFor({...klein,prompt:'The girl from <image1> at the door of <image2>.'},'job','42',[],refs)['4']!.inputs.text).toBe('The girl from image 1 at the door of image 2.');
  // Kept at the source shape, the canvas follows the source image.
  const same:any=graphFor(imageRequest({...request,engine:'klein'}),'job','42',[],[{...refs[0],width:2000,height:1000}]);
  expect([same['6'].inputs.width,same['6'].inputs.height]).toEqual([1440,736]);
  // Every image size and shape gives a canvas on the 16-pixel grid the Klein latent needs (1920 x 1080 becomes 1088).
  for(const size of ['image-480','image-768','1mp','2mp','image-1440'] as const)for(const aspect of ['16:9','9:16','1:1','4:5'] as const){
    const c:any=graphFor(imageRequest({...request,engine:'klein',output:{aspect,size}} as any),'job','42',[],refs);
    expect([c['6'].inputs.width%16,c['6'].inputs.height%16]).toEqual([0,0]);
  }
});
it('new edit drafts use Klein, saved Qwen drafts keep Qwen, and the tool can switch',()=>{
  const ctx={workflow:'image-to-image' as const,mode:'sfw' as const,assets:[{handle:'input1',asset_id:'photo',kind:'image' as const}]};
  const fresh=prepareToolRequest(ctx,{prompt:'Mara at the door [[input1]]',inputs:[{asset:'input1',role:'source'}],aspect_ratio:'16:9'});
  expect(fresh).toMatchObject({engine:'klein',output:{aspect:'16:9'}});
  const old={...fresh,engine:undefined,output:{aspect:'source',size:'1mp'}} as any;delete old.engine;
  expect(prepareToolRequest({...ctx,previous:old},{request_id:'card',prompt:'Brighter [[input1]]'}).engine).toBeUndefined();
  expect(prepareToolRequest({...ctx,previous:old},{request_id:'card',engine:'klein'}).engine).toBe('klein');
  expect(requestToolSchemas('image-to-image','sfw').create.properties.engine).toBeDefined();
});
it('runs a Klein shot at its own shape: inputs are prepared as images, only the canvas is 16:9',async()=>fixture(async f=>{
  await f.ready();
  const original=f.worker.prepare.getMockImplementation();f.worker.prepare.mockImplementation(async (w:any)=>({...await original(w),workflows:['text-to-image','image-to-image','image-to-image:klein']}));
  const klein={...request,engine:'klein',output:{aspect:'16:9',size:'image-768'}};
  const {jobs:[job]}=await f.jobs.submit(klein,'klein-shot-at-own-shape');await f.pool.tick();await f.settle();
  const done=f.jobs.get(job.id);expect(done.state).toBe('completed');
  expect(f.worker.submit.mock.calls[0][1].route).toBe('image-klein');
  expect([done.prepared[0].width,done.prepared[0].height]).toEqual([256,128]); // the source keeps its own shape
  expect(done.worker.graph['6'].inputs).toMatchObject({width:1344,height:768});
  expect(f.jobs.media.get(done.outputs[0]).metadata).toMatchObject({runtime_profile:'flux3-klein-int8-v1',resolved_width:1344,resolved_height:768});
}));
