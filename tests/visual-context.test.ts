import {afterEach,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {transcode} from '../server/media.js';
import {visualContext} from '../server/chat/visual-context.js';

const roots:string[]=[];
function fixture(){mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/visual-context-'));roots.push(root);return root;}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function makeVideo(file:string){await transcode(['-f','lavfi','-i','color=c=red:s=96x64:r=10:d=2','-f','lavfi','-i','color=c=green:s=96x64:r=10:d=2','-f','lavfi','-i','color=c=blue:s=96x64:r=10:d=2','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',file]);}

it('samples real video frames from the selected range and labels their timestamps truthfully',async()=>{
 const root=fixture(),file=path.join(root,'colors.mp4');
 await makeVideo(file);
 const result=await visualContext(root,[{id:'clip',kind:'video',relative_path:'colors.mp4',metadata:{duration:6}}],new Map([['clip',{start_seconds:2,duration_seconds:3}]]));
 expect(result.unavailable).toEqual([]);expect(result.images).toHaveLength(3);
 expect(result.evidence.map(e=>e.timestamp_seconds)).toEqual([2,3.5,4.85]);
 expect(result.evidence.every(e=>e.type==='sampled_video_frame'&&e.asset_id==='clip')).toBe(true);
 const colors=[];
 for(const image of result.images){
  expect(image.mimeType).toBe('image/jpeg');const buffer=Buffer.from(image.data,'base64'),meta=await sharp(buffer).metadata();
  expect(meta.width).toBeLessThanOrEqual(768);expect(meta.height).toBeLessThanOrEqual(768);
  colors.push((await sharp(buffer).resize(1,1).raw().toBuffer()).subarray(0,3));
 }
 for(const color of colors.slice(0,2)){expect(color[1]!).toBeGreaterThan(color[0]!+40);expect(color[1]!).toBeGreaterThan(color[2]!+40);}
 expect(colors[2]![2]!).toBeGreaterThan(colors[2]![1]!+100);
},30000);

it('samples the beginning, middle and end of a fresh source before any clip is selected',async()=>{
 const root=fixture();await makeVideo(path.join(root,'colors.mp4'));
 const result=await visualContext(root,[{id:'fresh',kind:'video',relative_path:'colors.mp4',metadata:{duration:6}}]);
 expect(result.evidence.map(e=>e.timestamp_seconds)).toEqual([0,3,5.85]);
 expect(result.evidence.every(e=>e.type==='sampled_video_frame')).toBe(true);
 expect(result.unavailable_inputs).toEqual([]);
 for(const [index,channel] of [0,1,2].entries()){
  const pixel=await sharp(Buffer.from(result.images[index]!.data,'base64')).resize(1,1).raw().toBuffer();
  for(const other of [0,1,2].filter(value=>value!==channel))expect(pixel[channel]!).toBeGreaterThan(pixel[other]!+40);
 }
},30000);

it('bounds image count and image dimensions while preserving evidence order',async()=>{
 const root=fixture();await sharp({create:{width:1600,height:800,channels:3,background:'red'}}).png().toFile(path.join(root,'wide.png'));
 const assets=Array.from({length:14},(_,i)=>({id:'image-'+i,kind:'image',relative_path:'wide.png'}));
 const result=await visualContext(root,assets);
 expect(result.images).toHaveLength(12);expect(result.evidence.map(e=>e.asset_id)).toEqual(assets.slice(0,12).map(a=>a.id));
 expect(result.unavailable_inputs).toEqual([{asset_id:'image-12',reason:'visual_budget'},{asset_id:'image-13',reason:'visual_budget'}]);
 const metadata=await sharp(Buffer.from(result.images[0]!.data,'base64')).metadata();expect(metadata).toMatchObject({width:1024,height:512});
 expect(result.evidence.every(e=>e.type==='image'&&e.timestamp_seconds===undefined)).toBe(true);
});

it('marks corrupt media and out-of-root paths unavailable without fabricated visual evidence',async()=>{
 const root=fixture();writeFileSync(path.join(root,'broken'),'not a media file');
 const result=await visualContext(root,[{id:'bad-image',kind:'image',relative_path:'broken'},{id:'bad-video',kind:'video',relative_path:'broken'},{id:'outside',kind:'image',relative_path:'../outside.png'},{id:'audio',kind:'audio',relative_path:'broken'}]);
 expect(result.images).toEqual([]);expect(result.evidence).toEqual([]);expect(result.unavailable.sort()).toEqual(['bad-image','bad-video','outside']);
},30000);

it('keeps separate ranges of one asset bound to their input instances',async()=>{
 const root=fixture();await makeVideo(path.join(root,'colors.mp4'));
 const result=await visualContext(root,[{id:'clip',kind:'video',relative_path:'colors.mp4',metadata:{duration:6}}],new Map([['clip',[{input_id:'opening',start_seconds:0,duration_seconds:2},{input_id:'ending',start_seconds:4,duration_seconds:2}]]]));
 expect(result.images).toHaveLength(6);expect(result.unavailable_inputs).toEqual([]);
 expect(result.evidence.map(e=>[e.input_id,e.timestamp_seconds])).toEqual([['opening',0],['ending',4],['opening',1],['ending',5],['opening',1.85],['ending',5.85]]);
 for(let i=0;i<result.images.length;i++){
  const color=await sharp(Buffer.from(result.images[i]!.data,'base64')).resize(1,1).raw().toBuffer();
  if(result.evidence[i]!.input_id==='opening')expect(color[0]!).toBeGreaterThan(color[2]!+100);
  else expect(color[2]!).toBeGreaterThan(color[0]!+100);
 }
},30000);

it('reserves a visual sample for later inputs before taking extra video frames',async()=>{
 const root=fixture();await makeVideo(path.join(root,'colors.mp4'));await sharp({create:{width:16,height:16,channels:3,background:'green'}}).png().toFile(path.join(root,'image.png'));
 const assets=[{id:'clip',kind:'video',relative_path:'colors.mp4',metadata:{duration:6}},...Array.from({length:10},(_,i)=>({id:'image'+i,kind:'image',relative_path:'image.png'}))];
 const result=await visualContext(root,assets,new Map([['clip',[{input_id:'early',start_seconds:0,duration_seconds:2},{input_id:'late',start_seconds:4,duration_seconds:2}]]]));
 expect(result.images).toHaveLength(12);expect(result.unavailable_inputs).toEqual([]);
 expect(result.evidence.filter(e=>e.type==='sampled_video_frame').map(e=>e.input_id)).toEqual(['early','late']);
 expect(result.evidence.filter(e=>e.type==='image')).toHaveLength(10);
},30000);

it('reports an invalid clip instance without claiming to have sampled it',async()=>{
 const root=fixture();
 const result=await visualContext(root,[{id:'clip',kind:'video',relative_path:'unused.mp4',metadata:{duration:6}}],new Map([['clip',[{input_id:'too-late',start_seconds:5,duration_seconds:3}]]]));
 expect(result.images).toEqual([]);expect(result.evidence).toEqual([]);
 expect(result.unavailable_inputs).toEqual([{asset_id:'clip',input_id:'too-late',reason:'invalid_range'}]);
});
