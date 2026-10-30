import {afterEach,describe,expect,it,vi} from 'vitest';
import {copyFileSync,mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';
import {imageRequest} from '../server/workflows.js';
import {graphFor} from '../server/worker-graphs.js';
import {hardwareProfile} from '../server/hardware.js';
import {editDimensions} from '../server/image-edit.js';
import {Media,probe,transcode,type PreparedReference} from '../server/media.js';
import {Jobs} from '../server/jobs.js';
import {openDatabase} from '../server/db.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import {fakePool} from './fake-pool.js';
import type {InputReference} from '../shared/generation.js';
import type {ImageSize,VideoSize} from '../shared/resolution.js';

afterEach(()=>vi.unstubAllEnvs());
const source:InputReference={id:'source',asset_id:'photo',kind:'image',role:'source'};
const auxiliary:InputReference={id:'aux',asset_id:'photo',kind:'image',role:'reference'};
const imageSizes:Array<[ImageSize,number,number]>=[['0.5mp',896,504],['1mp',1280,720],['2mp',1920,1080],['image-480',864,480],['image-768',1344,768],['image-1440',2560,1440]];
const videoSizes:Array<[VideoSize,number,number]>=[['480p',864,480],['768p',1344,768]];
const requestFor=(workflow:string,size:unknown,aspect='16:9',references:InputReference[]=[])=>({
  workflow,prompt:'A quiet forest',mode:'sfw',seed:'42',count:1,references,
  output:{size,aspect,...(workflow.includes('video')?{duration_seconds:5}:{})},
});

describe('request and graph resolution contracts',()=>{
  it.each(['','0','true','1'])('accepts approved and saved resolutions independently of the qualification flag %j',flag=>{
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS',flag);
    for(const workflow of ['text-to-image','image-to-image','text-to-video','reference-to-video']){
      const editing=workflow==='image-to-image',video=workflow.includes('video');
      const sizes=video?videoSizes.map(p=>p[0]):imageSizes.map(p=>p[0]);
      for(const size of [...sizes,undefined,'unknown',video?'1mp':'768p']){
        const raw=requestFor(workflow,size,editing?'source':'16:9',editing?[source]:workflow==='reference-to-video'?[auxiliary]:[]);
        if(workflow==='text-to-image')delete (raw as any).references;
        const accepted=(sizes as unknown[]).includes(size);
        if(accepted)expect(imageRequest(raw).output.size).toBe(size);
        else expect(()=>imageRequest(raw)).toThrow();
      }
    }
  });

  it.each(imageSizes)('uses literal Krea canvas %s in both orientations', (size,width,height)=>{
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');
    for(const aspect of ['16:9','9:16']){
      const {references,...raw}=requestFor('text-to-image',size,aspect);
      const graph=graphFor(imageRequest(raw),'job','42',[]);
      expect(graph['6']!.inputs).toEqual({width:aspect==='16:9'?width:height,height:aspect==='16:9'?height:width,batch_size:1});
      expect(graph['7']!.inputs).toMatchObject({steps:8,cfg:1,sampler_name:'euler',scheduler:'simple'});
    }
  });

  it.each(videoSizes)('uses literal H3 canvas %s for FL and Ref in both orientations',(size,width,height)=>{
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');
    for(const route of ['fl','ref'])for(const aspect of ['16:9','9:16']){
      const refs:InputReference[]=[{...source,role:'first_frame'},{...source,id:'last',role:'last_frame'},...(route==='ref'?[auxiliary]:[])];
      const prepared=refs.map(r=>({...r,file:r.id,filename:r.id+'.png',sha256:'fixture'}));
      const graph=graphFor(imageRequest(requestFor('reference-to-video',size,aspect,refs)),'job','42',[],prepared,hardwareProfile('RTX 5090'));
      expect(graph['6']!.class_type).toBe(route==='fl'?'MiniMaxH3ImageToVideo':'MiniMaxH3ReferenceToVideo');
      expect(graph['6']!.inputs).toMatchObject({width:aspect==='16:9'?width:height,height:aspect==='16:9'?height:width,length:124});
      expect(graph['14']!.inputs).toMatchObject({seconds:5,export_version:'native-v1'});
      expect(graph['10']!.inputs.steps).toBe(30);
      const guides=Object.values(graph).filter(n=>n.class_type==='MiniMaxH3AddGuide');
      expect(guides.map(n=>n.inputs.frame_idx)).toEqual(route==='fl'?[119]:[0,119]);
      if(route==='ref')expect(graph['6']!.inputs.ref_image_size).toBe('match');
    }
  });
});

async function fixture(run:(f:{root:string;paths:ReturnType<typeof resolvePaths>;db:ReturnType<typeof openDatabase>;media:Media})=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});
  const root=mkdtempSync(path.resolve('.local/tests/resolutions-')),paths=resolvePaths(root);
  prepareStorage(paths);const db=openDatabase(paths.data),media=new Media(db,paths);
  try{await run({root,paths,db,media});}finally{await media.close();db.close();rmSync(root,{recursive:true,force:true});}
}
async function photo(media:Media,db:ReturnType<typeof openDatabase>,width:number,height:number,orientation?:number){
  const file=path.join(media.directory,'photo');
  const image=sharp({create:{width,height,channels:4,background:{r:20,g:80,b:120,alpha:0.5}}});
  if(orientation)await image.jpeg().withMetadata({orientation}).toFile(file);else await image.png().toFile(file);
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('photo','image','Photo','media/originals/photo',JSON.stringify({state:'ready',sha256:'fixture-photo',mode:'sfw'}),new Date().toISOString());
}

it('prepares only the Qwen source at its selected target, preserving alpha and independent auxiliary caching',async()=>fixture(async({media,db})=>{
  vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');await photo(media,db,4000,3072);
  const expected:Array<[ImageSize,number,number]>=[['0.5mp',832,640],['1mp',1184,896],['2mp',1664,1280],['image-480',736,576],['image-768',1152,896],['image-1440',2176,1696]];
  const sources:PreparedReference[]=[],auxiliaries:PreparedReference[]=[];
  for(const [size,width,height] of expected){
    const prepared=await media.prepare(source,'source',5,size),aux=await media.prepare(auxiliary,'source',5,size);
    sources.push(prepared);auxiliaries.push(aux);
    expect(prepared).toMatchObject({width,height});
    expect(await sharp(prepared.file).metadata()).toMatchObject({width,height,hasAlpha:true});
    expect(await sharp(aux.file).metadata()).toMatchObject({width:1184,height:896,hasAlpha:true});
    const pixels=await sharp(prepared.file).raw().toBuffer();expect(pixels[3]).toBe(128);
    const request=imageRequest(requestFor('image-to-image',size,'source',[auxiliary,source]));
    expect(request.references?.[0]?.role).toBe('source');
    const graph=graphFor(request,'job','42',[],[prepared,aux]);
    expect(graph['4']!.inputs).toMatchObject({resolution:0,'images.image_1':['100',0],'images.image_2':['101',0]});
    expect(graph['100']!.inputs).toMatchObject({image:'seed/job/'+prepared.filename,size});
    expect(graph['101']!.inputs.size).toBe('1mp');
  }
  expect(new Set(sources.map(r=>r.filename)).size).toBe(expected.length);
  expect(new Set(auxiliaries.map(r=>r.filename)).size).toBe(1);
  expect((await media.prepare(source,'source',5)).filename).toBe(sources[1]!.filename);
}));

it('reuses equivalent small-source preparations and follows EXIF orientation and JS half rounding',async()=>{
  vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');
  expect(editDimensions(48,80,'2mp')).toEqual({width:64,height:96});
  await fixture(async({media,db})=>{
    await photo(media,db,512,512);const names=[];
    for(const [size] of imageSizes){const prepared=await media.prepare(source,'source',5,size);names.push(prepared.filename);expect(prepared).toMatchObject({width:512,height:512});}
    expect(new Set(names).size).toBe(1);
  });
  await fixture(async({media,db})=>{
    await photo(media,db,4000,2000,6);
    for(const [size,width,height] of [['0.5mp',512,1024],['1mp',736,1440],['2mp',1024,2048],['image-480',448,896],['image-768',704,1440],['image-1440',1344,2720]] as const){
      expect(await sharp((await media.prepare(source,'source',5,size)).file).metadata()).toMatchObject({width,height});
    }
  });
});

it.each(videoSizes)('prepares first/last frames and shaped reference images for %s',(size,width,height)=>fixture(async({media,db})=>{
  vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');await photo(media,db,4000,2000);
  for(const aspect of ['16:9','9:16']){
    for(const role of ['first_frame','last_frame'] as const)for(const framing of ['fit','fill'] as const){
      const ref={...source,role,framing},prepared=await media.prepare(ref,aspect,5,size);
      expect(await sharp(prepared.file).metadata()).toMatchObject({width:aspect==='16:9'?width:height,height:aspect==='16:9'?height:width});
      const other=await media.prepare(ref,aspect,5,size==='480p'?'768p':'480p');expect(other.filename).not.toBe(prepared.filename);
    }
    const prepared=await media.prepare(auxiliary,aspect,5,size);
    expect(await sharp(prepared.file).metadata()).toMatchObject(size==='480p'?{width:896,height:448}:{width:1440,height:704});
  }
}));

it('separates video preparation sizes while preserving reference timing, soundtrack, and reusable audio',async()=>fixture(async({media,db})=>{
  vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');
  const file=path.join(media.directory,'clip.mp4');
  await transcode(['-f','lavfi','-i','color=c=green:s=96x64:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=32000','-t','2','-c:v','libx264','-c:a','aac',file]);
  copyFileSync(file,path.join(media.directory,'audio.mp4'));
  for(const kind of ['video','audio'])db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(kind,kind,kind,'media/originals/'+(kind==='video'?'clip':'audio')+'.mp4',JSON.stringify({state:'ready',sha256:'fixture-clip',duration:2,has_audio:true}),new Date().toISOString());
  const ref:InputReference={id:'clip',asset_id:'video',kind:'video',role:'reference',range:{start_seconds:0,duration_seconds:2},include_audio:true};
  const files=[];
  for(const [size,width,height] of videoSizes)for(const aspect of ['16:9','9:16']){
    const prepared=await media.prepare(ref,aspect,5,size);files.push(prepared.filename);
    expect(prepared.effective_frames).toBe(39);
    expect(await probe(prepared.file)).toMatchObject({width:aspect==='16:9'?width:height,height:aspect==='16:9'?height:width,fps:24});
    const sound=await probe(prepared.audio_file!);expect(sound.duration).toBeCloseTo(39/24,2);expect(sound.has_audio).toBe(true);
  }
  expect(new Set(files).size).toBe(4);
  const sound:InputReference={...ref,kind:'audio',asset_id:'audio',include_audio:undefined};
  expect((await media.prepare(sound,'16:9',5,'480p')).filename).toBe((await media.prepare(sound,'16:9',5,'768p')).filename);
}));

it('persists selected sizes and resolved dimensions in submitted job snapshots without compute',async()=>fixture(async({paths,db,media})=>{
  vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');await photo(media,db,4000,3072);
  const fake=fakePool(db,paths),jobs=new Jobs(db,paths,fake.pool);
  try{
    const raw=requestFor('image-to-image','2mp','source',[source,auxiliary]);
    const submitted=await jobs.submit(raw,'resolution-snapshot-edit');const saved=jobs.get(submitted.jobs[0]!.id)!;
    expect(saved).toMatchObject({state:'queued',output_dimensions:{width:1664,height:1280},request:{output:{size:'2mp'}},prepared:[{width:1664,height:1280},{width:1184,height:896}]});
    const {references,...krea}=requestFor('text-to-image','0.5mp','9:16');
    expect((await jobs.submit(krea,'resolution-snapshot-krea')).jobs[0]).toMatchObject({output_dimensions:{width:504,height:896}});
    expect((await jobs.submit(requestFor('text-to-video','480p'),'resolution-snapshot-video')).jobs[0]).toMatchObject({output_dimensions:{width:864,height:480}});
    const restarted=new Jobs(db,paths,fake.pool);
    try{expect(restarted.get(saved.id)).toMatchObject({output_dimensions:{width:1664,height:1280},request:{output:{size:'2mp'}}});}
    finally{await restarted.close();await restarted.media.close();}
    expect(fake.providers.vast.create).not.toHaveBeenCalled();
  }finally{await jobs.close();await jobs.media.close();await fake.pool.close();}
}));

it('copies the catalog into an isolated app package and includes its Python consumer in the worker image',async()=>fixture(async({root})=>{
  const isolated=path.join(root,'package');
  execFileSync(process.execPath,[path.resolve('scripts/copy-worker-release.mjs'),isolated],{windowsHide:true});
  expect(readFileSync(path.join(isolated,'worker/resolutions.json'),'utf8')).toBe(readFileSync('worker/resolutions.json','utf8'));
  expect(JSON.parse(readFileSync(path.join(isolated,'worker/resolutions.json'),'utf8')).image.filter((p:any)=>!p.legacy).map((p:any)=>[p.id,p.released])).toEqual([['image-480',true],['image-768',true],['2mp',true],['image-1440',true]]);
  expect(readFileSync('worker/Dockerfile','utf8')).toContain('COPY resolution.py resolutions.json /opt/seed/worker/');
}));
