import {afterEach,expect,it,vi} from 'vitest';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import * as files from 'node:fs/promises';
import path from 'node:path';
import {downloadAndRelayBaseModel} from '../server/base-model-transfer.js';
import {WorkerConnection} from '../server/worker.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import type {ModelSource} from '../server/pool-contracts.js';

vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,statfs:vi.fn(actual.statfs)};});
const roots:string[]=[];
function fixture(bytes=Buffer.from('verified base weights')){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/base-model-'));roots.push(root);
  const paths=resolvePaths(root);prepareStorage(paths);
  const item:ModelSource={path:'vae/base.safetensors',url:'https://huggingface.co/Comfy-Org/Test/resolve/'+'a'.repeat(40)+'/vae/base.safetensors',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  return {paths,item,bytes,target:path.join(paths.cache,'models',item.sha256+'.safetensors')};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

it('downloads a pinned base model, scopes authentication, verifies it, and reuses the cache',async()=>{
  const {paths,item,bytes,target}=fixture();
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:302,headers:{Location:'https://cas-bridge.xethub.hf.co/asset?signature=opaque'}})).mockResolvedValueOnce(new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}));vi.stubGlobal('fetch',fetcher);
  const uploadModel=vi.fn(async(_item,file)=>{expect(readFileSync(file)).toEqual(bytes);});
  await downloadAndRelayBaseModel(item,paths,{uploadModel},'private-hf-token');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({redirect:'manual',headers:{Authorization:'Bearer private-hf-token'}});
  expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty('Authorization');expect(readFileSync(target)).toEqual(bytes);
  await downloadAndRelayBaseModel(item,paths,{uploadModel},'private-hf-token');
  expect(fetcher).toHaveBeenCalledTimes(2);expect(uploadModel).toHaveBeenCalledTimes(2);
});

it('resumes a saved local partial only for an exact HTTP byte range',async()=>{
  const {paths,item,bytes,target}=fixture();mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target+'.part',bytes.subarray(0,4));
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes.subarray(4),{status:206,headers:{'Content-Range':`bytes 4-${bytes.length-1}/${bytes.length}`}}));vi.stubGlobal('fetch',fetcher);
  const uploadModel=vi.fn(async()=>{});await downloadAndRelayBaseModel(item,paths,{uploadModel},'');
  expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({Range:'bytes=4-'});expect(readFileSync(target)).toEqual(bytes);
  rmSync(target);writeFileSync(target+'.part',bytes.subarray(0,4));fetcher.mockResolvedValue(new Response(bytes.subarray(4),{status:206,headers:{'Content-Range':'bytes 0-3/4'}}));
  await expect(downloadAndRelayBaseModel(item,paths,{uploadModel},'')).rejects.toThrow('resume range');expect(uploadModel).toHaveBeenCalledTimes(1);
});

it('rejects corrupt bytes before relay and permits a clean retry',async()=>{
  const {paths,item,bytes,target}=fixture(),uploadModel=vi.fn(async()=>{});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(Buffer.alloc(bytes.length))).mockResolvedValueOnce(new Response(bytes)));
  await expect(downloadAndRelayBaseModel(item,paths,{uploadModel},'')).rejects.toThrow('checksum');expect(uploadModel).not.toHaveBeenCalled();expect(statSync(target+'.part').size).toBe(0);
  await downloadAndRelayBaseModel(item,paths,{uploadModel},'');expect(uploadModel).toHaveBeenCalledOnce();
});

it('refuses LoRAs, mutable sources, unsafe redirects, cancellation and insufficient disk',async()=>{
  const {paths,item,bytes}=fixture(),uploadModel=vi.fn(async()=>{}),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const bad of [{...item,routes:['image'] as ['image']},{...item,path:'loras/x.safetensors'},{...item,url:item.url.replace('a'.repeat(40),'main')}])await expect(downloadAndRelayBaseModel(bad,paths,{uploadModel},'')).rejects.toThrow('pinned');
  const abort=new AbortController();abort.abort();await expect(downloadAndRelayBaseModel(item,paths,{uploadModel},'',abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}}));await expect(downloadAndRelayBaseModel(item,paths,{uploadModel},'secret')).rejects.toThrow('unsupported download');expect(fetcher).toHaveBeenCalledOnce();
  vi.mocked(files.statfs).mockResolvedValueOnce({bavail:0n,bsize:4096n} as any);await expect(downloadAndRelayBaseModel(item,paths,{uploadModel},'')).rejects.toThrow('free disk');expect(uploadModel).not.toHaveBeenCalled();
  expect(bytes.length).toBeGreaterThan(0);
});

it('serializes shared-cache writers across workers without duplicating source downloads',async()=>{
  const {paths,item,bytes}=fixture(),fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher);
  const first=vi.fn(async()=>{}),second=vi.fn(async()=>{});
  await Promise.all([downloadAndRelayBaseModel(item,paths,{uploadModel:first},''),downloadAndRelayBaseModel(item,paths,{uploadModel:second},'')]);
  expect(fetcher).toHaveBeenCalledOnce();expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce();
});

it('retains downloaded bytes on a disconnected stream and resumes them on retry',async()=>{
  const {paths,item,bytes,target}=fixture(),uploadModel=vi.fn(async()=>{});
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes.subarray(0,4));setTimeout(()=>controller.error(Error('source disconnected')),20);}});
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(stream)).mockResolvedValueOnce(new Response(bytes.subarray(4),{status:206,headers:{'Content-Range':`bytes 4-${bytes.length-1}/${bytes.length}`}}));vi.stubGlobal('fetch',fetcher);
  await expect(downloadAndRelayBaseModel(item,paths,{uploadModel},'')).rejects.toThrow('interrupted');expect(statSync(target+'.part').size).toBe(4);expect(uploadModel).not.toHaveBeenCalled();
  await downloadAndRelayBaseModel(item,paths,{uploadModel},'');expect(uploadModel).toHaveBeenCalledOnce();expect(readFileSync(target)).toEqual(bytes);
});

it.each([true,false])('uses real tus resume offsets and accepts only worker verification (%s)',async verified=>{
  const {paths,item,bytes}=fixture(randomBytes(64*1024)),file=path.join(paths.cache,'source');writeFileSync(file,bytes);
  const credential='test-worker-credential-'.repeat(3),route='/worker/v1/model-uploads/'+createHash('sha256').update(item.path).digest('hex');
  let saved=bytes.subarray(0,100),heads:number[]=[],posts=0;
  const server=createServer((req,res)=>{
    expect(req.headers.authorization).toBe('Bearer '+credential);
    if(req.url==='/worker/v1/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({protocol_version:2,worker_instance_id:'instance',workspace_id:'workspace',state:'preparing',worker_class:'image',runtime_revision:'seed-pool-v1',preparation:{phase:'preparing'}}));return;}
    expect(req.url).toBe(route);res.setHeader('Tus-Resumable','1.0.0');
    if(req.method==='POST'){posts++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:verified&&saved.equals(bytes),upload_path:route}));return;}
    if(req.method==='HEAD'){heads.push(saved.length);res.writeHead(200,{'Upload-Offset':String(saved.length),'Upload-Length':String(bytes.length)});res.end();return;}
    expect(req.method).toBe('PATCH');expect(Number(req.headers['upload-offset'])).toBe(saved.length);
    req.on('data',chunk=>{saved=Buffer.concat([saved,chunk]);});req.on('end',()=>{res.writeHead(204,{'Upload-Offset':String(saved.length)});res.end();});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  writeFileSync(path.join(paths.config,'worker-connection.json'),JSON.stringify({endpoint:origin,worker_credential:credential,worker_instance_id:'instance',workspace_id:'workspace',protocol_version:2}));
  try{
    const result=new WorkerConnection(paths,origin).uploadModel(item,file);
    if(verified)await result;else await expect(result).rejects.toThrow('not verified');
    expect(saved).toEqual(bytes);expect(heads).toEqual([100]);expect(posts).toBe(2);
  }
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('cancels a real tus upload without deleting its remote partial bytes',async()=>{
  const {paths,item,bytes}=fixture(randomBytes(2*1024*1024)),file=path.join(paths.cache,'source');writeFileSync(file,bytes);
  const credential='test-worker-credential-'.repeat(3),route='/worker/v1/model-uploads/'+createHash('sha256').update(item.path).digest('hex'),abort=new AbortController();
  let saved=Buffer.alloc(0),patches=0;
  const server=createServer((req,res)=>{
    expect(req.headers.authorization).toBe('Bearer '+credential);
    if(req.url==='/worker/v1/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({protocol_version:2,worker_instance_id:'instance',workspace_id:'workspace',state:'preparing',worker_class:'image',runtime_revision:'seed-pool-v1',preparation:{phase:'preparing'}}));return;}
    expect(req.url).toBe(route);res.setHeader('Tus-Resumable','1.0.0');
    if(req.method==='POST'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:false,upload_path:route}));return;}
    if(req.method==='HEAD'){res.writeHead(200,{'Upload-Offset':'0','Upload-Length':String(bytes.length)});res.end();return;}
    expect(req.method).toBe('PATCH');patches++;
    req.on('data',chunk=>{saved=Buffer.concat([saved,chunk]);req.pause();abort.abort();});req.on('error',()=>{});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  writeFileSync(path.join(paths.config,'worker-connection.json'),JSON.stringify({endpoint:origin,worker_credential:credential,worker_instance_id:'instance',workspace_id:'workspace',protocol_version:2}));
  try{await expect(new WorkerConnection(paths,origin).uploadModel(item,file,abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(patches).toBe(1);expect(saved.length).toBeGreaterThan(0);expect(saved.length).toBeLessThan(bytes.length);}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
