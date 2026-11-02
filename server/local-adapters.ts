import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import type {LoraSourceManifest} from '../shared/loras.js';
import type {StudioPaths} from './storage.js';
import {credential} from './credential-store.js';

export type AdapterInventory = Array<{filename:string;sha256:string;routes:string[]}>;
export type AdapterProgress = {phase:string;bytes_done:number;bytes_total:number};
type Options = {python:string;workspace:string;packageRoot:string;paths:StudioPaths;sources:LoraSourceManifest[];
  signal?:AbortSignal;onProgress?:(progress:AdapterProgress)=>void};
type Spawn = (python:string,args:string[],options:Parameters<typeof spawn>[2])=>ChildProcessWithoutNullStreams;

/** CPU-only transfer process. It uses the cloud worker's pinned, resumable downloader. */
export async function prepareLocalAdapters(options:Options, spawnProcess:Spawn=spawn as Spawn):Promise<AdapterInventory> {
  const {sources,signal}=options;
  if(!sources.length)return [];
  signal?.throwIfAborted();
  const entries=new Map<string,{path:string;url:string;sha256:string;size:number;routes:string[]}>();
  for(const source of sources){
    if(!/^[a-f0-9]{64}$/.test(source.sha256)||source.revision!==source.sha256||!['image','fl','ref'].includes(source.route)||
      source.path!==`loras/seed-${source.sha256}.safetensors`||!Number.isSafeInteger(source.size_bytes)||source.size_bytes<=0||source.size_bytes>8*1024**3)
      throw Error('This LoRA needs a valid pinned source. Update it in Admin.');
    const url=new URL(source.url);
    if(url.protocol!=='https:'||url.host!=='civitai.com'||url.username||url.password||url.hash||
      !/^\/api\/download\/models\/\d+$/.test(url.pathname)||[...url.searchParams.keys()].join(',')!=='fileId'||!/^\d+$/.test(url.searchParams.get('fileId')??''))
      throw Error('This LoRA needs an exact Civitai file source. Update it in Admin.');
    const prior=entries.get(source.path);
    if(prior&&(prior.url!==source.url||prior.size!==source.size_bytes))throw Error('Conflicting LoRA file sources. Update them in Admin.');
    entries.set(source.path,{path:source.path,url:source.url,sha256:source.sha256,size:source.size_bytes,routes:[...new Set([...(prior?.routes??[]),source.route])]});
  }
  await mkdir(options.workspace,{recursive:true});
  const token=credential(options.paths,'civitaiKey');
  signal?.throwIfAborted();
  const files=new Map<string,any>();
  const total=[...entries.values()].reduce((sum,item)=>sum+item.size,0);
  const report=(phase:string)=>options.onProgress?.({phase,bytes_total:total,bytes_done:[...entries.values()].reduce((sum,item)=>{
    const state=files.get(item.path);return sum+(state?.ready?item.size:Math.max(0,Math.min(item.size,Number(state?.bytes_done)||0)));
  },0)});
  report('Checking selected LoRAs');
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)&&!key.startsWith('T3_')));
  const child=spawnProcess(options.python,['-m','worker.download_process'],{cwd:options.packageRoot,windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:{...environment,PYTHONPATH:options.packageRoot,PYTHONUNBUFFERED:'1'}});
  return await new Promise<AdapterInventory>((resolve,reject)=>{
    let buffer='',inventory:AdapterInventory|undefined,failure:string|undefined,aborted=false;
    const abort=()=>{aborted=true;child.kill();};
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    child.stdin.on('error',()=>{});
    child.stderr.resume(); // Never forward provider URLs or credentials into UI/logs.
    child.on('error',()=>{signal?.removeEventListener('abort',abort);reject(Error('The local LoRA downloader could not start. Check local setup.'));});
    child.stdout.on('data',(chunk:Buffer)=>{
      buffer+=chunk.toString();
      if(buffer.length>1024*1024){failure='Invalid response from the local LoRA downloader.';child.kill();return;}
      let end:number;
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try{
          const value=JSON.parse(line);
          if(value.path&&entries.has(value.path)){
            files.set(value.path,value);
            const source=sources.find(item=>item.path===value.path)!;
            report(`${value.state==='downloading'?'Downloading':value.state==='ready'?'Ready:':'Checking'} ${source.name}`);
            if(value.state==='needs_source')failure=`Could not download or verify ${source.name}${value.http_status?` (HTTP ${value.http_status})`:''}. Check the Civitai key and source in Admin, then retry the download.`;
          }
          if(value.error&&!value.path)failure='The local LoRA download stopped. Check credentials, source access and disk space, then retry the download.';
          if(value.complete===true&&Array.isArray(value.installed_loras))inventory=value.installed_loras;
        }catch{failure='Invalid response from the local LoRA downloader.';child.kill();}
      }
    });
    child.on('close',code=>{
      signal?.removeEventListener('abort',abort);
      if(aborted){reject(Error('LoRA download cancelled. Downloaded files are kept for the next attempt.'));return;}
      if(code!==0||!inventory||failure){reject(Error(failure??'LoRA preparation did not finish. Retry the download.'));return;}
      if(sources.some(source=>!inventory!.some(item=>item.sha256===source.sha256&&item.filename===`seed-${source.sha256}.safetensors`&&item.routes?.includes(source.route)))){
        reject(Error('The downloader did not verify every selected LoRA. Retry the download.'));return;
      }
      report('Selected LoRAs are ready');resolve(inventory);
    });
    child.stdin.end(JSON.stringify({workspace:options.workspace,entries:[...entries.values()],merge_adapters:true,
      credentials:{civitaiApiToken:token}})+'\n');
  });
}
