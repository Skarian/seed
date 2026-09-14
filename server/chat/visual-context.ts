import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import type {ImageContent} from '@earendil-works/pi-ai';
const exec=promisify(execFile);
const ffmpeg=createRequire(import.meta.url)('ffmpeg-static') as string|null;
const maxImages=12;
type Asset={id:string;kind:string;relative_path:string;metadata?:{duration?:number}};
export type VisualRange={start_seconds:number;duration_seconds:number;input_id?:string};
type Evidence={asset_id:string;input_id?:string;timestamp_seconds?:number;type:'image'|'sampled_video_frame'};
type UnavailableInput={asset_id:string;input_id?:string;reason:'visual_budget'|'invalid_range'|'unreadable'};
type Sample={asset:Asset;file:string;input_id?:string;times?:number[];failed?:boolean};

/** Sample one frame per input before spending the remaining budget on extra frames. */
export async function visualContext(data:string,assets:Asset[],ranges:Map<string,VisualRange|VisualRange[]>=new Map()){
 const images:ImageContent[]=[],evidence:Evidence[]=[],unavailableInputs:UnavailableInput[]=[],samples:Sample[]=[];
 const unavailable=(sample:{asset:Asset;input_id?:string},reason:UnavailableInput['reason'])=>{
  if(!unavailableInputs.some(value=>value.asset_id===sample.asset.id&&value.input_id===sample.input_id))unavailableInputs.push({asset_id:sample.asset.id,...(sample.input_id?{input_id:sample.input_id}:{}),reason});
 };
 for(const asset of assets){
  if(!['image','video'].includes(asset.kind))continue;
  const file=path.resolve(data,asset.relative_path);
  if(!file.startsWith(path.resolve(data)+path.sep)){unavailable({asset},'unreadable');continue;}
  if(asset.kind==='image'){samples.push({asset,file});continue;}
  const selected=ranges.get(asset.id);
  // A new source has no chosen clip yet: sample across its full known duration.
  // These remain sparse frames, not evidence that the whole video was watched.
  const clips=selected?(Array.isArray(selected)?selected:[selected]):[{start_seconds:0,duration_seconds:asset.metadata?.duration??3}];
  const seen=new Set<string>();
  for(const range of clips){
   const key=JSON.stringify([range.input_id,range.start_seconds,range.duration_seconds]);if(seen.has(key))continue;seen.add(key);
   const start=range.start_seconds,duration=range.duration_seconds;
   if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0||(asset.metadata?.duration!==undefined&&start+duration>asset.metadata.duration+0.001)){
    unavailable({asset,input_id:range.input_id},'invalid_range');continue;
   }
   samples.push({asset,file,input_id:range.input_id,times:[start,start+duration/2,start+Math.max(0,duration-.15)]});
  }
 }
 for(let pass=0;pass<3;pass++)for(const sample of samples){
  if(sample.failed||(!sample.times&&pass>0))continue;
  if(images.length>=maxImages){if(pass===0)unavailable(sample,'visual_budget');continue;}
  try{
   let bytes:Buffer;
   if(!sample.times)bytes=await sharp(sample.file).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
   else {
    if(!ffmpeg)throw Error('Video sampling unavailable');
    const result=await exec(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-ss',String(sample.times[pass]),'-i',sample.file,'-frames:v','1','-vf','scale=768:768:force_original_aspect_ratio=decrease','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{encoding:'buffer',maxBuffer:3*1024*1024,timeout:20000,windowsHide:true});
    bytes=result.stdout;if(!bytes.length)throw Error('No frame');
   }
   images.push({type:'image',mimeType:'image/jpeg',data:bytes.toString('base64')});
   evidence.push({asset_id:sample.asset.id,...(sample.input_id?{input_id:sample.input_id}:{}),...(sample.times?{timestamp_seconds:sample.times[pass],type:'sampled_video_frame' as const}:{type:'image' as const})});
  }catch{sample.failed=true;unavailable(sample,'unreadable');}
 }
 return {images,evidence,unavailable:[...new Set(unavailableInputs.map(value=>value.asset_id))],unavailable_inputs:unavailableInputs};
}
