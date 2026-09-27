import {lstatSync,readdirSync,realpathSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {Job} from './jobs.js';
import type {StudioPaths} from './storage.js';

type Paths=Pick<StudioPaths,'data'|'cache'>;
type CacheJobs={all():Job[];isInFlight(id:string):boolean};
type Area='prepared'|'previews';
export type CacheCleanupFailure={area:Area;code:string};
const terminal=new Set(['completed','failed','cancelled']);
const prepared=/^([a-f0-9]{64}(?:-audio)?\.(?:png|mp4|wav))(?:\.(?:[a-f0-9-]{36}\.)?tmp)?$/;
const thumbnail=/^([\w-]+)-(?:384|1280)\.webp(?:\.part)?$/;
const sheet=/^sequence-([\w-]+)-(\d+)-(\d+)\.webp(?:\.part)?$/;

function invalidEntry(){return Object.assign(Error('A cached file has an unsafe location. Close apps using it and retry.'),{code:'UNSAFE_CACHE_PATH'});}
function directory(paths:Paths,area:Area){return area==='prepared'?path.join(paths.data,'media','prepared'):path.join(paths.cache,'previews');}
function entries(paths:Paths,area:Area):string[]{
  const folder=directory(paths,area);
  try{
    const info=lstatSync(folder),root=realpathSync(area==='prepared'?paths.data:paths.cache)+path.sep;
    if(!info.isDirectory()||info.isSymbolicLink()||!realpathSync(folder).startsWith(root))throw invalidEntry();
    return readdirSync(folder);
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}
function remove(paths:Paths,area:Area,name:string){
  const folder=directory(paths,area),file=path.join(folder,name);
  try{
    const info=lstatSync(file);
    if(path.basename(name)!==name||!info.isFile()||info.isSymbolicLink()||!realpathSync(file).startsWith(realpathSync(folder)+path.sep))throw invalidEntry();
    unlinkSync(file);return true;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
function nameOf(paths:Paths,file:string|undefined){
  if(!file)return null;
  const relative=path.relative(directory(paths,'prepared'),path.resolve(file));
  return path.basename(relative)===relative&&prepared.test(relative)?relative:null;
}
function names(paths:Paths,ref:NonNullable<Job['prepared']>[number]){
  return [nameOf(paths,ref.file),nameOf(paths,ref.audio_file)].filter((name):name is string=>name!==null);
}
function retained(paths:Paths,jobs:CacheJobs,records:Job[],live:Set<string>,excluding:Set<string>){
  const keep=new Set<string>();
  for(const job of records){
    const active=!terminal.has(job.state)||jobs.isInFlight(job.id);
    for(const ref of job.prepared??[])if(active||(live.has(ref.asset_id)&&!excluding.has(ref.asset_id)))for(const name of names(paths,ref))keep.add(name);
  }
  return keep;
}

/** Caller holds jobs.serialize and fences target previews. Cache failures precede original deletion. */
export function removeAssetCaches(db:Database.Database,paths:Paths,jobs:CacheJobs,assetIds:string[],sequenceIds:string[]=[]){
  const targets=new Set(assetIds),sequences=new Set(sequenceIds),records=jobs.all();
  for(const job of records)if((!terminal.has(job.state)||jobs.isInFlight(job.id))&&
    [...(job.request?.references??[]),...(job.prepared??[])].some(ref=>targets.has(ref.asset_id)))throw Error('A job still needs this file. Wait for it to finish.');
  const live=new Set((db.prepare('SELECT id FROM assets').all() as {id:string}[]).map(row=>row.id));
  const keep=retained(paths,jobs,records,live,targets),candidates=new Set<string>();
  for(const job of records)for(const ref of job.prepared??[])if(targets.has(ref.asset_id))for(const name of names(paths,ref))if(!keep.has(name))candidates.add(name);
  try{
    for(const name of entries(paths,'prepared')){const match=prepared.exec(name);if(match&&candidates.has(match[1]!))remove(paths,'prepared',name);}
    for(const name of entries(paths,'previews')){
      const page=sheet.exec(name),image=thumbnail.exec(name);
      if(page?sequences.has(page[1]!):image&&targets.has(image[1]!))remove(paths,'previews',name);
    }
  }catch(error){throw Object.assign(Error('Could not remove a cached copy. Close apps using it and retry deletion.'),{code:(error as NodeJS.ErrnoException).code??'CACHE_DELETE_FAILED'});}
}

/** Disposable files only; invoke inside jobs.serialize, after deletion or before serving requests. */
export function sweepMediaCaches(db:Database.Database,paths:Paths,jobs:CacheJobs,onFailure:(failure:CacheCleanupFailure)=>void){
  const live=new Set((db.prepare('SELECT id FROM assets').all() as {id:string}[]).map(row=>row.id));
  const sequences=new Map((db.prepare('SELECT id,revision FROM sequences').all() as {id:string;revision:number}[]).map(row=>[row.id,row.revision]));
  const keep=retained(paths,jobs,jobs.all(),live,new Set());
  const result={removed:0,failed:0};
  const failed=(area:Area,error:unknown)=>{result.failed++;onFailure({area,code:(error as NodeJS.ErrnoException).code??'CACHE_DELETE_FAILED'});};
  for(const area of ['prepared','previews'] as const){
    let files:string[];try{files=entries(paths,area);}catch(error){failed(area,error);continue;}
    for(const name of files){
      const page=sheet.exec(name),image=thumbnail.exec(name);
      const orphan=area==='prepared'?prepared.test(name)&&!keep.has(name):page?sequences.get(page[1]!)!==Number(page[2]):image&&!live.has(image[1]!);
      if(!orphan)continue;
      try{if(remove(paths,area,name))result.removed++;}catch(error){failed(area,error);}
    }
  }
  return result;
}
