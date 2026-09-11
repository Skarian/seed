import path from 'node:path';
import {readJson} from './common.mjs';
import {providerError} from './provider-error.mjs';

export async function podLogs(app, id=app.state?.pod_id) {
  if(!/^[a-z0-9]+$/.test(id??''))throw Error('Supply a pod ID.');
  const credentials=await readJson(path.join(app.paths.config,'credentials.json'),{});
  const deployment=await readJson(path.join(app.paths.config,'pod-deployment.json'),{});
  const headers={Authorization:`Bearer ${app.env.RUNPOD_API_KEY || credentials.runpodApiKey}`};
  const secrets={body:{env:{...credentials,...deployment}},headers};
  const response=await app.fetcher(`https://api.runpod.io/v2/pods/${id}/logs?tail=50`,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw providerError(response,await response.json().catch(()=>null),secrets);
  let text='';
  try { for await(const chunk of response.body) {text+=Buffer.from(chunk).toString('utf8');if(text.length>=65536)break;} }
  catch(error) { if(error.name!=='AbortError' && error.name!=='TimeoutError')throw error; }
  const lines=text.split('\n').filter(line=>line.startsWith('data:')).flatMap(line=>{
    try { const value=JSON.parse(line.slice(5));return [{source:value.source,ts:value.ts,line:providerError({status:200,headers:new Headers()},{detail:value.line},secrets).provider.detail}]; }
    catch {return [];}
  });
  return {pod_id:id,lines:lines.slice(-50),window_seconds:10,truncated:lines.length>50};
}
