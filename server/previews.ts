import sharp from 'sharp';
import { mkdir, rename } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

export class Previews {
  private pending = new Map<string,Promise<string>>();
  private blocked = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private data: string, private cache: string) {}
  async withDeletion<T>(assetIds:string[],sequenceIds:string[],operation:()=>T|Promise<T>):Promise<T>{
    const prefixes=[...assetIds.map(id=>id+'-'),...sequenceIds.map(id=>'sequence-'+id+'-')];
    // Fence admission before waiting: another size/page must not join behind the drain.
    for(const prefix of prefixes)this.blocked.add(prefix);
    try{
      await Promise.allSettled([...this.pending].filter(([key])=>prefixes.some(prefix=>key.startsWith(prefix))).map(([,task])=>task));
      return await operation();
    }finally{for(const prefix of prefixes)this.blocked.delete(prefix);}
  }
  sheet(id: string, revision: number, page: number, frames: Array<{relative_path:string}>, width: number, height: number) {
    const key=`sequence-${id}-${revision}-${page}`, existing=this.pending.get(key);
    if(this.blocked.has('sequence-'+id+'-'))return Promise.reject(Error('This image is being deleted.'));
    if(existing) return existing;
    if(this.pending.size>=32) return Promise.reject(Error('Preview queue is busy.'));
    const operation=this.chain.then(async()=>{
      const directory=path.join(this.cache,'previews'),target=path.join(directory,key+'.webp');
      if(existsSync(target))return target;
      await mkdir(directory,{recursive:true});
      const scale=320/Math.max(width,height),w=Math.round(width*scale),h=Math.round(height*scale);
      const layers=[];
      for(let offset=0;offset<frames.length;offset+=4) {
        layers.push(...await Promise.all(frames.slice(offset,offset+4).map(async(frame,local)=>{
          const index=offset+local,file=path.resolve(this.data,frame.relative_path);
          if(!realpathSync(file).startsWith(realpathSync(this.data)+path.sep))throw Error('Invalid preview source.');
          const input=await sharp(file).resize(w,h,{fit:'fill'}).png().toBuffer();
          return {input,left:(index%6)*w,top:Math.floor(index/6)*h};
        })));
      }
      await sharp({create:{width:6*w,height:Math.ceil(frames.length/6)*h,channels:3,background:'#0b0c0e'}})
        .composite(layers).webp({quality:92}).toFile(target+'.part');
      await rename(target+'.part',target);return target;
    });
    this.chain=operation.catch(()=>{});this.pending.set(key,operation);
    void operation.finally(()=>this.pending.delete(key)).catch(()=>{});
    return operation;
  }
  get(id: string, relative: string, size: 384 | 1280) {
    const key=id+'-'+size, existing=this.pending.get(key);
    if(this.blocked.has(id+'-'))return Promise.reject(Error('This image is being deleted.'));
    if(existing) return existing;
    if(this.pending.size>=32) return Promise.reject(Error('Preview queue is busy.'));
    const operation=this.chain.then(async()=> {
      const file=path.resolve(this.data,relative), root=realpathSync(this.data)+path.sep;
      if(!realpathSync(file).startsWith(root)) throw Error('Invalid preview source.');
      const directory=path.join(this.cache,'previews'), target=path.join(directory,key+'.webp');
      if(existsSync(target)) return target;
      await mkdir(directory,{recursive:true});
      await sharp(file).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality:92}).toFile(target+'.part');
      await rename(target+'.part',target); return target;
    });
    this.chain=operation.catch(()=>{});
    this.pending.set(key,operation);
    void operation.finally(()=>this.pending.delete(key)).catch(()=>{});
    return operation;
  }
}
