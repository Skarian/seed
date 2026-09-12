import {open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Upload} from 'tus-js-client';
import {PreparationFault,responseFault} from './preparation-request.mjs';

// One tus attempt only. Its caller reconciles preparation and reopens the file
// after a failure; tus HEAD supplies the authoritative persisted offset.
export async function uploadModel(connection,endpoint,file,size,{signal,idleMs=30000,onProgress=()=>{},UploadClass=Upload}={}) {
  signal?.throwIfAborted();
  try{const handle=await open(file,'r');await handle.close();}catch{throw new PreparationFault('Cannot read the local model file.');}
  // Keep the path so tus selects its seekable FileSource, not StreamSource.
  const input=createReadStream(file);
  let upload,timer,settled=false,stopping;
  try {
    await new Promise((resolve,reject)=>{
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
      const stop=error=>{
        if(settled||stopping)return;
        clearTimeout(timer);
        stopping=Promise.resolve(upload?.abort(false)).then(()=>finish(error),()=>finish(error));
      };
      const cancel=()=>stop(signal.reason??new DOMException('Preparation cancelled','AbortError'));
      const progress=()=>{clearTimeout(timer);timer=setTimeout(()=>stop(new PreparationFault('Model upload stopped making progress.',true)),idleMs);};
      input.on('error',()=>stop(new PreparationFault('Cannot read the local model file.')));
      upload=new UploadClass(input,{
        uploadUrl:connection.endpoint+endpoint,uploadSize:size,chunkSize:8*1024*1024,retryDelays:null,
        headers:{Authorization:'Bearer '+connection.worker_credential},
        onProgress:(sent,total)=>{progress();onProgress({sent,total});},
        onAfterResponse:(_request,response)=>{progress();const offset=response.getHeader('Upload-Offset');if(offset!==null)onProgress({offset:Number(offset)});},
        onSuccess:()=>finish(),
        onError:error=>{
          if(['ENOENT','EACCES','EPERM','EIO','ENOSPC'].includes(error.originalError?.code)){
            finish(new PreparationFault('Cannot read the local model file.'));return;
          }
          const status=error.originalResponse?.getStatus?.();
          // 409 means a stale offset; a fresh HEAD must settle it before retry.
          finish(status?status===409?new PreparationFault('Model upload offset changed; reconciling.',true):responseFault(status):new PreparationFault('Model upload connection interrupted.',true));
        },
      });
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted){cancel();return;}
      progress();try{upload.start();}catch{stop(new PreparationFault('Cannot start the model upload.'));}
    });
  }finally{clearTimeout(timer);await stopping;input.destroy();}
}
