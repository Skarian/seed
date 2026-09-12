import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {saveJson,readJson} from './common.mjs';
import {providerError} from './provider-error.mjs';

export async function vastLogs(app,{daemon=false,sleep=delay}={}) {
  const id=app.state?.instance_id;
  if(!Number.isSafeInteger(id))throw Error('No recorded instance to collect logs from.');
  const file=path.join(app.work,'diagnostics',`${id}-${Date.now()}-${daemon?'daemon':'container'}.json`);
  const credentials=await app.credentials();
  const worker=await readJson(app.secretFile(),{});
  const secrets={body:{env:{...credentials,...worker}},headers:{Authorization:`Bearer ${app.env.VAST_API_KEY || credentials.vastApiKey || ''}`}};
  const clean=line=>providerError({status:200,headers:new Headers()},{detail:line},secrets).provider.detail;
  try {
    const result=await app.api('PUT',`/api/v0/instances/request_logs/${id}/`,{tail:'200',...(daemon?{daemon_logs:'true'}:{})});
    if(!result.success || !result.result_url)throw Error('Provider did not return a log location.');
    const url=new URL(result.result_url);
    if(url.protocol!=='https:' || !(url.hostname==='s3.amazonaws.com' || url.hostname.endsWith('.amazonaws.com')))throw Error('Unexpected provider log destination.');
    for(let attempt=0;attempt<15;attempt++) {
      const response=await app.fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(10000)});
      if(response.ok) {
        let text='';let truncated=false;
        for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>65536){text=text.slice(0,65536);truncated=true;break;}}
        const lines=text.split(/\r?\n/).filter(Boolean).map(clean);
        const record={instance_id:id,daemon,collected_at:new Date().toISOString(),truncated,lines};
        await saveJson(file,record);
        return {...record,file};
      }
      await response.body?.cancel();
      if(![403,404].includes(response.status))throw Error(`Log download returned HTTP ${response.status}.`);
      await sleep(1000);
    }
    throw Error('Provider logs were not available within the collection window.');
  }catch(error){
    await saveJson(file,{instance_id:id,daemon,collected_at:new Date().toISOString(),collection_error:clean(error.message)});
    throw Error(`Log collection failed; diagnostic saved to ${file}.`);
  }
}
