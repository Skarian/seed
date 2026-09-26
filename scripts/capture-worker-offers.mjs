// Read-only catalog capture. No pool lifecycle or account-history endpoints.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const serverRoot=path.resolve(process.env.SEED_QA_SERVER_ROOT??'dist');
const {createProviders}=await import(pathToFileURL(path.join(serverRoot,'server/pool-providers.js')));
const {resolvePaths}=await import(pathToFileURL(path.join(serverRoot,'server/storage.js')));
const root=path.resolve(process.env.SEED_OFFERS_ROOT??'.local/worker-offers-atlas');
const exchanges=[];
const fetcher=async(url,init)=>{
  const u=new URL(url),method=init?.method??'GET';
  if(!((u.origin==='https://api.runpod.io'&&u.pathname==='/v2/catalog/gpus'&&method==='GET')||
    (u.origin==='https://console.vast.ai'&&u.pathname==='/api/v0/bundles/'&&method==='POST')))throw Error('Only catalog searches are allowed.');
  const response=await fetch(url,init);
  const body=await response.clone().json().catch(()=>null);
  exchanges.push({provider:u.hostname,status:response.status,query:u.search,search:init?.body?JSON.parse(init.body):undefined,response:body});
  return response;
};
const providers=createProviders(resolvePaths(),fetcher);
const releases=JSON.parse(await readFile('worker/releases.json','utf8'));
const captured={captured_at:new Date().toISOString(),image:[],video:[]};
for(const role of ['image','video']){
  const manifest=JSON.parse(await readFile(`worker/models-${role}.json`,'utf8'));
  for(const provider of ['vast','runpod']){
    const release=releases[role];
    const results=await providers[provider].offers(role,release);
    captured[role].push(...results.map(({offer})=>({...offer,model_download_bytes:manifest.reduce((n,f)=>n+f.size,0)})));
  }
}
await mkdir(root,{recursive:true});
await writeFile(path.join(root,'live-offers.json'),JSON.stringify(captured,null,2));
await writeFile(path.join(root,'catalog-exchanges.json'),JSON.stringify(exchanges,null,2));
console.log(JSON.stringify({captured_at:captured.captured_at,counts:Object.fromEntries(['image','video'].map(role=>[role,Object.fromEntries(['vast','runpod'].map(p=>[p,captured[role].filter(o=>o.provider===p).length]))])),requests:exchanges.length,rentals:0}));
