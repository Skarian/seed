import {readJson} from './common.mjs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {preparationClient,PreparationFault} from './preparation-request.mjs';
import {uploadModel} from './preparation-upload.mjs';

// Match the worker's canonical manifest digest, including Python's ASCII JSON.
export function manifestDigest(entries){
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const text=JSON.stringify(canonical([...entries].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))).replace(/[\u0080-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  return createHash('sha256').update(text).digest('hex');
}

export async function prepareWorker(app,options={}){
  if(options.signal)return runPreparation(app,options);
  const controller=new AbortController();
  const stop=()=>controller.abort();
  for(const name of ['SIGINT','SIGTERM'])process.once(name,stop);
  try{return await runPreparation(app,{...options,signal:controller.signal});}
  finally{for(const name of ['SIGINT','SIGTERM'])process.removeListener(name,stop);}
}

async function runPreparation(app,{say=console.error,signal,sleep=delay,upload=uploadModel}){
  const load=file=>import(pathToFileURL(path.join(app.repo,'dist/server',file)).href);
  const cache=await load('model-cache.js'),{settings}=await load('settings.js');
  const entries=(await cache.modelManifest(app.paths)).map(({path,url,sha256,size,route,strength})=>({path,url,sha256,size,...(route?{route,strength}: {})}));
  const saved=await readJson(path.join(app.paths.config,'credentials.json'),{}),env=app.env??process.env;
  const credentials={huggingFaceToken:env.HF_TOKEN||saved.huggingFaceToken||'',civitaiApiToken:env.CIVITAI_API_TOKEN||saved.civitaiApiToken||''};
  const client=await preparationClient(app,{signal}),digest=manifestDigest(entries);
  let revision,attempted=false,pendingPut=credentials,retryCredentials=true,last=0,backoff=1000,attempt=0;
  const wait=ms=>sleep(ms,undefined,{signal});
  while(true){
    signal?.throwIfAborted();
    try {
      await client.checkTunnel();
      await client.verify();
      const current=await client.request('/worker/v1/preparation');
      if(!Number.isSafeInteger(current.revision)||!['waiting','preparing','needs_source','cancelled','ready'].includes(current.state)||!Array.isArray(current.files))
        throw new PreparationFault('Worker returned invalid preparation state.');
      revision??=current.revision;
      if(current.revision!==revision)throw new PreparationFault('Preparation revision changed or was cancelled; start a new command to resume explicitly.');
      if(current.digest!==null&&current.digest!==digest)throw new PreparationFault('Worker has a different model manifest; inspect preparation before continuing.');
      if(current.state==='cancelled'&&attempted)throw new PreparationFault('Preparation was cancelled. Start a new command to resume explicitly.');
      if(current.state==='ready')return {prepared:true,files:entries.length};
      // Read before every repeated PUT. The pinned revision cannot undo a later
      // cancellation, and an already-running intent does not need reissuing.
      if(current.state==='preparing')pendingPut=null;
      if(current.state==='waiting'||pendingPut){
        attempted=true;
        const result=await client.request('/worker/v1/preparation',{method:'PUT',body:{entries,credentials:pendingPut??credentials,revision}});
        retryCredentials=result.credentials_accepted===false;
        pendingPut=null;
      }else if(current.state==='needs_source'){
        if(retryCredentials){retryCredentials=false;pendingPut=credentials;continue;}
        if(!settings(app.paths).localModelCache)throw new PreparationFault('Direct model preparation needs attention. Inspect preparation status; local fallback is disabled.');
        for(const item of entries){
          if(current.files.find(x=>x.path===item.path)?.ready)continue;
          say('Using PC fallback: '+item.path);
          const token=new URL(item.url).hostname==='huggingface.co'?credentials.huggingFaceToken:credentials.civitaiApiToken;
          if(!await cache.cached(app.paths,item))await cache.downloadModel(app.paths,item,token,undefined,undefined,undefined,signal);
          signal?.throwIfAborted();
          const endpoint='/worker/v1/model-uploads/'+createHash('sha256').update(item.path).digest('hex');
          const created=await client.request(endpoint,{method:'POST',body:{}});
          if(created.ready)continue;
          let reportedOffset=-1;
          await upload(client.connection,endpoint,cache.modelFile(app.paths,item),item.size,{signal,onProgress:({offset})=>{
            if(Number.isSafeInteger(offset)&&offset!==reportedOffset){reportedOffset=offset;say(`${item.path}: worker saved offset ${offset}/${item.size}`);}
          }});
        }
        pendingPut={}; // Reconcile verified files after promotion or lost completion.
        continue;
      }
      backoff=1000;
      if(Date.now()-last>30000){say(`${current.phase??current.state}: ${(current.bytes_done/1e9).toFixed(2)}/${(current.bytes_total/1e9).toFixed(2)} GB verified`);last=Date.now();}
      await wait(1000);
    }catch(error){
      signal?.throwIfAborted();
      if(!(error instanceof PreparationFault)||!error.retryable)throw error;
      client.invalidate();
      await client.checkTunnel();
      say(`${new Date().toISOString()} Preparation connection retry ${++attempt} in ${backoff/1000}s: ${error.message}`);
      await wait(backoff);backoff=Math.min(backoff*2,30000);
    }
  }
}
