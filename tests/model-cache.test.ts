import {test,expect,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {downloadModel,modelFile,modelDirectory,cached,validateModel} from '../server/model-cache.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
const bytes=Buffer.from('model weights');
const item={path:'vae/test.safetensors',url:'https://civitai.com/api/download/models/12?fileId=34',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
async function fixture(){const p=resolvePaths(await mkdtemp(path.join(tmpdir(),'seed-models-')));prepareStorage(p);return p;}
test('download follows CDN without source token and reuses verified local file',async()=>{
 const p=await fixture();const calls:any[]=[];
 const request=vi.fn(async(url,opts)=>{calls.push([url,opts]);return calls.length===1?new Response(null,{status:302,headers:{Location:'https://cdn.example/weights'}}):new Response(bytes);});
 await downloadModel(p,item,'secret',request);
 expect(calls[0][1].headers.Authorization).toBe('Bearer secret');expect(calls[1][1].headers.Authorization).toBeUndefined();
 expect(await cached(p,item)).toBe(true);await downloadModel(p,item,'secret',request);expect(request).toHaveBeenCalledTimes(2);
 await writeFile(modelFile(p,item),'changed');expect(await cached(p,item)).toBe(false);
});
test('interrupted download resumes from partial and validates Content-Range',async()=>{
 const p=await fixture();const {mkdir}=await import('node:fs/promises');await mkdir(modelDirectory(p),{recursive:true});
 await writeFile(modelFile(p,item)+'.part',bytes.subarray(0,4));
 const request=vi.fn(async(_url,opts)=>{expect(opts.headers.Range).toBe(`bytes=4-${bytes.length-1}`);return new Response(bytes.subarray(4),{status:206,headers:{'Content-Range':`bytes 4-${bytes.length-1}/${bytes.length}`}});});
 await downloadModel(p,item,'',request);expect(await readFile(modelFile(p,item))).toEqual(bytes);
});
test('hash mismatch is never promoted; HTTP errors omit private response data',async()=>{
 const p=await fixture();await expect(downloadModel(p,item,'',async()=>new Response(Buffer.alloc(bytes.length)))).rejects.toThrow('verification');
 await expect(stat(modelFile(p,item))).rejects.toThrow();
 await expect(downloadModel(p,item,'',async()=>new Response('secret',{status:403}))).rejects.toThrow('HTTP 403');
});
test('rejects traversal and credential-bearing model sources',()=>{
 for(const change of [{path:'../outside'},{url:'https://huggingface.co/a/b/resolve/main/file'},{url:'https://civitai.com/api/download/models/12?fileId=34&token=secret'}])expect(()=>validateModel({...item,...change})).toThrow();
});
