import sharp from 'sharp';
import { mkdir, rename } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

export class Previews {
  private pending = new Map<string,Promise<string>>();
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private data: string, private cache: string) {}
  get(id: string, relative: string, size: 384 | 1280) {
    const key=id+'-'+size, existing=this.pending.get(key);
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
