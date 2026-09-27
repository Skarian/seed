import {readFileSync,writeFileSync,renameSync,existsSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {StudioPaths} from './storage.js';
import {credential} from './credential-store.js';
import {Loras,loraGroupId,sourceReady} from './loras.js';
import {familyRoutes,type LoraFamily,type LoraRoute,type LoraGuidance,type LoraPreview,type LoraImportActivity,type LoraSource} from '../shared/loras.js';

type ImportJob=LoraImportActivity&{group_id:string;mode:'sfw'|'nsfw';version_id?:number;source_url?:string;input?:unknown};
const validId=(v:unknown)=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const familyOf=(base:string):LoraFamily|null=>/krea[ -]?2/i.test(base)?'krea2':/minimax.*h3|\bh3\b/i.test(base)?'h3':null;
export function civitaiLocation(raw:unknown){
  if(typeof raw!=='string')throw Error('Paste a Civitai model or model-version URL.');
  let url:URL;try{url=new URL(raw);}catch{throw Error('Paste a Civitai model URL.');}
  if(url.protocol!=='https:'||!['civitai.com','www.civitai.com'].includes(url.hostname)||url.username||url.password||url.port)throw Error('Use an HTTPS Civitai model URL.');
  const model=url.pathname.match(/^\/models\/(\d+)(?:\/.*)?$/),version=url.pathname.match(/^\/api\/(?:v1\/model-versions|download\/models)\/(\d+)\/?$/);
  const versionId=url.searchParams.get('modelVersionId')??version?.[1];
  if((versionId&&!validId(versionId))||(!model&&!version))throw Error('Choose a Civitai model or model-version page.');
  return {modelId:model?Number(model[1]):undefined,versionId:versionId?Number(versionId):undefined};
}
function guidance(input:any):LoraGuidance {
  if(typeof input?.name!=='string'||!input.name.trim()||input.name.length>150||typeof input.description!=='string'||input.description.length>4000||!Number.isFinite(input.default_scale)||input.default_scale<0||input.default_scale>4||!Array.isArray(input.trigger_words)||input.trigger_words.length>30||input.trigger_words.some((s:unknown)=>typeof s!=='string'||s.length>200))throw Error('Check the LoRA name, description, trigger words, and strength.');
  return {name:input.name.trim(),description:input.description,default_scale:input.default_scale,trigger_words:input.trigger_words};
}
function mappings(input:any,family:LoraFamily){
  if(!Array.isArray(input)||!input.length||input.length>familyRoutes(family).length||input.some(f=>!f||!familyRoutes(family).includes(f.route))||new Set(input.map(f=>f.route)).size!==input.length)throw Error('Map one file to each workflow you want to use.');
}
function pinnedSource(version:any,file:any):LoraSource {
  let url:URL;try{url=new URL(file.downloadUrl);}catch{throw Error('Civitai returned an invalid adapter source.');}
  // Persist only stable selectors, never signed links or embedded credentials.
  if(url.protocol!=='https:'||url.hostname!=='civitai.com'||url.username||url.password||url.port||url.pathname!==`/api/download/models/${version.id}`)throw Error('Civitai returned an unsupported adapter source.');
  for(const key of [...url.searchParams.keys()])if(!['type','format','size','fp'].includes(key))url.searchParams.delete(key);
  const source:LoraSource={provider:'civitai',model_id:version.modelId,version_id:version.id,file_id:file.id,url:url.toString(),sha256:String(file.hashes?.SHA256??'').toLowerCase(),size_bytes:Math.round(file.sizeKB*1024)};
  if(!sourceReady(source))throw Error('Choose a supported adapter file with a checksum and size under 8 GiB.');
  return source;
}

export class LoraImports {
  private file:string;
  private jobs:ImportJob[];
  private abort=new AbortController();
  constructor(private paths:StudioPaths,private loras:Loras,private fetcher:typeof fetch=fetch){
    this.file=path.join(paths.config,'lora-imports.json');
    const saved=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):[];
    if(!Array.isArray(saved))throw Error('Cannot read LoRA import history.');
    // Let the catalog recover already-pinned legacy sources before normalizing history.
    this.loras.all();
    this.jobs=saved.map((old:any)=>{
      const entry=this.loras.all().find(e=>e.id===old.lora_id);
      const job:ImportJob={...old,group_id:old.group_id??(entry?loraGroupId(entry):'import-'+old.id),updated_at:old.updated_at??old.created_at,files:old.files??[{name:entry?.filename??'Imported adapter',route:old.route,state:old.state,bytes:old.bytes??0,total:old.total??0}]};
      if(!['ready','failed'].includes(job.state)){
        job.state='failed';job.error='This earlier import was interrupted. Add its Civitai version again to prepare it on new workers.';
        job.files=job.files.map(file=>({...file,state:file.state==='ready'?'ready':'failed'}));
      }
      return job;
    });
    if(saved.length)this.save();
  }
  private save(){const temporary=this.file+'.'+randomUUID()+'.tmp';try{writeFileSync(temporary,JSON.stringify(this.jobs,null,2),{mode:0o600});renameSync(temporary,this.file);}finally{rmSync(temporary,{force:true});}}
  list(mode:'sfw'|'nsfw'):LoraImportActivity[]{return this.jobs.filter(j=>mode==='nsfw'||j.mode==='sfw').map(j=>({id:j.id,name:j.name,version:j.version,state:j.state,created_at:j.created_at,updated_at:j.updated_at,...(j.error?{error:j.error}:{}),files:j.files.map(({name,route,state,bytes,total,error})=>({name,route,state,bytes,total,...(error?{error}:{})}))}));}
  busy(){return false;}
  async close(){this.abort.abort();}
  private async metadata(route:string){
    const key=credential(this.paths,'civitaiKey');
    let response:Response;
    try{response=await this.fetcher('https://civitai.com/api/v1/'+route,{headers:key?{Authorization:'Bearer '+key}:{},redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(30000)])});}
    catch{throw Error('Could not reach Civitai. Check your connection and try again.');}
    if(!response.ok){await response.body?.cancel();throw Error(response.status===401||response.status===403?'Civitai denied access. Check your Civitai key and access to this version.':response.status===404?'This Civitai model or version is unavailable.':response.status===429?'Civitai is busy. Wait and retry.':'Could not read Civitai metadata. Try again.');}
    const text=await response.text();if(text.length>4*1024*1024)throw Error('Civitai metadata is too large.');
    try{return JSON.parse(text);}catch{throw Error('Civitai returned invalid metadata. Try again.');}
  }
  async inspect(url:string):Promise<LoraPreview>{
    const location=civitaiLocation(url);
    if(location.versionId){const v=await this.metadata('model-versions/'+location.versionId);if(v.id!==location.versionId||location.modelId&&v.modelId!==location.modelId)throw Error('The version does not belong to this model.');return this.preview(v.model,v.modelId,[v]);}
    const model=await this.metadata('models/'+location.modelId);if(model.id!==location.modelId)throw Error('Civitai returned a different model.');return this.preview(model,model.id,model.modelVersions??[]);
  }
  private preview(model:any,modelId:number,versions:any[]):LoraPreview {
    if(!['lora','locon'].includes(String(model?.type).toLowerCase()))throw Error('Choose a LoRA or LoKR adapter, not a base model.');
    return {name:String(model.name).slice(0,150),model_id:modelId,versions:versions.slice(0,80).map(v=>({id:v.id,name:String(v.name).slice(0,100),base_model:String(v.baseModel),family:familyOf(String(v.baseModel)),supported:familyOf(String(v.baseModel))!==null,trigger_words:(v.trainedWords??[]).filter((w:unknown)=>typeof w==='string').slice(0,30),files:(v.files??[]).map((f:any)=>({id:f.id,name:String(f.name),size_bytes:Math.round(f.sizeKB*1024),supported:/\.safetensors$/i.test(f.name)&&/^[a-f0-9]{64}$/i.test(f.hashes?.SHA256??'')&&Number.isFinite(f.sizeKB)&&f.sizeKB>0&&f.sizeKB*1024<=8*1024**3}))}))};
  }
  private record(job:ImportJob){this.jobs.unshift(job);this.save();return this.list(job.mode).find(j=>j.id===job.id)!;}
  async add(input:any){
    const details=guidance(input);
    if(!validId(input.version_id)||!['sfw','nsfw'].includes(input.mode))throw Error('Choose a model version.');
    const version=await this.metadata('model-versions/'+input.version_id);
    if(version.id!==Number(input.version_id))throw Error('Civitai returned a different model version.');
    const preview=this.preview(version.model,version.modelId,[version]).versions[0]!;
    if(!preview.family)throw Error('This model is not supported. Choose a Krea 2 or MiniMax H3 LoRA.');
    mappings(input.files,preview.family);
    const files=input.files.map((mapping:{file_id:number;route:LoraRoute})=>{
      const file=version.files?.find((f:any)=>f.id===mapping.file_id&&/\.safetensors$/i.test(f.name));
      if(!file)throw Error('Choose a supported adapter file.');
      return {name:String(file.name).slice(0,255),route:mapping.route,source:pinnedSource(version,file)};
    });
    const source_url=`https://civitai.com/models/${version.modelId}?modelVersionId=${version.id}`;
    const group_id=loraGroupId({id:'',route:files[0]!.route,source_url,availability:input.mode==='nsfw'?'spicy':'all'});
    const existing=this.loras.groups(input.mode).find(g=>g.id===group_id),now=new Date().toISOString();
    this.loras.applySources(group_id,files,{...details,version:preview.name,source_url,availability:input.mode==='nsfw'?'spicy':'all',enabled:existing?.enabled??true});
    return this.record({id:randomUUID(),group_id,mode:input.mode,name:details.name,version_id:version.id,version:preview.name,source_url,state:'ready',created_at:now,updated_at:now,files:files.map((file:{name:string;route:LoraRoute;source:LoraSource})=>({name:file.name,route:file.route,state:'ready',bytes:0,total:file.source.size_bytes}))});
  }
  edit(groupId:string,input:any){
    const details=guidance(input),group=this.loras.groups('nsfw').find(g=>g.id===groupId);
    if(!group)throw Error('This LoRA is no longer available.');
    if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('Choose whether this LoRA is enabled.');
    mappings(input.files,group.family);
    for(const file of input.files)if(!group.files.some(source=>source.id===file.id))throw Error('A selected file is not part of this LoRA.');
    this.loras.remapGroup(groupId,input.files,{...details,availability:group.availability,enabled:input.enabled??group.enabled,version:group.version,source_url:group.source_url});
    const now=new Date().toISOString();
    return this.record({id:randomUUID(),group_id:groupId,mode:group.availability==='all'?'sfw':'nsfw',name:details.name,version:group.version,state:'ready',created_at:now,updated_at:now,files:input.files.map((file:{id:string;route:LoraRoute})=>({name:group.files.find(f=>f.id===file.id)!.name,route:file.route,state:'ready',bytes:0,total:0}))});
  }
  async retry(id:string){
    const job=this.jobs.find(j=>j.id===id);
    if(!job||job.state!=='failed')throw Error('This import cannot be retried.');
    if(!job.input)throw Error('Add the Civitai version again to confirm its sources and workflow mappings.');
    return this.add(job.input);
  }
}
