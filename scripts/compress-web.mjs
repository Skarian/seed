import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync,brotliCompressSync,constants} from 'node:zlib';
async function compress(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())await compress(file);
    else if(/\.(js|css|html|svg)$/.test(entry.name)){
      const bytes=await readFile(file);
      await writeFile(file+'.gz',gzipSync(bytes,{level:9}));
      await writeFile(file+'.br',brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:9}}));
    }
  }
}
await compress(path.resolve('dist/web'));
