import type { ImageRequest, Preset } from './workflows.js';
import type { PreparedReference } from './media.js';
export function videoRequest(value:any):ImageRequest {
  if(!value||Object.keys(value).some(k=>!['workflow','capabilities_revision','prompt','mode','output','seed','count','references','audio'].includes(k))||!['text-to-video','reference-to-video'].includes(value.workflow)||typeof value.capabilities_revision!=='string'||typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>12000||!['sfw','nsfw'].includes(value.mode))throw new Error('Check the video settings.');
  if(!value.output||Object.keys(value.output).some(k=>!['aspect','size','duration_seconds','format'].includes(k))||!['16:9','9:16'].includes(value.output.aspect)||value.output.size!=='720p'||(!Number.isInteger(value.output.duration_seconds)||value.output.duration_seconds<5||value.output.duration_seconds>15)|| (value.output.format!==undefined&&!['video','images'].includes(value.output.format)))throw new Error('Choose a supported video size and length.');
  const count=value.count??1,seed=value.seed??'random';if(!Number.isInteger(count)||count<1||count>16||typeof seed!=='string'||(seed!=='random'&&(!/^(0|[1-9][0-9]{0,15})$/.test(seed)||BigInt(seed)+BigInt(count-1)>9007199254740991n)))throw new Error('Check the generation count and seed.');
  const references=value.references??[];if(!Array.isArray(references)||references.length>12||(value.workflow==='reference-to-video'&&!references.length)||(value.workflow==='text-to-video'&&references.length))throw new Error('Check the video references.');
  const ids=new Set();for(const ref of references){if(!ref||Object.keys(ref).some(k=>!['id','asset_id','kind','role','range','include_audio','framing'].includes(k))||typeof ref.id!=='string'||!/^[-\w]{1,100}$/.test(ref.id)||ids.has(ref.id)||typeof ref.asset_id!=='string'||!/^[-\w]{1,100}$/.test(ref.asset_id)||!['image','video','audio'].includes(ref.kind)||!['reference','first_frame','last_frame'].includes(ref.role)||(ref.kind!=='image'&&ref.role!=='reference')||(ref.framing!==undefined&&!['fit','fill'].includes(ref.framing))||(ref.include_audio!==undefined&&typeof ref.include_audio!=='boolean'))throw new Error('Invalid reference settings.');ids.add(ref.id);
    if(ref.kind!=='image'){const r=ref.range;if(!r||Object.keys(r).some(k=>!['start_seconds','duration_seconds'].includes(k))||!Number.isFinite(r.start_seconds)||r.start_seconds<0||!Number.isFinite(r.duration_seconds)||r.duration_seconds<2||r.duration_seconds>15)throw new Error('Choose a 2–15 second clip range.');}}
  for(const kind of ['image','video','audio'])if(references.filter(r=>r.kind===kind).length>(kind==='image'?9:3))throw new Error('Too many references of this type.');
  for(const role of ['first_frame','last_frame'])if(references.filter(r=>r.role===role).length>1)throw new Error('Choose only one '+role.replace('_',' ')+'.');
  for(const kind of ['video','audio'])if(references.filter(r=>r.kind===kind).reduce((n,r)=>n+r.range.duration_seconds,0)>15)throw new Error('Choose at most 15 seconds of '+kind+'.');
  if(references.filter(r=>r.kind==='audio'||(r.kind==='video'&&r.include_audio)).reduce((n,r)=>n+r.range.duration_seconds,0)>15)throw new Error('Choose at most 15 seconds of audio including video soundtracks.');
  const general=references.some(r=>r.role==='reference');
  const labels:Record<string,number>={Picture:references.filter(r=>r.kind==='image'&&r.role===(general?'reference':'first_frame')).length,Video:references.filter(r=>r.kind==='video').length,Audio:references.filter(r=>r.kind==='audio'||(r.kind==='video'&&r.include_audio)).length};
  if(value.prompt.includes('[removed reference]')||[...value.prompt.matchAll(/<(Picture|Video|Audio)\s+(\d+)>/g)].some((match:any)=>Number(match[2])<1||Number(match[2])>labels[match[1]]!))throw new Error('Update the reference mentions in your prompt.');
  const audio=value.audio??{output:'generated'};if(Object.keys(audio).some(k=>k!=='output')||!['generated','silent'].includes(audio.output))throw new Error('Choose generated audio or silent output.');
  return {...value,seed,count,references,audio};
}
export function videoRoute(request:ImageRequest){return request.references?.some(r=>r.role==='reference')?'ref':'fl';}
export function videoGraph(request:ImageRequest,id:string,seed:string,preset:Preset|null,refs:PreparedReference[]=[]){
  const route=videoRoute(request);const seconds=request.output.duration_seconds!;const [width,height]=request.output.aspect==='16:9'?[1344,768]:[768,1344];
  const graph:Record<string,{class_type:string;inputs:Record<string,any>}>= {
    '1':{class_type:'UNETLoader',inputs:{unet_name:`minimax_h3_${route}2va_pruned_int8_convrot.safetensors`,weight_dtype:'default'}},
    '2':{class_type:'CLIPLoader',inputs:{clip_name:'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',type:'minimax',device:'default'}},
    '3':{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_video_vae_fp16.safetensors'}},
    '4':{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}},
    '5':{class_type:'LoraLoaderModelOnly',inputs:{model:['1',0],lora_name:`minimax_h3_${route}2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`,strength_model:0.8}},
    '6':{class_type:route==='ref'?'MiniMaxH3ReferenceToVideo':'MiniMaxH3ImageToVideo',inputs:{clip:['2',0],vae:['3',0],prompt:request.prompt,width,height,length:17*Math.ceil((seconds*24-5)/17)+5,...(route==='ref'?{audio_vae:['4',0],ref_image_size:'match'}:{})}},
    '7':{class_type:'BasicGuider',inputs:{model:[preset?'18':'5',0],conditioning:['6',0]}},
    '8':{class_type:'RandomNoise',inputs:{noise_seed:Number(seed)}},
    '9':{class_type:'KSamplerSelect',inputs:{sampler_name:'euler'}},
    '10':{class_type:'BasicScheduler',inputs:{model:[preset?'18':'5',0],scheduler:'simple',steps:8,denoise:1}},
    '11':{class_type:'SamplerCustomAdvanced',inputs:{noise:['8',0],guider:['7',0],sampler:['9',0],sigmas:['10',0],latent_image:['6',1]}},
    '12':{class_type:'VAEDecode',inputs:{samples:['11',0],vae:['3',0]}},
    '13':{class_type:'VAEDecodeAudio',inputs:{samples:['11',0],vae:['4',0]}},
    '14':{class_type:'SeedVideoSave',inputs:{images:['12',0],audio:['13',0],seconds,filename_prefix:'seed/'+id+'/video',audio_mode:request.audio?.output??'generated'}},
  };
  if(request.output.format==='images'){
    delete graph['13'];
    graph['15']={class_type:'ImageFromBatch',inputs:{image:['12',0],batch_index:0,length:seconds*24}};
    graph['14']={class_type:'SaveImage',inputs:{images:['15',0],filename_prefix:'seed/'+id+'/frames'}};
  }
  if(preset)graph['18']={class_type:'LoraLoaderModelOnly',inputs:{model:['5',0],lora_name:preset.filename,strength_model:preset.strength_model}};
  let node=20,image=0,video=0,audio=0;let positive:any=['6',0];
  for(const ref of refs){const key=String(node++),filename='seed/'+id+'/'+ref.filename;
    graph[key]={class_type:ref.kind==='image'?'LoadImage':ref.kind==='audio'?'LoadAudio':'SeedLoadVideo',inputs:{[ref.kind==='image'?'image':ref.kind==='audio'?'audio':'filename']:filename}};
    if(ref.role==='first_frame'||ref.role==='last_frame'){
      if(route==='fl'&&ref.role==='first_frame'){graph['6']!.inputs.first_frame=[key,0];continue;}
      const guide=String(node++);graph[guide]={class_type:'MiniMaxH3AddGuide',inputs:{positive,latent:['6',1],vae:['3',0],image:[key,0],frame_idx:ref.role==='first_frame'?0:seconds*24-1}};positive=[guide,0];
    }else if(ref.kind==='image')graph['6']!.inputs['ref_images.ref_image_'+image++]=[key,0];
    else if(ref.kind==='video'){
      graph['6']!.inputs['ref_videos.ref_video_'+video]=[key,0];
      if(ref.audio_filename){const a=String(node++);graph[a]={class_type:'LoadAudio',inputs:{audio:'seed/'+id+'/'+ref.audio_filename}};graph['6']!.inputs['ref_video_audios.ref_video_audio_'+video]=[a,0];}video++;
    }else graph['6']!.inputs['ref_audios.ref_audio_'+audio++]=[key,0];
  }
  graph['7']!.inputs.conditioning=positive;return graph;
}
