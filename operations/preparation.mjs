import {readJson} from './common.mjs';
import {workerRequest} from './connection.mjs';
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Upload} from 'tus-js-client';

export async function prepareWorker(app,{say=console.error}={}){
  const load=file=>import(pathToFileURL(path.join(app.repo,'dist/server',file)).href);
  const cache=await load('model-cache.js'),{settings}=await load('settings.js');
  const entries=(await cache.modelManifest(app.paths)).map(({path,url,sha256,size,route,strength})=>({path,url,sha256,size,...(route?{route,strength}: {})}));
  const saved=await readJson(path.join(app.paths.config,'credentials.json'),{}),env=app.env??process.env;
  const credentials={huggingFaceToken:env.HF_TOKEN||saved.huggingFaceToken||'',civitaiApiToken:env.CIVITAI_API_TOKEN||saved.civitaiApiToken||''};
  let current=await workerRequest(app,'/worker/v1/preparation');
  let result=await workerRequest(app,'/worker/v1/preparation',{method:'PUT',body:{entries,credentials,revision:current.revision}});
  let retryCredentials=result.credentials_accepted===false;
  let last=0;
  while(true){
    current=await workerRequest(app,'/worker/v1/preparation');
    if(current.state==='ready')return {prepared:true,files:entries.length};
    if(current.state==='cancelled')throw Error('Preparation was cancelled. Run prepare again to explicitly resume.');
    if(current.state==='needs_source'){
      if(retryCredentials){retryCredentials=false;await workerRequest(app,'/worker/v1/preparation',{method:'PUT',body:{entries,credentials,revision:current.revision}});continue;}
      if(!settings(app.paths).localModelCache)throw Error('Direct model preparation needs attention. Inspect preparation status; local fallback is disabled.');
      for(const item of entries){
        if(current.files.find(x=>x.path===item.path)?.ready)continue;
        say('Using PC fallback: '+item.path);
        const token=new URL(item.url).hostname==='huggingface.co'?credentials.huggingFaceToken:credentials.civitaiApiToken;
        if(!await cache.cached(app.paths,item))await cache.downloadModel(app.paths,item,token);
        const endpoint='/worker/v1/model-uploads/'+createHash('sha256').update(item.path).digest('hex');
        const created=await workerRequest(app,endpoint,{method:'POST',body:{}});
        if(created.ready)continue;
        const connection=JSON.parse(await readFile(path.join(app.paths.config,'worker-connection.json'),'utf8'));
        const input=createReadStream(cache.modelFile(app.paths,item));
        try {await new Promise((resolve,reject)=>{
          new Upload(input,{uploadUrl:connection.endpoint+endpoint,uploadSize:item.size,chunkSize:8*1024*1024,retryDelays:[0,1000,3000,5000],
            headers:{Authorization:'Bearer '+connection.worker_credential},onSuccess:resolve,onError:()=>reject(Error('PC fallback interrupted. Run prepare again to resume the same upload.'))}).start();
        });}finally{input.destroy();}
      }
      // Reconcile verified files after a lost completion/promotion response.
      await workerRequest(app,'/worker/v1/preparation',{method:'PUT',body:{entries,credentials:{},revision:current.revision}});
    }
    if(Date.now()-last>30000){say(`${current.phase}: ${(current.bytes_done/1e9).toFixed(2)}/${(current.bytes_total/1e9).toFixed(2)} GB verified`);last=Date.now();}
    await delay(1000);
  }
}
