import { it, expect } from 'vitest';
import { imageRequest, graphFor } from '../server/workflows.js';

const input = {workflow:'text-to-video',capabilities_revision:'test',prompt:'A person speaks.',mode:'sfw',output:{aspect:'16:9',size:'native',duration_seconds:5}};
const preset = {filename:'seed-'+ 'a'.repeat(64)+'.safetensors',sha256:'a'.repeat(64),strength_model:1,revision:'verified'};

it('keeps omitted legacy quality unchanged and rejects arbitrary quality or graph controls', () => {
  const legacy=imageRequest({...input,output:{...input.output,size:'720p'}});
  expect(legacy).not.toHaveProperty('quality');
  const graph=graphFor(legacy,'job','42',null);
  expect(graph['5']!.class_type).toBe('LoraLoaderModelOnly');
  expect(graph['10']!.inputs.steps).toBe(8);
  expect(graph['14']!.inputs).not.toHaveProperty('export_version');
  for(const quality of [true,'ultra',null]) expect(()=>imageRequest({...input,quality})).toThrow();
  expect(()=>imageRequest({...input,steps:50})).toThrow();
  expect(()=>imageRequest({...input,workflow:'text-to-image',quality:'high',output:{aspect:'16:9',size:'1mp'}})).toThrow();
  expect(()=>imageRequest({...input,quality:'high',output:{...input.output,size:'720p'}})).toThrow('native');
});

it.each(['sfw','nsfw'])('extends FL and Ref with the native HQ recipe in %s', mode => {
  for(const reference of [false,true]) {
    const references=reference?[{id:'picture',asset_id:'asset',kind:'image',role:'reference'}]:[];
    const request=imageRequest({...input,workflow:reference?'reference-to-video':'text-to-video',mode,quality:'high',references});
    const graph=graphFor(request,'job','42',mode==='nsfw'?preset:null);
    expect(graph['1']!.inputs.unet_name).toContain(reference?'ref2va':'fl2va');
    expect(graph['5']).toBeUndefined();
    expect(graph['16']!.inputs).toEqual({model:['1',0],shift_video:12,shift_audio:3});
    expect(graph['17']!.inputs).toEqual({model:[mode==='nsfw'?'18':'16',0],attention:'comfy kitchen attention'});
    expect(graph['19']!.inputs).toEqual({model:['17',0],selection:'sol-attn','selection.tau':1.3,start_percent:0.2,end_percent:1,dense_blocks:'',min_tokens:12288,extra_tokens:256,sink_conditioning:'exact_kv_and_rows',verbose:true});
    expect(graph['7']!.inputs.model).toEqual(['19',0]);
    expect(graph['10']!.inputs).toEqual({model:['19',0],scheduler:'simple',steps:30,denoise:1});
    expect(graph['9']!.inputs.sampler_name).toBe('res_multistep');
    expect(graph['12']!.inputs.samples).toEqual(graph['13']!.inputs.samples);
    if(mode==='nsfw') expect(graph['18']!.inputs).toEqual({model:['16',0],lora_name:preset.filename,strength_model:0.8});
    expect(preset.strength_model).toBe(1);
  }
});

it.each(['fast','high'])('preserves native outputs, exact duration and final anchor in %s', quality => {
  const request=imageRequest({...input,workflow:'reference-to-video',quality,output:{...input.output,aspect:'9:16',duration_seconds:15},references:[{id:'last',asset_id:'asset',kind:'image',role:'last_frame'}]});
  const refs=[{...request.references![0]!,filename:'last.png',file:'last.png',sha256:'b'.repeat(64)}];
  const graph=graphFor(request,'job','42',null,refs);
  expect(graph['6']!.inputs).toMatchObject({width:768,height:1344,length:362});
  expect(graph['14']!.inputs).toMatchObject({export_version:'native-v1',seconds:15});
  const guide=Object.entries(graph).find(([,n])=>n.class_type==='MiniMaxH3AddGuide')!;
  expect(guide[1].inputs.frame_idx).toBe(359);
  expect(graph['7']!.inputs.conditioning).toEqual([guide[0],0]);
  expect(graph['11']!.inputs.latent_image).toEqual(['6',1]);
  const frames=graphFor({...request,output:{...request.output,format:'images'}},'job','42',null,refs);
  expect(frames['15']!.inputs.length).toBe(360);
  expect(frames['14']!.class_type).toBe('SaveImage');
  expect(frames['13']).toBeUndefined();
});
