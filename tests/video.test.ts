import {it,expect} from 'vitest';
import {imageRequest} from '../server/workflows.js';
import {graphFor} from '../server/worker-graphs.js';
import type {PreparedReference} from '../server/media.js';
const base={workflow:'text-to-video',prompt:'A forest',mode:'sfw',output:{aspect:'16:9',size:'768p',duration_seconds:15}};
const prepared=(id:string,kind:'image'|'video'|'audio',role:'reference'|'last_frame'='reference'):PreparedReference=>({id,asset_id:id,kind,role,filename:id+'.png',file:id,sha256:'a'.repeat(64)});
it('restores the measured high-quality H3 recipe without acceleration adapters',()=>{
  const graph=graphFor(imageRequest(base),'job','42',[]);
  expect(graph['1']!.inputs.unet_name).toBe('minimax_h3_fl2va_pruned_int8_convrot.safetensors');
  expect(graph['5']).toBeUndefined();expect(graph['9']!.inputs.sampler_name).toBe('res_multistep');
  expect(graph['10']!.inputs.steps).toBe(30);expect(graph['19']!.inputs.selection).toBe('sol-attn');
  expect(graph['6']!.inputs).toMatchObject({width:1344,height:768,length:362});
  expect(graph['14']!.inputs).toMatchObject({seconds:15,export_version:'native-v1',audio_mode:'generated'});
});
it('supports mixed references and last-frame guides without colliding with adapter nodes',()=>{
  const refs=[prepared('identity','image'),prepared('end','image','last_frame')];
  const request=imageRequest({...base,workflow:'reference-to-video',references:refs.map(({file,filename,sha256,...r})=>r)});
  const loras=[.2,1.3,4].map((strength_model,i)=>({filename:'adapter-'+i+'.safetensors',sha256:String(i).repeat(64),strength_model}));
  const graph=graphFor(request,'job','42',loras,refs);
  expect(graph['1']!.inputs.unet_name).toContain('ref2va');
  expect(graph['17']!.inputs.model).toEqual(['32',0]);
  expect(graph['30']!.inputs).toMatchObject({model:['16',0],strength_model:.2});
  expect(graph['31']!.inputs).toMatchObject({model:['30',0],strength_model:1.3});
  expect(graph['32']!.inputs).toMatchObject({model:['31',0],strength_model:4});
  expect(graph['6']!.inputs['ref_images.ref_image_0']).toEqual(['40',0]);
  expect(graph['42']!.inputs.frame_idx).toBe(359);expect(graph['7']!.inputs.conditioning).toEqual(['42',0]);
});
it('keeps native reference video soundtracks attached to their corresponding clip',()=>{
  const refs=[prepared('sound','audio'),{...prepared('motion','video'),audio_file:'motion.wav',audio_filename:'motion.wav'}];
  const request=imageRequest({...base,workflow:'reference-to-video',references:refs.map(({file,filename,sha256,audio_file,audio_filename,...r}:any)=>({...r,range:{start_seconds:0,duration_seconds:3}}))});
  const graph=graphFor(request,'job','42',[],refs);
  expect(graph['6']!.inputs['ref_audios.ref_audio_0']).toEqual(['40',0]);
  expect(graph['6']!.inputs['ref_videos.ref_video_0']).toEqual(['41',0]);
  expect(graph['6']!.inputs['ref_video_audios.ref_video_audio_0']).toEqual(['42',0]);
});
