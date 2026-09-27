import {it, expect, vi} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {openDatabase} from '../server/db.js';
import {resolvePaths, prepareStorage} from '../server/storage.js';
import {Diagnostics} from '../server/diagnostics.js';
import {ProviderLogs} from '../server/provider-logs.js';
import type {RentalRecord} from '../server/pool-contracts.js';
async function fixture(fn: (f: any) => Promise<void>) {
  mkdirSync('.local/tests', {recursive:true}); const root=mkdtempSync(path.resolve('.local/tests/provider-logs-')), paths=resolvePaths(root);
  prepareStorage(paths); const db=openDatabase(paths.data);
  writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({vastApiKey:'fixture-key',runpodApiKey:'fixture-key'}));
  try { await fn({paths,db,d:new Diagnostics(db,paths)}); } finally { db.close(); rmSync(root,{recursive:true,force:true}); }
}
const w=(provider:string)=>({id:'worker',provider,resource:{id:'rental'}} as RentalRecord);
const signal=()=>new AbortController().signal;
const sse=(id:string,line:string,source='system')=>`id: ${id}\r\ndata: ${JSON.stringify({ts:'2026-09-25T01:00:00Z',source,line})}\r\n\r\n`;

it('keeps Vast daemon logs even after SSH becomes available',()=>fixture(async({paths,d})=>{
  const modes:string[]=[];
  const fetcher=vi.fn(async(input:any,init:any)=>{
    if(String(input).includes('request_logs')){modes.push(JSON.parse(init.body).daemon_logs);return new Response(JSON.stringify({result_url:'https://fixture.s3.amazonaws.com/log.txt'}));}
    return new Response('Pull complete');
  });
  const logs=new ProviderLogs(paths,d,fetcher as typeof fetch),worker=w('vast');
  expect((await logs.collect(worker,signal())).text).toBe('Pull complete');
  worker.resource!.ssh={host:'test',port:22,user:'root'}; await logs.collect(worker,signal());
  expect(modes).toEqual(['true','true']); expect(fetcher.mock.calls[1]![1].headers).toBeUndefined();
}));
it('reads the observed RunPod system stream and requests only system logs',()=>fixture(async({paths,d})=>{
  const captured=readFileSync(new URL('./fixtures/provider-synthetic/runpod-startup.sse',import.meta.url),'utf8');
  const fetcher=vi.fn(async()=>new Response(captured));
  const result=await new ProviderLogs(paths,d,fetcher as typeof fetch).collect(w('runpod'),signal());
  expect(result.text).toContain('still fetching image'); expect(result.source).toBe('RunPod startup');
  expect(String((fetcher.mock.calls[0] as any)[0])).toContain('source=system');
}));
it('handles split UTF-8/SSE frames, excludes container output, and resumes complete frames only',()=>fixture(async({paths,d})=>{
  const raw=new TextEncoder().encode(sse('cursor/1','Checking 模型')+sse('cursor/2','PRIVATE_REQUEST','container')+sse('cursor/3','Next')+'id: cursor/4\ndata: {');
  const stream=new ReadableStream({start(controller){for(let i=0;i<raw.length;i+=3)controller.enqueue(raw.slice(i,i+3));controller.close();}});
  const fetcher=vi.fn(async()=>new Response(stream));
  const logs=new ProviderLogs(paths,d,fetcher as typeof fetch), result=await logs.collect(w('runpod'),signal(),'cursor/0');
  expect(result.text).toContain('模型'); expect(result.text).not.toContain('PRIVATE_REQUEST'); expect(result.cursor).toBe('cursor/3');
  expect((fetcher.mock.calls[0] as any)[1].headers['Last-Event-ID']).toBe('cursor/0');
}));
it('bounds oversized chunks and visible tails',()=>fixture(async({paths,d})=>{
  const raw=Array.from({length:3000},(_,i)=>sse('id/'+i,'line '+i)).join('');
  const fetcher=vi.fn(async()=>new Response(raw));
  const result=await new ProviderLogs(paths,d,fetcher as typeof fetch).collect(w('runpod'),signal());
  expect(result.text.length).toBeLessThanOrEqual(8192);expect(result.text.split('\n').length).toBeLessThanOrEqual(100); expect(result.truncated).toBe(true);
  expect(result.text).not.toContain('line 2999');
}));
it('redacts secrets and strips terminal controls before returning text',()=>fixture(async({paths,d})=>{
  mkdirSync(path.join(paths.config,'workers','worker'),{recursive:true});
  writeFileSync(path.join(paths.config,'workers','worker','bootstrap.json'),JSON.stringify({pairing_secret:'private-pairing-test'}));
  const fetcher=vi.fn(async()=>new Response(sse('1','\x1b[31mfailed private-pairing-test Bearer abcdefghi\x1b[0m')));
  const result=await new ProviderLogs(paths,d,fetcher as typeof fetch).collect(w('runpod'),signal());
  expect(result.text).toContain('failed');expect(result.text).not.toMatch(/private-pairing-test|abcdefghi|\x1b/);
}));
it('rejects untrusted export destinations without fetching them',()=>fixture(async({paths,d})=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({result_url:'http://127.0.0.1/private'})));
  await expect(new ProviderLogs(paths,d,fetcher as typeof fetch).collect(w('vast'),signal())).rejects.toThrow('invalid startup-log export');
  expect(fetcher).toHaveBeenCalledTimes(1);
}));
it('distinguishes pending Vast objects from provider authorization errors',()=>fixture(async({paths,d})=>{
  let reads=0;
  const fetcher=vi.fn(async(input:any)=>String(input).includes('request_logs')?new Response(JSON.stringify({result_url:'https://fixture.s3.amazonaws.com/log.txt'})):
    ++reads===1?new Response('AccessDenied',{status:403}):new Response('Pull complete'));
  expect((await new ProviderLogs(paths,d,fetcher as typeof fetch).collect(w('vast'),signal())).text).toBe('Pull complete');
  expect(reads).toBe(2);
  const denied=new ProviderLogs(paths,d,vi.fn(async()=>new Response('private response',{status:403})) as typeof fetch);
  await expect(denied.collect(w('vast'),signal())).rejects.toMatchObject({auth:true});
}));
it('preserves rate-limit guidance without echoing provider bodies',()=>fixture(async({paths,d})=>{
  const logs=new ProviderLogs(paths,d,vi.fn(async()=>new Response('PRIVATE_RESPONSE',{status:429,headers:{'Retry-After':'90'}})) as typeof fetch);
  await expect(logs.collect(w('runpod'),signal())).rejects.toMatchObject({retryAfterMs:90000,auth:false});
}));
it('cancels pending export waits immediately',()=>fixture(async({paths,d})=>{
  const controller=new AbortController();
  const fetcher=vi.fn(async(input:any)=>{
    if(String(input).includes('request_logs'))return new Response(JSON.stringify({result_url:'https://fixture.s3.amazonaws.com/log.txt'}));
    controller.abort();return new Response('Pending',{status:404});
  });
  await expect(new ProviderLogs(paths,d,fetcher as typeof fetch).collect(w('vast'),controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(fetcher).toHaveBeenCalledTimes(2);
}));
it('applies one overall deadline to an unfinished Vast export request',()=>fixture(async({paths,d})=>{
  vi.useFakeTimers();
  const timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('Timed out','TimeoutError')),ms);return c.signal;});
  try {
    const fetcher=vi.fn((input:any,init:any)=>String(input).includes('request_logs')
      ? new Promise<Response>(resolve=>setTimeout(()=>resolve(new Response(JSON.stringify({result_url:'https://fixture.s3.amazonaws.com/log.txt'}))),10000))
      : new Promise<Response>((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})));
    const pending=new ProviderLogs(paths,d,fetcher as typeof fetch).collect(w('vast'),signal());
    const check=expect(pending).rejects.toMatchObject({name:'TimeoutError'});await vi.advanceTimersByTimeAsync(15001);await check;
    expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true);
  } finally {timeout.mockRestore();vi.useRealTimers();}
}));
