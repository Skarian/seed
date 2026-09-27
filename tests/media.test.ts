import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,utimesSync} from 'node:fs';
import sharp from 'sharp';
import {Media,transcode,verifyMediaTools} from '../server/media.js';
import {openDatabase} from '../server/db.js';
import {prepareStorage} from '../server/storage.js';
import path from 'node:path';
import {createApp} from '../server/http.js';
import {resolvePaths} from '../server/storage.js';
import {imageRequest} from '../server/workflows.js';
import {videoRoute} from '../server/video.js';
it('resumes a real tus upload and makes a verified original available',async()=>{
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/media-'));
  const app=await createApp({paths:resolvePaths(root),port:4317,webRoot:path.resolve('dist/web')});await app.listen({host:'127.0.0.1',port:4317});
  const origin='http://127.0.0.1:4317';const headers={Origin:origin,'Tus-Resumable':'1.0.0'};
  try{
    const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64');
    const metadata=Object.entries({kind:'image',filename:'test.png',filetype:'text/html',mode:'sfw'}).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
    const start=await fetch(origin+'/api/v1/uploads',{method:'POST',headers:{...headers,'Upload-Length':String(image.length),'Upload-Metadata':metadata}});expect(start.status).toBe(201);
    const location=new URL(start.headers.get('location')!,origin).href;
    const content=origin+'/api/v1/assets/'+location.split('/').pop()+'/content';
    expect((await fetch(content)).status).toBe(409);
    for(const [offset,chunk] of [[0,image.subarray(0,32)],[32,image.subarray(32)]] as const){
      const patched=await fetch(location,{method:'PATCH',headers:{...headers,'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},body:chunk});expect(patched.status).toBe(204);
      const head=await fetch(location,{method:'HEAD',headers});expect(head.headers.get('upload-offset')).toBe(String(offset+chunk.length));
    }
    let asset:any;for(let i=0;i<30;i++){asset=await (await fetch(origin+'/api/v1/assets/'+location.split('/').pop())).json();if(asset.state==='ready')break;await new Promise(r=>setTimeout(r,100));}
    expect(asset).toMatchObject({state:'ready',kind:'image',width:1,height:1});expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await fetch(content)).headers.get('content-type')).toBe('image/png');
    const cancelled=await fetch(origin+'/api/v1/uploads',{method:'POST',headers:{...headers,'Upload-Length':'100','Upload-Metadata':metadata}});
    const cancelledLocation=new URL(cancelled.headers.get('location')!,origin).href;
    expect((await fetch(cancelledLocation,{method:'DELETE',headers})).status).toBe(204);
    expect(await (await fetch(origin+'/api/v1/assets/'+cancelledLocation.split('/').pop())).json()).toMatchObject({state:'error'});
  }finally{await app.close();await new Promise(r=>setTimeout(r,30));rmSync(root,{recursive:true,force:true});}
});
it('prepares oriented phone photos without stretching and expires abandoned reservations',async()=>{
  const root=mkdtempSync(path.resolve('.local/tests/oriented-')),paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data),media=new Media(db,paths);
  try{
    const file=path.join(media.directory,'photo');await sharp({create:{width:640,height:320,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toFile(file);
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('photo','image','photo.jpg','media/originals/photo',JSON.stringify({state:'ready',sha256:'a'.repeat(64)}),new Date().toISOString());
    const prepared=await media.prepare({id:'ref',asset_id:'photo',kind:'image',role:'reference'},'16:9',5);
    const info=await sharp(prepared.file).metadata();expect(info.width).toBe(320);expect(info.height).toBe(640);
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('old','image','old.png','media/originals/old',JSON.stringify({state:'uploading',size:100}),new Date(Date.now()-86400001).toISOString());
    await media.scan();expect(media.get('old').metadata.state).toBe('error');
  }finally{await media.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('routes anchors through FL and mixed conditioning through Ref',()=>{
  const request=imageRequest({workflow:'reference-to-video',prompt:'A scene',mode:'nsfw',output:{aspect:'16:9',size:'768p',duration_seconds:5},references:[{id:'first',asset_id:'asset',kind:'image',role:'last_frame'}]});
  expect(videoRoute(request)).toBe('fl');
  request.references!.push({id:'ref',asset_id:'second',kind:'image',role:'reference'});expect(videoRoute(request)).toBe('ref');
  expect(()=>imageRequest({...request,prompt:'Use <Picture 2>'})).toThrow('reference mention');
  expect(()=>imageRequest({...request,prompt:'Use [removed reference]'})).toThrow('reference mention');
  expect(imageRequest({...request,prompt:'Use <Picture 1>'}).references).toHaveLength(2);
  expect(imageRequest({...request,references:request.references!.slice(1),prompt:'Use <Picture 1>'}).prompt).toBe('Use <Picture 1>');
});

it('prepares a saved generation that has no upload state metadata',async()=>{
  const root=mkdtempSync(path.resolve('.local/tests/gallery-')),paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data),media=new Media(db,paths);
  try{
    const file=path.join(paths.data,'media/outputs/saved.png');mkdirSync(path.dirname(file),{recursive:true});
    await sharp({create:{width:64,height:48,channels:3,background:'green'}}).png().toFile(file);
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('saved','image','Saved image','media/outputs/saved.png',JSON.stringify({sha256:'b'.repeat(64),mime_type:'image/png',job_id:'old-job'}),new Date().toISOString());
    const prepared=await media.prepare({id:'ref',asset_id:'saved',kind:'image',role:'reference'},'16:9',5);
    expect((await sharp(prepared.file).metadata()).format).toBe('png');
  }finally{await media.close();db.close();rmSync(root,{recursive:true,force:true});}
});


it('restores saved video metadata and prepares its soundtrack from the Library',async()=>{
  const root=mkdtempSync(path.resolve('.local/tests/saved-video-')),paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data),media=new Media(db,paths);
  try {
    const file=path.join(media.directory,'video.mp4');
    await transcode(['-f','lavfi','-i','color=c=green:s=64x64:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=32000','-t','3','-c:v','libx264','-c:a','aac',file]);
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('video','video','Video','media/originals/video.mp4',JSON.stringify({sha256:'a'.repeat(64),mime_type:'video/mp4'}),new Date().toISOString());
    expect((await media.describe('video')).metadata).toMatchObject({has_audio:true,width:64,height:64,duration:3});
    const prepared=await media.prepare({id:'video',asset_id:'video',kind:'video',role:'reference',range:{start_seconds:0,duration_seconds:3},include_audio:true},'16:9',5);
    expect(prepared.audio_file).toBeTruthy();expect(media.get('video').metadata.has_audio).toBe(true);
  } finally {await media.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('reports missing media executables before startup',async()=>{
  await expect(verifyMediaTools('missing-ffmpeg-fixture')).rejects.toThrow('install scripts enabled');
  await verifyMediaTools();
});
