// Shared worker protocol. Providers retain their own discovery, pricing and SSH endpoints.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {readJson,saveJson,requestJson,assertIdle} from './common.mjs';
import {background,freePort} from './ssh.mjs';
import {waitFor} from './wait.mjs';
import {enrollmentKey,tailscaleOrigin} from './tailscale.mjs';

export const workerOrigin='http://127.0.0.1:18080';
const controlPaths=app=>({config:path.join(app.paths.config,'worker-tunnel')});
const connectionFile=app=>path.join(app.paths.config,'worker-connection.json');
async function lifecycle(app){return app.lifecycle??import(pathToFileURL(path.join(app.repo,'dist/server/lifecycle.js')).href);}
export async function stopTunnel(app){
  const control=await lifecycle(app), paths=controlPaths(app);
  await control.control(paths,'stop');
  for(let i=0;i<30;i++){if(!await control.control(paths,'status'))return;await delay(100);}
  throw Error('Existing SSH tunnel did not stop. Inspect the private tunnel log.');
}
export async function startTunnel(app,ssh){
  await stopTunnel(app);
  for(const port of [18080,18888])await (app.checkPort??freePort)(port);
  const args=[...ssh],target=args.pop();
  args.push('-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',
    '-L','127.0.0.1:18080:127.0.0.1:8080','-L','127.0.0.1:18888:127.0.0.1:8888',target);
  const paths=controlPaths(app);await mkdir(paths.config,{recursive:true,mode:0o700});
  const launched=await (app.startBackground??background)(fileURLToPath(new URL('./tunnel.mjs',import.meta.url)),[app.repo,paths.config,...args],path.join(paths.config,'tunnel.log'));
  const control=await lifecycle(app);
  let registered=false;
  await waitFor(async()=>{
    if(!await control.control(paths,'status')){
      if(registered||launched?.exitCode!=null)throw Error('SSH stopped. Inspect worker-tunnel/tunnel.log for the key, host identity or port error.');
      return null;
    }
    registered=true;
    try {const r=await (app.fetcher??fetch)(workerOrigin+'/worker/v1/status',{redirect:'error',signal:AbortSignal.timeout(5000)});await r.body?.cancel();if(r.status===401||r.ok)return true;}catch{}
    return null;
  });
}
export async function workerRequest(app,route,options={}){
  const connection=await readJson(connectionFile(app));
  if(!app.state?.paired_worker||connection?.worker_instance_id!==app.state.paired_worker)throw Error('Connect the recorded worker first.');
  return requestJson(connection.endpoint+route,{...options,headers:{...options.headers,Authorization:'Bearer '+connection.worker_credential},fetcher:app.fetcher??fetch});
}
export async function cancelUnusedPreparation(app){
  const preparation=await workerRequest(app,'/worker/v1/preparation');
  if(preparation.state==='ready')return false;
  // Explicit teardown owns this cancellation; disconnected or used workers never
  // get an exception to normal queue/output reconciliation.
  await app.local('POST','/api/v1/queue/pause',{});
  assertIdle(await app.local('GET','/api/v1/studio'));
  let cancelled;
  try {cancelled=await workerRequest(app,'/worker/v1/preparation/cancel',{method:'POST',body:{}});}
  catch(error){if(error.provider?.status===409)return false;throw error;}
  const connection=await readJson(connectionFile(app)),proof=cancelled.unused_worker;
  return cancelled.state==='cancelled'&&proof?.worker_instance_id===connection?.worker_instance_id&&proof?.workspace_id===connection?.workspace_id&&typeof proof?.workspace_id==='string';
}
export async function connectWorker(app,{ssh,secret,route=app.state.route??'ssh',reconnect=false}={}){
  if(!['ssh','tailscale'].includes(route))throw Error('Choose --route ssh or tailscale.');
  let connection=await readJson(connectionFile(app));
  const paired=Boolean(app.state.paired_worker&&connection?.worker_instance_id===app.state.paired_worker);
  if(reconnect&&!paired)throw Error('Reconnect requires the existing pairing to this recorded worker.');
  if(!paired)assertIdle(await app.local('GET','/api/v1/studio'));
  if(route==='tailscale'&&paired&&app.state.tailscale_endpoint){
    await app.local('PUT','/api/v1/connection/route',{endpoint:app.state.tailscale_endpoint});
    await stopTunnel(app);
  }else{
    await startTunnel(app,typeof ssh==='function'?await ssh():ssh);
    if(paired){
      await app.local('PUT','/api/v1/connection/route',{endpoint:workerOrigin});
    }else{
      const response=await (app.fetcher??fetch)(workerOrigin+'/worker/v1/unlock',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Origin:workerOrigin,'Content-Type':'application/json'},body:JSON.stringify({pairing_secret:secret}),
      });
      if(!response.ok){await response.body?.cancel();throw Error('Worker unlock failed; inspect the launch configuration.');}
      const cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join(';');await response.body?.cancel();
      const code=await requestJson(workerOrigin+'/worker/v1/pairing-codes',{method:'POST',body:{},headers:{Origin:workerOrigin,Cookie:cookie},fetcher:app.fetcher??fetch});
      await app.local('PUT','/api/v1/connection',{connection_code:code.connection_code});
      connection=await readJson(connectionFile(app));
      if(!connection?.worker_instance_id)throw Error('Pairing was not saved locally.');
      app.state.paired_worker=connection.worker_instance_id;
      app.state.paired=true;app.state.route='ssh';
      await saveJson(app.stateFile,app.state);
    }
    if(route==='tailscale'){
      let network=await workerRequest(app,'/worker/v1/network');
      if(['disabled','needs_enrollment'].includes(network.state)){
        await workerRequest(app,'/worker/v1/network',{method:'POST',body:{auth_key:await enrollmentKey(app.paths,{fetcher:app.fetcher??fetch,env:app.env??process.env})}});
      }
      network=await waitFor(async()=>{const n=await workerRequest(app,'/worker/v1/network');if(n.state==='needs_enrollment')throw Error('Worker enrollment stopped; collect its Tailscale log.');return n.state==='ready'?n:null;});
      const endpoint=tailscaleOrigin(network.address);
      await app.local('PUT','/api/v1/connection/route',{endpoint});
      app.state.tailscale_endpoint=endpoint;app.state.tailscale_peer=network.peer_id;
      await stopTunnel(app);
    }
  }
  app.state.route=route;await saveJson(app.stateFile,app.state);
  return {connected:true,url:app.origin,route,pairing:paired?'preserved':'created'};
}
