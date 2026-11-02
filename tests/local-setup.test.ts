import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {LocalSetup} from '../server/local-setup.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {localLease} from '../scripts/local-lock.mjs';
import {engineSpec} from '../server/hardware.js';

it('reports installed only when the current runtime and every verified model are present',async()=>{
  await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/setup-models-'));
  const setup=new LocalSetup(resolvePaths(root),root);
  const image={path:'diffusion_models/image.bin',size:3,sha256:'image-hash'},video={path:'diffusion_models/video.bin',size:4,sha256:'video-hash'};
  vi.spyOn(setup as any,'models').mockImplementation(async()=>[image,video]);
  try{
    await mkdir(path.join(root,'models/diffusion_models'),{recursive:true});
    await writeFile(path.join(root,'models',image.path),'img');
    await writeFile(path.join(root,'runtime-ready.json'),JSON.stringify({revision:engineSpec().revision}));
    await writeFile(path.join(root,'models-verified.json'),JSON.stringify({files:[image,video]}));
    expect(await setup.status()).toMatchObject({installed:false,files_done:1,files_total:2});
    await writeFile(path.join(root,'models',video.path),'data');
    expect((await setup.status()).installed).toBe(true);
    await writeFile(path.join(root,'runtime-ready.json'),JSON.stringify({revision:'old'}));
    expect((await setup.status()).installed).toBe(false);
  }finally{await setup.close();await rm(root,{recursive:true,force:true});}
});

it('picks models for the detected GPU and removes duplicates',async()=>{
  await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/setup-profile-'));
  const setup=new LocalSetup(resolvePaths(root),root);
  try{
    const video='text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',image='diffusion_models/krea2_turbo_int8_convrot.safetensors';
    await writeFile(path.join(root,'runtime-ready.json'),JSON.stringify({revision:engineSpec().revision,gpu:'NVIDIA GeForce RTX 5090'}));
    const paths=(await (setup as any).models()).map((file:any)=>file.path);
    expect(paths).toContain(video);expect(new Set(paths).size).toBe(paths.length);
    await writeFile(path.join(root,'runtime-ready.json'),JSON.stringify({revision:engineSpec().revision,gpu:'Fixture GPU'}));
    const imageOnly=(await (setup as any).models()).map((file:any)=>file.path);
    expect(imageOnly).toContain(image);expect(imageOnly).not.toContain(video);
  }finally{await setup.close();await rm(root,{recursive:true,force:true});}
});

it('serializes setup and cleanup while preserving saved media and durable recovery data',async()=>{
  await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/local-setup-'));
  const paths=resolvePaths(root);prepareStorage(paths);const managed=path.join(paths.data,'local-worker');
  await mkdir(path.join(managed,'models'),{recursive:true});await writeFile(path.join(managed,'models','fixture'),'download');
  const output=path.join(paths.data,'media/outputs/keep.png'),receipt=path.join(paths.data,'local-workspace/.seed/spool/keep.json');
  await mkdir(path.dirname(output),{recursive:true});await mkdir(path.dirname(receipt),{recursive:true});await writeFile(output,'Library');await writeFile(receipt,'receipt');
  const setup=new LocalSetup(paths,managed);
  try{
    const release=await localLease(managed);
    try{await expect(setup.cleanup('all')).rejects.toThrow('in use');expect(await readFile(path.join(managed,'models','fixture'),'utf8')).toBe('download');}finally{await release();}
    await setup.cleanup('all');expect(await readFile(output,'utf8')).toBe('Library');expect(await readFile(receipt,'utf8')).toBe('receipt');
    await expect(readFile(path.join(managed,'models','fixture'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await setup.status()).installed).toBe(false);
  }finally{await setup.close();await rm(root,{recursive:true,force:true});}
});

it('reports interrupted setup after restart without downloading or starting an engine',async()=>{
  await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/setup-restart-'));
  await writeFile(path.join(root,'setup-status.json'),JSON.stringify({state:'running',phase:'Downloading'}));
  const setup=new LocalSetup(resolvePaths(root),root);
  try{expect(await setup.status()).toMatchObject({state:'failed',installed:false,phase:'Setup interrupted'});}finally{await setup.close();await rm(root,{recursive:true,force:true});}
});

it('refuses redirected cleanup targets before deleting any installation files',async()=>{
  await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/setup-redirect-'));
  const managed=path.join(root,'managed'),outside=path.join(root,'saved');
  await mkdir(managed);await mkdir(outside);await mkdir(path.join(managed,'models'));
  await writeFile(path.join(managed,'models','keep'),'model');await writeFile(path.join(outside,'keep'),'Library');
  await symlink(outside,path.join(managed,'image'),process.platform==='win32'?'junction':'dir');
  const setup=new LocalSetup(resolvePaths(root),managed);
  try{
    await expect(setup.cleanup('all')).rejects.toThrow('redirected');
    expect(await readFile(path.join(managed,'models','keep'),'utf8')).toBe('model');
    expect(await readFile(path.join(outside,'keep'),'utf8')).toBe('Library');
  }finally{await setup.close();await rm(root,{recursive:true,force:true});}
});
