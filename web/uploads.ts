import { Upload } from 'tus-js-client';
import type { Reference } from './references.js';
const completed=new Map<string,string>();
export async function uploadReferences(references:Reference[],mode:string,progress:(message:string)=>void){
  const result=[];
  for(const ref of references){
    const cacheKey=mode+':'+ref.id;
    let id=ref.asset_id ?? completed.get(cacheKey);
    if(!id){
      progress('Uploading '+ref.name+'…');
      id=await new Promise<string>((resolve,reject)=>{
        const upload=new Upload(ref.file!,{endpoint:'/api/v1/uploads',fingerprint:async()=>JSON.stringify(['seed',mode,ref.file!.name,ref.file!.size,ref.file!.lastModified,ref.type]),chunkSize:8*1024*1024,retryDelays:[0,1000,3000,5000],removeFingerprintOnSuccess:true,metadata:{filename:ref.name,filetype:ref.type,kind:ref.kind,mode},onProgress:(sent,total)=>progress(`Uploading ${ref.name} · ${Math.round(sent/total*100)}%`),onError:reject,onSuccess:()=>resolve(upload.url!.split('/').pop()!)});
        upload.findPreviousUploads().then(previous=>{if(previous[0])upload.resumeFromPreviousUpload(previous[0]);upload.start();}).catch(reject);
      });
      progress('Checking '+ref.name+'…');
      for(let i=0;;i++){
        const response=await fetch('/api/v1/assets/'+id);if(!response.ok)throw Error('Could not check uploaded file.');const asset=await response.json();
        if(asset.state==='ready')break;if(asset.state==='error')throw Error(asset.error);if(i>180)throw Error('File verification is taking longer than expected. Try again shortly.');await new Promise(r=>setTimeout(r,1000));
      }
      completed.set(cacheKey,id);
    }
    result.push({id:ref.id,asset_id:id,kind:ref.kind,role:ref.role,...(ref.kind==='image'?{framing:ref.framing??'fit'}:{range:{start_seconds:ref.start,duration_seconds:ref.end-ref.start},...(ref.kind==='video'?{include_audio:Boolean(ref.include_audio)}:{})})});
  }
  return result;
}
