import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,open,rename,stat,statfs,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {ModelSource} from './pool-contracts.js';
import type {StudioPaths} from './storage.js';
import type {WorkerConnection} from './worker.js';
import {PoolError} from './pool-errors.js';

const writers=new Map<string,Promise<void>>();
function fault(message:string,code='model_transfer_failed',retryable=true){
  const action=code==='model_access_denied'?'Update credentials':code==='local_storage_full'?'Free local storage':retryable?'Retry transfer':'Check worker release';
  return new PoolError({code,message,retryable,action});
}

/** Base weights only. Neither adapters nor mutable model URLs enter the PC relay. */
export function validateBaseModel(item:ModelSource){
  const url=new URL(item.url),[owner,repository,resolve,revision,...files]=url.pathname.slice(1).split('/');
  if(item.routes!==undefined||!/^(diffusion_models|text_encoders|vae)\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(item.path)||
      !/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<1||item.size>100*1024**3||
      url.origin!=='https://huggingface.co'||url.username||url.password||url.search||url.hash||resolve!=='resolve'||
      !/^[a-f0-9]{40}$/.test(revision??'')||![owner,repository].every(x=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(x??''))||
      !files.length||files.some(x=>!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(x)||x==='.'||x==='..'))
    throw fault('Only pinned Hugging Face base models can be transferred through this PC.','invalid_base_model',false);
}

async function length(file:string){try{return (await stat(file)).size;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 0;throw error;}}
async function matches(file:string,item:ModelSource,signal?:AbortSignal){
  if(await length(file)!==item.size)return false;
  const hash=createHash('sha256');for await(const chunk of createReadStream(file,{signal}))hash.update(chunk);
  return hash.digest('hex')===item.sha256;
}
async function reset(file:string){const handle=await open(file,'w',0o600);await handle.close();}
function waitFor(task:Promise<void>,signal?:AbortSignal){
  if(!signal)return task;
  signal.throwIfAborted();
  return new Promise<void>((resolve,reject)=>{
    const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});
    task.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
  });
}

async function acquire(item:ModelSource,directory:string,token:string,signal?:AbortSignal){
  const target=path.join(directory,item.sha256+'.safetensors'),partial=target+'.part';
  await mkdir(directory,{recursive:true,mode:0o700});
  if(await matches(target,item,signal))return target;
  if(await length(target)>0)await unlink(target);
  let offset=await length(partial);
  if(offset>item.size){await reset(partial);offset=0;}
  if(offset===item.size){
    if(await matches(partial,item,signal)){await rename(partial,target);return target;}
    await reset(partial);offset=0;
  }
  const disk=await statfs(directory,{bigint:true});
  if(disk.bavail*disk.bsize<BigInt(item.size-offset)+128n*1024n*1024n)
    throw fault('There is not enough free disk space on this PC to cache the model.','local_storage_full',false);
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let timer:ReturnType<typeof setTimeout>;
  const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(fault('The model download stopped making progress.')),30000);timer.unref?.();};
  try{
    let url=item.url,response:Response|undefined;
    for(let redirect=0;redirect<6;redirect++){
      combined.throwIfAborted();touch();
      const host=new URL(url);
      if(host.protocol!=='https:'||host.username||host.password||host.port||host.hash||
          !(host.hostname==='huggingface.co'||host.hostname.endsWith('.huggingface.co')||host.hostname.endsWith('.hf.co')))
        throw fault('The model source returned an unsupported download address.','invalid_model_redirect',false);
      response=await fetch(url,{redirect:'manual',signal:combined,headers:{...(offset?{Range:`bytes=${offset}-`}:{}),...(token&&host.origin==='https://huggingface.co'?{Authorization:'Bearer '+token}:{})}});
      touch();
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('Location');await response.body?.cancel();response=undefined;
      if(!location)throw fault('The model source returned an incomplete download address.');
      url=new URL(location,url).href;
    }
    if(!response)throw fault('The model source redirected too many times.');
    if(![200,206].includes(response.status)||!response.body){
      await response.body?.cancel();
      const auth=[401,403].includes(response.status);
      throw fault(auth?'Hugging Face rejected the model download. Check its access and your Admin credential.':`Model download failed (HTTP ${response.status}).`,auth?'model_access_denied':'model_source_unavailable',!auth);
    }
    if(response.status===200)offset=0;
    if(response.status===206&&response.headers.get('Content-Range')!==`bytes ${offset}-${item.size-1}/${item.size}`){await response.body.cancel();throw fault('The model source returned an invalid resume range.','model_integrity_failed',false);}
    const announced=response.headers.get('Content-Length');
    if(announced!==null&&Number(announced)!==item.size-offset){await response.body.cancel();throw fault('The model source returned an unexpected file size.','model_integrity_failed',false);}
    const file=await open(partial,offset?'a':'w',0o600);
    try{
      for await(const chunk of response.body){touch();offset+=chunk.length;if(offset>item.size)throw fault('The downloaded model exceeded its pinned size.','model_integrity_failed',false);await file.writeFile(chunk);}
      await file.sync();
    }finally{await file.close();}
    clearTimeout(timer!);
    if(offset<item.size)throw fault('The model download ended early. Retry to resume it.');
    if(!await matches(partial,item,signal)){await reset(partial);throw fault('The model checksum did not match. Retry to download a fresh copy.','model_integrity_failed');}
    signal?.throwIfAborted();await rename(partial,target);return target;
  }catch(error){
    if(signal?.aborted)throw signal.reason;
    if(error instanceof PoolError)throw error;
    if(controller.signal.aborted)throw controller.signal.reason;
    const code=(error as NodeJS.ErrnoException).code;
    throw fault(['ENOSPC','EDQUOT'].includes(code??'')?'Local storage filled during the model download.':'The model download was interrupted. Retry to resume it.',code==='ENOSPC'?'local_storage_full':'model_transfer_failed');
  }finally{clearTimeout(timer!);controller.abort();}
}

/** One requested recovery attempt. The pool owns retries and worker lifecycle. */
export async function downloadAndRelayBaseModel(item:ModelSource,paths:StudioPaths,connection:Pick<WorkerConnection,'uploadModel'>,token:string,signal?:AbortSignal){
  validateBaseModel(item);signal?.throwIfAborted();
  const directory=path.join(paths.cache,'models'),key=path.join(directory,item.sha256);
  const previous=writers.get(key)??Promise.resolve();
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  const tail=previous.catch(()=>{}).then(()=>held);writers.set(key,tail);
  let file:string;
  try{await waitFor(previous.catch(()=>{}),signal);signal?.throwIfAborted();file=await acquire(item,directory,token,signal);}
  finally{release();if(writers.get(key)===tail)void tail.then(()=>{if(writers.get(key)===tail)writers.delete(key);});}
  signal?.throwIfAborted();await connection.uploadModel(item,file!,signal);
}
