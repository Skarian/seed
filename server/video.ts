import type { ImageRequest, Preset } from './workflows.js';
import type { PreparedReference } from './media.js';
export const VIDEO_PROFILE_REVISION = 'h3-quality-v1';
export const HIGH_VIDEO_PROFILE = 'h3-high-v1';
export interface RequestIssue {field:string;message:string;fix?:string}
export class VideoRequestError extends Error {
  constructor(public issues:RequestIssue[]){super(issues.map(i=>`${i.field}: ${i.message}${i.fix?' '+i.fix:''}`).join('\n'));this.name='VideoRequestError';}
}
export function videoRequest(value:any):ImageRequest {
  const issues:RequestIssue[]=[];
  const add=(field:string,message:string,fix?:string)=>issues.push({field,message,...(fix?{fix}:{})});
  const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  if(!object(value))throw new VideoRequestError([{field:'request',message:'Provide a request object.'}]);
  const unknown=(v:any,allowed:string[],field:string)=>{for(const k of Object.keys(v))if(!allowed.includes(k))add(field?`${field}.${k}`:k,'Unknown setting.','Remove this field.');};
  unknown(value,['workflow','capabilities_revision','prompt','mode','quality','output','seed','count','references','audio'],'');
  if(!['text-to-video','reference-to-video'].includes(value.workflow))add('workflow','Choose text-to-video or reference-to-video.');
  if(typeof value.capabilities_revision!=='string')add('capabilities_revision','Provide the capability revision.');
  if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>12000)add('prompt','Provide 1–12000 characters of prompt text.');
  if(!['sfw','nsfw'].includes(value.mode))add('mode','Choose sfw or nsfw.');
  if(value.quality!==undefined&&!['fast','high'].includes(value.quality))add('quality','Choose fast or high.');
  if(!object(value.output))add('output','Provide aspect, size, and duration_seconds.');
  else {
    unknown(value.output,['aspect','size','duration_seconds','format'],'output');
    if(!['16:9','9:16'].includes(value.output.aspect))add('output.aspect','Choose 16:9 or 9:16.');
    if(!['720p','native'].includes(value.output.size))add('output.size','Choose 720p or native.');
    if(!Number.isInteger(value.output.duration_seconds)||value.output.duration_seconds<5||value.output.duration_seconds>15)add('output.duration_seconds','Use a whole number from 5 to 15.','This is the generated video length, not an input clip length.');
    if(value.output.format!==undefined&&!['video','images'].includes(value.output.format))add('output.format','Choose video or images.');
    if(value.quality==='high'&&value.output.size!=='native')add('output.size','High Quality requires native output.','Set size to native, or use fast quality if 720p is required.');
  }
  const count=value.count??1,seed=value.seed??'random';
  if(!Number.isInteger(count)||count<1||count>16)add('count','Use a whole number from 1 to 16.');
  if(typeof seed!=='string'||(seed!=='random'&&(!/^(0|[1-9][0-9]{0,15})$/.test(seed)||BigInt(seed)+BigInt(Number.isInteger(count)&&count>0?count-1:0)>9007199254740991n)))add('seed','Use random or a nonnegative integer written as a string.','The starting seed plus batch size minus one must not exceed 9007199254740991.');
  const references=value.references??[];
  if(!Array.isArray(references))add('references','Provide an array of inputs.');
  else {
    if(references.length>12)add('references','Choose at most 12 inputs.');
    if(value.workflow==='reference-to-video'&&!references.length)add('references','Ref to video needs at least one input.');
    if(value.workflow==='text-to-video'&&references.length)add('references','Text to video does not accept inputs.','Use the reference-to-video workflow for images, video, or audio.');
    const ids=new Set<string>();
    references.forEach((ref:any,index:number)=>{
      const field=`references[${index}]`;
      if(!object(ref)){add(field,'Provide an input object.');return;}
      unknown(ref,['id','asset_id','kind','role','range','include_audio','framing'],field);
      if(typeof ref.id!=='string'||!/^[-\w]{1,100}$/.test(ref.id))add(field+'.id','Use an input identifier without spaces.','Do not use a prompt label such as Picture 1.');
      else if(ids.has(ref.id))add(field+'.id','This input identifier is already used.','Each input instance needs a distinct identifier.');else ids.add(ref.id);
      if(typeof ref.asset_id!=='string'||!/^[-\w]{1,100}$/.test(ref.asset_id))add(field+'.asset_id','Use an asset identifier from the supplied inputs.');
      if(!['image','video','audio'].includes(ref.kind))add(field+'.kind','Choose image, video, or audio.');
      if(!['reference','first_frame','last_frame'].includes(ref.role))add(field+'.role','Choose reference, first_frame, or last_frame.');
      else if(['video','audio'].includes(ref.kind)&&ref.role!=='reference')add(field+'.role',`${ref.kind==='video'?'Video':'Audio'} inputs cannot be ${ref.role.replace('_',' ')} guides.`,'Use role reference. Only images can be first_frame or last_frame.');
      if(ref.framing!==undefined&&!['fit','fill'].includes(ref.framing))add(field+'.framing','Choose fit or fill.');
      if(ref.include_audio!==undefined&&typeof ref.include_audio!=='boolean')add(field+'.include_audio','Use true or false.');
      if(['video','audio'].includes(ref.kind)){
        if(!object(ref.range))add(field+'.range','Provide start_seconds and duration_seconds for this input clip.','Use 2–15 seconds, within the source duration.');
        else {unknown(ref.range,['start_seconds','duration_seconds'],field+'.range');
          if(!Number.isFinite(ref.range.start_seconds)||ref.range.start_seconds<0)add(field+'.range.start_seconds','Use a number greater than or equal to 0.');
          if(!Number.isFinite(ref.range.duration_seconds)||ref.range.duration_seconds<2||ref.range.duration_seconds>15)add(field+'.range.duration_seconds','Choose a 2–15 second clip range.','Use a number, not a quoted string.');}
      }
    });
    const valid=references.filter(object);
    for(const kind of ['image','video','audio'])if(valid.filter((r:any)=>r.kind===kind).length>(kind==='image'?9:3))add('references',`Choose at most ${kind==='image'?9:3} ${kind} inputs.`);
    for(const role of ['first_frame','last_frame'])if(valid.filter((r:any)=>r.role===role).length>1)add('references',`Choose only one ${role.replace('_',' ')} image.`);
    const duration=(r:any)=>Number.isFinite(r.range?.duration_seconds)&&r.range.duration_seconds>=2?r.range.duration_seconds:0;
    for(const kind of ['video','audio'])if(valid.filter((r:any)=>r.kind===kind).reduce((n:number,r:any)=>n+duration(r),0)>15)add('references',`Choose at most 15 seconds of ${kind} across all input clips.`);
    if(valid.filter((r:any)=>r.kind==='audio'||(r.kind==='video'&&r.include_audio===true)).reduce((n:number,r:any)=>n+duration(r),0)>15)add('references','Choose at most 15 seconds of audio including video soundtracks.','Shorten input clips or turn off unneeded video soundtracks.');
    const general=valid.some((r:any)=>r.role==='reference');
    const labels:Record<string,number>={Picture:valid.filter((r:any)=>r.kind==='image'&&r.role===(general?'reference':'first_frame')).length,Video:valid.filter((r:any)=>r.kind==='video').length,Audio:valid.filter((r:any)=>r.kind==='audio'||(r.kind==='video'&&r.include_audio===true)).length};
    if(typeof value.prompt==='string'&&(value.prompt.includes('[removed reference]')||[...value.prompt.matchAll(/<(Picture|Video|Audio)\s+(\d+)>/g)].some((m:any)=>Number(m[2])<1||Number(m[2])>labels[m[1]]!)))add('prompt','A reference mention does not match these inputs.','Use only labels from the current input mapping.');
  }
  const audio=value.audio??{output:'generated'};
  if(!object(audio))add('audio','Provide output: generated or silent.');else {unknown(audio,['output'],'audio');if(!['generated','silent'].includes(audio.output))add('audio.output','Choose generated or silent.');}
  if(issues.length)throw new VideoRequestError(issues);
  return {...value,seed,count,references,audio};
}
export function videoRoute(request:ImageRequest){return request.references?.some(r=>r.role==='reference')?'ref':'fl';}
export function videoGraph(request:ImageRequest,id:string,seed:string,preset:Preset|null,refs:PreparedReference[]=[]){
  const high=request.quality==='high';
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
    '14':{class_type:'SeedVideoSave',inputs:{images:['12',0],audio:['13',0],seconds,filename_prefix:'seed/'+id+'/video',audio_mode:request.audio?.output??'generated',...(request.output.size==='native'?{export_version:'native-v1'}:{})}},
  };
  if(request.output.format==='images'){
    delete graph['13'];
    graph['15']={class_type:'ImageFromBatch',inputs:{image:['12',0],batch_index:0,length:seconds*24}};
    graph['14']={class_type:'SaveImage',inputs:{images:['15',0],filename_prefix:'seed/'+id+'/frames'}};
  }
  if(preset)graph['18']={class_type:'LoraLoaderModelOnly',inputs:{model:[high?'16':'5',0],lora_name:preset.filename,strength_model:high?0.8:preset.strength_model}};
  if(high){
    delete graph['5'];
    graph['16']={class_type:'MiniMaxH3SigmaShift',inputs:{model:['1',0],shift_video:12,shift_audio:3}};
    graph['17']={class_type:'ModelAttentionBackend',inputs:{model:[preset?'18':'16',0],attention:'comfy kitchen attention'}};
    // v0.35.0 DynamicCombo inputs use the flat API form, not its normalized Python dictionary.
    graph['19']={class_type:'BlockSparseAttention',inputs:{model:['17',0],selection:'sol-attn','selection.tau':1.3,start_percent:0.2,end_percent:1,dense_blocks:'',min_tokens:12288,extra_tokens:256,sink_conditioning:'exact_kv_and_rows',verbose:true}};
    graph['7']!.inputs.model=['19',0];
    graph['9']!.inputs.sampler_name='res_multistep';
    graph['10']!.inputs.model=['19',0];
    graph['10']!.inputs.steps=30;
  }
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
