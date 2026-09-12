import { test, expect } from 'vitest';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hfEnvironment, hfSource, downloadHuggingFace } from '../server/hf-download.js';
import { downloadModel, modelFile, cached } from '../server/model-cache.js';
import { resolvePaths, prepareStorage } from '../server/storage.js';
const url = 'https://huggingface.co/org/model/resolve/'+'a'.repeat(40)+'/vae/test.safetensors';
const bytes=Buffer.from('verified weights');
const item={path:'vae/test.safetensors',url,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
async function fixture(){const p=resolvePaths(await mkdtemp(path.join(tmpdir(),'seed-hf-')));prepareStorage(p);return p;}
test('official CLI receives exact revision/filename and source token only in environment',async()=>{
 const p=await fixture(),stage=path.join(p.data,'stage with spaces');
 let called=false;
 const result=await downloadHuggingFace(url,stage,'private-hf',p.cache,async(exe,args,env)=>{
  called=true;expect(args).toEqual(['download','org/model','vae/test.safetensors','--revision','a'.repeat(40),'--local-dir',stage,'--quiet']);
  expect(args.join(' ')).not.toContain('private-hf');expect(env.HF_TOKEN).toBe('private-hf');expect(env.HF_HUB_DISABLE_XET).toBe('0');
 });
 expect(called).toBe(true);expect(result).toBe(path.join(stage,'vae/test.safetensors'));
 const env=hfEnvironment('hf-only',p.cache,{CIVITAI_API_TOKEN:'civitai',RUNPOD_API_KEY:'runpod',VAST_API_KEY:'vast',HF_TOKEN:'old',PATH:'path'});
 expect(env.HF_TOKEN).toBe('hf-only');expect(env).not.toHaveProperty('CIVITAI_API_TOKEN');expect(env).not.toHaveProperty('RUNPOD_API_KEY');expect(env).not.toHaveProperty('VAST_API_KEY');expect(env.PATH).toBe('path');
});
test('verified official output replaces old HTTP partial, then cached model bypasses CLI',async()=>{
 const p=await fixture();await mkdir(path.dirname(modelFile(p,item)),{recursive:true});await writeFile(modelFile(p,item)+'.part','old partial');
 let calls=0;
 const official=async(_url:string,stage:string)=>{calls++;const output=path.join(stage,'vae/test.safetensors');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,bytes);return output;};
 const noHttp=async()=>{throw Error('Custom HTTP must not fetch HF');};
 await downloadModel(p,item,'token',noHttp,()=>{},official);
 expect(await cached(p,item)).toBe(true);expect(await readFile(modelFile(p,item))).toEqual(bytes);
 await expect(stat(modelFile(p,item)+'.part')).rejects.toThrow();
 await downloadModel(p,item,'token',noHttp,()=>{},official);expect(calls).toBe(1);
});
test('official failure or corrupt output does not discard old partials or promote a model',async()=>{
 const p=await fixture();await mkdir(path.dirname(modelFile(p,item)),{recursive:true});const partial=modelFile(p,item)+'.part';await writeFile(partial,'keep');
 await expect(downloadModel(p,item,'',fetch,()=>{},async()=>{throw Error('official failed');})).rejects.toThrow('official failed');
 expect(await readFile(partial,'utf8')).toBe('keep');
 await expect(downloadModel(p,item,'',fetch,()=>{},async(_url,stage)=>{const f=path.join(stage,'vae/test.safetensors');await mkdir(path.dirname(f),{recursive:true});await writeFile(f,'wrong');return f;})).rejects.toThrow('verification');
 expect(await cached(p,item)).toBe(false);expect(await readFile(partial,'utf8')).toBe('keep');
});
test('HF source parsing rejects traversal, URL credentials and mutable revisions',()=>{
 expect(hfSource(url).filename).toBe('vae/test.safetensors');
 for(const bad of [url.replace('a'.repeat(40),'main'),url.replace('vae/test.safetensors','%2e%2e/test'),url+'?token=private',url.replace('huggingface.co','private@huggingface.co')])expect(()=>hfSource(bad)).toThrow();
});

test('cancelling HF runner waits for its real child process to exit',async()=>{
 const {runHf}=await import('../server/hf-download.js');
 const p=await fixture(),pidFile=path.join(p.cache,'test-child.pid');
 const controller=new AbortController();
 const running=runHf(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",pidFile],process.env,controller.signal);
 // Attach rejection observation before triggering cancellation.
 const outcome=running.then(()=>null,error=>error);
 let pid=0;
 try{
  for(let i=0;i<100;i++){try{pid=Number(await readFile(pidFile,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
  expect(pid).toBeGreaterThan(0);
  controller.abort();
  expect((await outcome).name).toBe('AbortError');
  expect(()=>process.kill(pid,0)).toThrow();
 }finally{controller.abort();await outcome;}
});

test('fallback forwards cancellation to the official downloader without promoting',async()=>{
 const p=await fixture(),controller=new AbortController();
 const official:typeof downloadHuggingFace=async(_url,_stage,_token,_cache,_run,signal)=>{
  expect(signal).toBe(controller.signal);controller.abort();signal!.throwIfAborted();return '';
 };
 await expect(downloadModel(p,item,'',fetch,()=>{},official,controller.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(await cached(p,item)).toBe(false);
});
