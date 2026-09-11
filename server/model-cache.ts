import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import models from '../worker/models.json' with { type: 'json' };
import type { StudioPaths } from './storage.js';

export type ModelFile = { path: string; url: string; size: number; sha256: string; route?: 'image' | 'fl' | 'ref'; strength?: number };
export function validateModel(item: ModelFile) {
  if (!item || !/^[a-zA-Z0-9_./-]+$/.test(item.path) || item.path.startsWith('/') || item.path.split('/').some(p => !p || p === '..' || p === '.') || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1) throw Error('Invalid model manifest entry.');
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !['huggingface.co','civitai.com'].includes(url.hostname)) throw Error('Unsupported model source.');
  if (url.hostname === 'huggingface.co' && (url.search || !/^\/[^/]+\/[^/]+\/resolve\/[a-f0-9]{40}\/.+/.test(url.pathname))) throw Error('Pin Hugging Face models to a commit.');
  if (url.hostname === 'civitai.com' && (!/^\/api\/download\/models\/\d+$/.test(url.pathname) || !/^\d+$/.test(url.searchParams.get('fileId') ?? '') || [...url.searchParams.keys()].some(k => k !== 'fileId'))) throw Error('Pin Civitai models to a version and file ID.');
  if (item.route && (!['image','fl','ref'].includes(item.route) || !item.path.startsWith('loras/') || !(Number(item.strength ?? 1) > 0 && Number(item.strength ?? 1) <= 2))) throw Error('Invalid preset route or strength.');
}
export const modelDirectory = (paths: StudioPaths) => path.join(paths.data, 'models');
export const modelFile = (paths: StudioPaths, item: ModelFile) => path.join(modelDirectory(paths), item.sha256 + '.safetensors');
export async function modelManifest(paths: StudioPaths): Promise<ModelFile[]> {
  let presets: ModelFile[] = [];
  try { presets = JSON.parse(await readFile(path.join(paths.config, 'model-presets.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('Cannot read model-presets.json.'); }
  if (!Array.isArray(presets) || presets.some(p => !p.route)) throw Error('Presets need image, fl or ref routes.');
  const result: ModelFile[] = [...models, ...presets];
  result.forEach(validateModel);
  if (new Set(result.map(x => x.path)).size !== result.length || new Set(presets.map(x => x.route)).size !== presets.length) throw Error('Duplicate model path or preset route.');
  return result;
}
export async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function cached(paths: StudioPaths, item: ModelFile) {
  try {
    const file = modelFile(paths, item), s = await stat(file);
    const receipt = JSON.parse(await readFile(file + '.json', 'utf8'));
    return s.size === item.size && receipt.sha256 === item.sha256 && receipt.size === s.size && receipt.mtimeMs === s.mtimeMs;
  } catch { return false; }
}
export async function requireModelCache(paths: StudioPaths) {
  const entries = await modelManifest(paths);
  for (const item of entries) if (!await cached(paths, item)) throw Error(`Local model missing or changed: ${item.path}. Run seed models before renting a GPU.`);
  return entries;
}
async function downloadResponse(item: ModelFile, token: string, offset: number, end: number, request: typeof fetch, resolved: {url?:string}) {
  let url = resolved.url ?? item.url;
  for (let redirects = 0; redirects < 6; redirects++) {
    const headers: Record<string,string> = { Range: `bytes=${offset}-${end}` };
    if (url === item.url && token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try { response = await request(url, { headers, redirect:'manual', signal:AbortSignal.timeout(120000) }); }
    catch { throw Error(`Download interrupted for ${item.path}; rerun seed models to resume.`); }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      const next = new URL(location ?? '', url);
      if (!location || next.protocol !== 'https:' || next.username || next.password) throw Error('Invalid model download redirect.');
      url = next.href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw Error(`Model source returned HTTP ${response.status} for ${item.path}. Rerun later to resume; check account access for 401/403.`); }
    if (url !== item.url) resolved.url = url;
    return response;
  }
  throw Error('Too many model download redirects.');
}
export async function downloadModel(paths: StudioPaths, item: ModelFile, token: string, request: typeof fetch = fetch, progress: (bytes:number)=>void = ()=>{}) {
  validateModel(item);
  await mkdir(modelDirectory(paths), { recursive:true });
  if (await cached(paths,item)) return;
  const file = modelFile(paths,item), partial = file + '.part';
  // A completed but unreceipted file can be recovered after an interrupted setup.
  try { if ((await stat(file)).size === item.size && await digest(file) === item.sha256) { const s=await stat(file); await writeFile(file+'.json',JSON.stringify({sha256:item.sha256,size:s.size,mtimeMs:s.mtimeMs})); return; } } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let offset = await stat(partial).then(s => s.size, () => 0);
  if (offset > item.size) { await rm(partial); offset = 0; }
  const disk = await statfs(modelDirectory(paths));
  if (disk.bavail * disk.bsize < item.size - offset + 1024 ** 3) throw Error('Not enough local disk space for models plus 1 GiB working space.');
  const resolved: {url?:string} = {};
  while (offset < item.size) {
    const end = Math.min(offset + 64 * 1024 * 1024, item.size) - 1;
    const response = await downloadResponse(item,token,offset,end,request,resolved);
    const append = offset > 0 && response.status === 206;
    if (response.status === 206 && response.headers.get('content-range') !== `bytes ${offset}-${end}/${item.size}`) { await response.body?.cancel(); throw Error('Invalid resumed model response.'); }
    if (!response.body) throw Error('Empty model response.');
    let transferred = 0;
    const limit = response.status === 206 ? end-offset+1 : item.size;
    const bound = new Transform({transform(chunk,_encoding,done){transferred+=chunk.length;done(transferred>limit?Error('Model response exceeded expected size'):null,chunk);}});
    try { await pipeline(Readable.fromWeb(response.body as never),bound,createWriteStream(partial,{flags:append?'a':'w'})); }
    catch { throw Error(`Download interrupted for ${item.path}; rerun seed models to resume.`); }
    const received = (await stat(partial)).size;
    if (received <= offset || received > item.size) throw Error('Invalid model download length.');
    offset = received;
    progress(offset);
  }

  if ((await stat(partial)).size !== item.size || await digest(partial) !== item.sha256) { await rm(partial); throw Error(`Model verification failed: ${item.path}.`); }
  await rename(partial,file);
  const s = await stat(file);
  await writeFile(file+'.json',JSON.stringify({sha256:item.sha256,size:s.size,mtimeMs:s.mtimeMs}));
}
export async function prepareModels(paths: StudioPaths, say: (message:string)=>void = console.log) {
  const entries = await modelManifest(paths);
  let credentials: Record<string,string> = {};
  try { credentials = JSON.parse(await readFile(path.join(paths.config,'credentials.json'),'utf8')); } catch {}
  say(`Preparing ${(entries.reduce((n,x)=>n+x.size,0)/1e9).toFixed(2)} GB of models in ${modelDirectory(paths)}`);
  await mkdir(modelDirectory(paths), {recursive:true});
  let required = 1024 ** 3;
  for(const item of entries) if(!await cached(paths,item)) {
    const partial = await stat(modelFile(paths,item)+'.part').then(s=>s.size,()=>0);
    required += item.size - Math.min(partial,item.size);
  }
  const disk=await statfs(modelDirectory(paths));
  if(disk.bavail*disk.bsize < required) throw Error(`Model setup needs ${(required/1e9).toFixed(1)} GB of additional free space.`);
  let next = 0;
  async function acquire() {
    while (next < entries.length) {
      const index = next++, item = entries[index]!;
      say(`[${index+1}/${entries.length}] ${await cached(paths,item)?'Cached':'Downloading and verifying'}: ${item.path}`);
      let last = Date.now();
      await downloadModel(paths,item,new URL(item.url).hostname === 'huggingface.co' ? (process.env.HF_TOKEN || credentials.huggingFaceToken || '') : (process.env.CIVITAI_API_TOKEN || credentials.civitaiApiToken || ''),fetch,bytes=>{
        if (Date.now()-last > 30000) { say(`${item.path}: ${(bytes/1e9).toFixed(2)}/${(item.size/1e9).toFixed(2)} GB`); last=Date.now(); }
      });
    }
  }
  const results = await Promise.allSettled([acquire(),acquire(),acquire()]);
  const failed = results.find(r=>r.status==='rejected');
  if (failed?.status==='rejected') throw failed.reason;
  say('All models verified locally. Model-source keys stay on this PC.');
}
