import {it,expect} from 'vitest';
import {imageRequest} from '../server/workflows.js';
import {graphFor} from '../server/worker-graphs.js';
import type {PreparedReference} from '../server/media.js';
import {videoProfile} from '../shared/video-settings.js';
const base={workflow:'text-to-video',prompt:'A forest',mode:'sfw',output:{aspect:'16:9',size:'768p',duration_seconds:15}};
const prepared=(id:string,kind:'image'|'video'|'audio',role:'reference'|'last_frame'='reference'):PreparedReference=>({id,asset_id:id,kind,role,filename:id+'.png',file:id,sha256:'a'.repeat(64)});
it.each([10,15,20,30] as const)('preserves %i steps through validation, sampling, and profile selection',steps=>{
  const request=imageRequest({...base,steps});
  expect(graphFor(request,'job','42',[])['10']!.inputs.steps).toBe(steps);
  expect(videoProfile(request)).toBe(steps===30?'h3-high-v1':`h3-base-${steps}-v1`);
});
it.each([8,0,25,31,'20',null])('rejects an unsupported step count %s',steps=>{
  expect(()=>imageRequest({...base,steps})).toThrow(/steps/);
});
it('uses the official model choices and dense sampling for local video',()=>{
  const request=imageRequest({...base,steps:20});
  const graph=graphFor(request,'job','42',[],[],true);
  expect(graph['2']!.inputs.clip_name).toBe('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors');
  expect(graph['3']!.inputs.vae_name).toBe('minimax_h3_video_vae_int8_convrot.safetensors');
  expect(graph['7']!.inputs.model).toEqual(['1',0]);
  expect(graph['10']!.inputs).toMatchObject({model:['1',0],scheduler:'simple',steps:20});
  expect(graph['9']!.inputs.sampler_name).toBe('res_multistep');
  expect(graph['16']).toBeUndefined();expect(graph['17']).toBeUndefined();expect(graph['19']).toBeUndefined();
  expect(videoProfile(request,true)).toBe('h3-official-20-v1');
  const loras=[{filename:'style.safetensors',sha256:'a'.repeat(64),strength_model:1}];
  const styled=graphFor(request,'job','42',loras,[],true);
  expect(styled['30']!.inputs.model).toEqual(['1',0]);expect(styled['7']!.inputs.model).toEqual(['30',0]);
});
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
