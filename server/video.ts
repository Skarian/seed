import type { ImageRequest } from './workflows.js';
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
  unknown(value,['workflow','prompt','mode','output','seed','count','references','audio'],'');
  if(!['text-to-video','reference-to-video'].includes(value.workflow))add('workflow','Choose text-to-video or reference-to-video.');
  if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>12000)add('prompt','Provide 1–12000 characters of prompt text.');
  if(!['sfw','nsfw'].includes(value.mode))add('mode','Check the request settings.');
  if(!object(value.output))add('output','Provide aspect, size, and duration_seconds.');
  else {
    unknown(value.output,['aspect','size','duration_seconds','format'],'output');
    if(!['16:9','9:16'].includes(value.output.aspect))add('output.aspect','Choose 16:9 or 9:16.');
    if(value.output.size!=='768p')add('output.size','H3 uses 768p output.');
    if(!Number.isInteger(value.output.duration_seconds)||value.output.duration_seconds<5||value.output.duration_seconds>15)add('output.duration_seconds','Use a whole number from 5 to 15.','This is the generated video length, not an input clip length.');
    if(value.output.format!==undefined&&value.output.format!=='video')add('output.format','Videos are saved as videos. Use Pick Frame in the preview to save an image.');
  }
  const count=value.count??1,seed=value.seed??'random';
  if(!Number.isInteger(count)||count<1||count>16)add('count','Use a whole number from 1 to 16.');
  if(typeof seed!=='string'||(seed!=='random'&&(!/^(0|[1-9][0-9]{0,15})$/.test(seed)||BigInt(seed)+BigInt(Number.isInteger(count)&&count>0?count-1:0)>9007199254740991n)))add('seed','Use random or a nonnegative integer written as a string.','The starting seed plus quantity minus one must not exceed 9007199254740991.');
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
    const soundtracks=valid.filter((r:any)=>r.kind==='video'&&r.include_audio).length;
    if(valid.length+soundtracks>12||valid.filter((r:any)=>r.kind==='audio').length+soundtracks>3)add('references','Choose at most 12 files and 3 audio clips, including video soundtracks.');
    const labels:Record<string,number>={Picture:valid.filter((r:any)=>r.kind==='image'&&r.role===(general?'reference':'first_frame')).length,Video:valid.filter((r:any)=>r.kind==='video').length,Audio:valid.filter((r:any)=>r.kind==='audio'||(r.kind==='video'&&r.include_audio===true)).length};
    if(typeof value.prompt==='string'&&(value.prompt.includes('[removed reference]')||[...value.prompt.matchAll(/<(Picture|Video|Audio)\s+(\d+)>/g)].some((m:any)=>Number(m[2])<1||Number(m[2])>labels[m[1]]!)))add('prompt','A reference mention does not match these inputs.','Use only labels from the current input mapping.');
  }
  const audio=value.audio??{output:'generated'};
  if(!object(audio))add('audio','Provide output: generated or silent.');else {unknown(audio,['output'],'audio');if(!['generated','silent'].includes(audio.output))add('audio.output','Choose generated or silent.');}
  if(issues.length)throw new VideoRequestError(issues);
  return {...value,seed,count,references,audio};
}
export function videoRoute(request:ImageRequest){return request.references?.some(r=>r.role==='reference')?'ref':'fl';}