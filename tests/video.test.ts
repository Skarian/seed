import {it,expect} from 'vitest';
import {imageRequest} from '../server/workflows.js';
import {graphFor} from '../server/worker-graphs.js';
import type {PreparedReference} from '../server/media.js';
import {videoProfile} from '../shared/video-settings.js';
import {hardwareProfile,hardwareProfiles} from '../server/hardware.js';
const hardware=hardwareProfile('NVIDIA GeForce RTX 5090')!;
const base={workflow:'text-to-video',prompt:'A forest',mode:'sfw',output:{aspect:'16:9',size:'768p',duration_seconds:15}};
const prepared=(id:string,kind:'image'|'video'|'audio',role:'reference'|'last_frame'='reference'):PreparedReference=>({id,asset_id:id,kind,role,filename:id+'.png',file:id,sha256:'a'.repeat(64)});
it.each([10,15,20,30] as const)('preserves %i steps through validation, sampling, and profile selection',steps=>{
  const request=imageRequest({...base,steps});
  expect(graphFor(request,'job','42',[],[],hardware)['10']!.inputs.steps).toBe(steps);
  expect(videoProfile(request)).toBe(`h3-full-${steps}`);
});
it.each([8,0,25,31,'20',null])('rejects an unsupported step count %s',steps=>{
  expect(()=>imageRequest({...base,steps})).toThrow(/steps/);
});
it('rejects an unknown detail setting',()=>{
  expect(()=>imageRequest({...base,detail:'dense'})).toThrow(/detail/);
});
it('builds the same graph for every host with a profile',()=>{
  const [first,second]=hardwareProfiles();
  expect(graphFor(imageRequest({...base,steps:20}),'job','42',[],[],first)).toEqual(graphFor(imageRequest({...base,steps:20}),'job','42',[],[],second));
  expect(()=>graphFor(imageRequest(base),'job','42',[])).toThrow(/hardware profile/);
});
it('selects model files and attention tuning from the hardware profile',()=>{
  const tuned={...hardware,models:{...hardware.models,text_encoder:'other-encoder.safetensors'},attention:{...hardware.attention,tau:2}};
  const graph=graphFor(imageRequest({...base,detail:'standard'}),'job','42',[],[],tuned);
  expect(graph['2']!.inputs.clip_name).toBe('other-encoder.safetensors');expect(graph['19']!.inputs['selection.tau']).toBe(2);
});
it.each([10,15,20,30] as const)('runs Full detail at %i steps with Comfy\'s default attention',steps=>{
  const request=imageRequest({...base,steps,detail:'full'});
  const graph=graphFor(request,'job','42',[],[],hardware);
  for(const node of ['16','17','19'])expect(graph[node]).toBeUndefined();
  expect(graph['7']!.inputs.model).toEqual(['1',0]);expect(graph['10']!.inputs).toMatchObject({model:['1',0],steps});
  expect(videoProfile(request)).toBe(`h3-full-${steps}`);
  const loras=[{filename:'style.safetensors',sha256:'a'.repeat(64),strength_model:1}];
  const styled=graphFor(request,'job','42',loras,[],hardware);
  expect(styled['30']!.inputs.model).toEqual(['1',0]);expect(styled['7']!.inputs.model).toEqual(['30',0]);
});
it('runs Fast detail through Kitchen and Sol after any LoRAs',()=>{
  const loras=[{filename:'style.safetensors',sha256:'a'.repeat(64),strength_model:1}];
  const graph=graphFor(imageRequest({...base,detail:'standard'}),'job','42',loras,[],hardware);
  expect(graph['17']!.inputs).toEqual({model:['30',0],attention:'comfy kitchen attention'});
  expect(graph['19']!.inputs).toMatchObject({model:['17',0],selection:'sol-attn','selection.tau':1.3,start_percent:.2,end_percent:1,dense_blocks:'',min_tokens:12288,extra_tokens:256,sink_conditioning:'exact_kv_and_rows'});
  expect(graph['7']!.inputs.model).toEqual(['19',0]);expect(graph['10']!.inputs.model).toEqual(['19',0]);
});
it('keeps 30 steps and uses Full detail for saved requests without those settings',()=>{
  const graph=graphFor(imageRequest(base),'job','42',[],[],hardware);
  expect(graph['1']!.inputs.unet_name).toBe('minimax_h3_fl2va_pruned_int8_convrot.safetensors');
  expect(graph['5']).toBeUndefined();expect(graph['9']!.inputs.sampler_name).toBe('res_multistep');
  expect(graph['10']!.inputs.steps).toBe(30);
  expect(graph['7']!.inputs.model).toEqual(['1',0]);
  expect(graph['6']!.inputs).toMatchObject({width:1344,height:768,length:362});
  expect(graph['14']!.inputs).toMatchObject({seconds:15,export_version:'native-v1',audio_mode:'generated'});
});
it('supports mixed references and last-frame guides without colliding with adapter nodes',()=>{
  const refs=[prepared('identity','image'),prepared('end','image','last_frame')];
  const request=imageRequest({...base,workflow:'reference-to-video',references:refs.map(({file,filename,sha256,...r})=>r)});
  const loras=[.2,1.3,4].map((strength_model,i)=>({filename:'adapter-'+i+'.safetensors',sha256:String(i).repeat(64),strength_model}));
  const graph=graphFor(request,'job','42',loras,refs,hardware);
  expect(graph['1']!.inputs.unet_name).toContain('ref2va');
  expect(graph['7']!.inputs.model).toEqual(['32',0]);
  expect(graph['30']!.inputs).toMatchObject({model:['1',0],strength_model:.2});
  expect(graph['31']!.inputs).toMatchObject({model:['30',0],strength_model:1.3});
  expect(graph['32']!.inputs).toMatchObject({model:['31',0],strength_model:4});
  expect(graph['6']!.inputs['ref_images.ref_image_0']).toEqual(['40',0]);
  expect(graph['42']!.inputs).toMatchObject({frame_idx:-1,audio_vae:['4',0]});expect(graph['7']!.inputs.conditioning).toEqual(['42',0]);
});
it('keeps native reference video soundtracks attached to their corresponding clip',()=>{
  const refs=[prepared('sound','audio'),{...prepared('motion','video'),audio_file:'motion.wav',audio_filename:'motion.wav'}];
  const request=imageRequest({...base,workflow:'reference-to-video',references:refs.map(({file,filename,sha256,audio_file,audio_filename,...r}:any)=>({...r,range:{start_seconds:0,duration_seconds:3}}))});
  const graph=graphFor(request,'job','42',[],refs,hardware);
  expect(graph['6']!.inputs['ref_audios.ref_audio_0']).toEqual(['40',0]);
  expect(graph['6']!.inputs['ref_videos.ref_video_0']).toEqual(['41',0]);
  expect(graph['6']!.inputs['ref_video_audios.ref_video_audio_0']).toEqual(['42',0]);
});
