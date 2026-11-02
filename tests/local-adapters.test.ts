import {it,expect,vi} from 'vitest';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {prepareLocalAdapters} from '../server/local-adapters.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import type {LoraSourceManifest} from '../shared/loras.js';

async function fixture(run:(options:any)=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/adapter-process-'));
  const paths=resolvePaths(root);prepareStorage(paths);
  writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({civitaiKey:'fixture-private-token'}));
  const sha256='a'.repeat(64),source:LoraSourceManifest={id:'a',name:'Fixture',revision:sha256,sha256,route:'image',path:`loras/seed-${sha256}.safetensors`,
    url:'https://civitai.com/api/download/models/2?fileId=3',size_bytes:100,source:{provider:'civitai',model_id:1,version_id:2,file_id:3,url:'https://civitai.com/api/download/models/2',sha256,size_bytes:100}};
  try{await run({python:process.execPath,packageRoot:root,workspace:path.join(root,'workspace'),paths,sources:[source]});}
  finally{rmSync(root,{recursive:true,force:true});}
}
const processFixture=(code:string)=>(python:string,_args:string[],options:any)=>spawn(python,['-e',`
  let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
    const body=JSON.parse(input);const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');${code}
  });`],options);
it('passes credentials only through stdin, reports progress and verifies every selected adapter',()=>fixture(async options=>{
  const progress=vi.fn();
  const result=await prepareLocalAdapters({...options,onProgress:progress},processFixture(`
    if(body.credentials.civitaiApiToken!=='fixture-private-token'||JSON.stringify(process.env).includes('fixture-private-token'))process.exit(2);
    if(!body.merge_adapters)process.exit(3);
    const item=body.entries[0];emit({path:item.path,state:'downloading',bytes_done:50});
    emit({path:item.path,state:'ready',ready:true});
    emit({complete:true,installed_loras:[{filename:item.path.slice(6),sha256:item.sha256,routes:['image']}]});`));
  expect(result).toHaveLength(1);expect(progress.mock.calls.map(call=>call[0].bytes_done)).toContain(50);
  expect(progress.mock.lastCall![0].bytes_done).toBe(100);
}));
it('prepares one file for both video routes',()=>fixture(async options=>{
  const fl={...options.sources[0],route:'fl' as const},ref={...fl,id:'b',route:'ref' as const};
  const inventory=await prepareLocalAdapters({...options,sources:[fl,ref]},processFixture(`
    const item=body.entries[0];if(body.entries.length!==1||item.routes.join()!=='fl,ref')process.exit(4);
    emit({path:item.path,state:'ready',ready:true});
    emit({complete:true,installed_loras:[{filename:item.path.slice(6),sha256:item.sha256,routes:item.routes}]});`));
  expect(inventory[0]!.routes).toEqual(['fl','ref']);
}));
it('reports download failures without leaking provider diagnostics or accepting partial inventories',()=>fixture(async options=>{
  await expect(prepareLocalAdapters(options,processFixture(`emit({path:body.entries[0].path,state:'needs_source',http_status:401,diagnostic_error:'fixture-private-token'});`))).rejects.toThrow('HTTP 401');
  await expect(prepareLocalAdapters(options,processFixture(`emit({complete:true,installed_loras:[]});`))).rejects.toThrow('every selected LoRA');
}));
it('cancels the CPU download and waits for process exit',()=>fixture(async options=>{
  const controller=new AbortController();let child:ReturnType<typeof spawn>|undefined;
  const pending=prepareLocalAdapters({...options,signal:controller.signal},(python,args,opts)=>{
    child=processFixture('setInterval(()=>{},1000);')(python,args,opts);controller.abort();return child as ChildProcessWithoutNullStreams;
  });
  await expect(pending).rejects.toThrow('cancelled');expect(child?.exitCode!==null||child?.signalCode!==null).toBe(true);
}));
it('does not launch a downloader when credentials are unreadable or sources are unpinned',()=>fixture(async options=>{
  const launch=vi.fn();writeFileSync(path.join(options.paths.config,'credentials.json'),'invalid');
  await expect(prepareLocalAdapters(options,launch)).rejects.toThrow('credentials');expect(launch).not.toHaveBeenCalled();
  options.sources[0].path='../adapter';await expect(prepareLocalAdapters(options,launch)).rejects.toThrow('pinned');expect(launch).not.toHaveBeenCalled();
}));
