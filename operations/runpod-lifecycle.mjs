import { readFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { podEnvironment } from './runpod-secrets.mjs';
import { readJson, saveJson, assertIdle } from './common.mjs';
import { waitFor } from './wait.mjs';
import { run } from './ssh.mjs';
import { prepareWorker } from './preparation.mjs';
import { stopTunnel, cancelUnusedPreparation } from './connection.mjs';

export function podRequest({gpu, image, disk, datacenters = [], publicKey, environment}) {
  if (!Number.isSafeInteger(disk) || disk < 150) throw Error('Use at least 150 GB of disposable disk for models and working space.');
  return {
    name:'seed', image, cloud:'SECURE', disk,
    gpu:{id:gpu,count:1,minCudaVersion:'13.0'},
    ...(datacenters.length ? {dataCenterIds:datacenters} : {}),
    ports:['22/tcp'],
    env:{...environment,PUBLIC_KEY:publicKey,SEED_START_SSH:'1',SEED_TRANSPORT:'ssh'},
  };
}

export async function createPod(app, { gpu, maxHourly, disk = 180, datacenters = [] }) {
  if (!gpu || !Number.isFinite(maxHourly) || maxHourly <= 0) throw Error('Supply --gpu and a positive approved --max-hourly.');
  if (app.state && !app.state.destroyed) throw Error('A recorded or uncertain RunPod rental exists. Reconcile it first.');
  const pods = (await app.api('pods')).pods;
  if (pods.some(p => !['EXITED','ERROR'].includes(p.status))) throw Error('An active RunPod pod already exists.');
  if (!Number.isSafeInteger(disk) || disk < 150) throw Error('Use at least 150 GB of disposable disk.');
  const catalog = await app.catalog();
  const selected = catalog.gpus?.find(g => g.id === gpu);
  // Refuse to guess a price: catalog schema is inspected by the caller first.
  const price = selected?.price?.secure;
  if (!Number.isFinite(price) || price > maxHourly) throw Error('Cannot confirm this GPU fits the hourly limit from the catalog.');
  const dir = path.join(app.paths.config, 'seed-runpod');
  await mkdir(dir, {recursive:true, mode:0o700});
  const key = path.join(dir,'ssh-key');
  try { await access(key); } catch { await run('ssh-keygen',['-q','-t','ed25519','-f',key,'-N','','-C','seed-runpod']); }
  const publicKey = (await readFile(key+'.pub','utf8')).trim();
  const request = podRequest({gpu,image:app.image,disk,datacenters,publicKey,environment:podEnvironment(app.paths)});
  app.state = { attempt_at:new Date().toISOString(), image:app.image, destroyed:false, hourly:price, disk_gb:disk, placement:datacenters.length?datacenters:'global', existing_pod_ids:pods.map(p=>p.id) };
  await saveJson(app.stateFile,app.state);
  const pod = await app.api('pods','POST',request);
  if (!pod?.id) throw Error('Creation outcome is uncertain. Reconcile before retrying.');
  app.state.pod_id=pod.id;
  await saveJson(app.stateFile,app.state);
  return {pod_id:pod.id,hourly:pod.cost,quoted_gpu_hourly:price,status:pod.status,datacenter:pod.dataCenterId,storage:{kind:'disposable',disk_gb:disk},image:app.image};
}

export async function lifecycle(app, command, id = app.state?.pod_id) {
  if(command==='reconcile') {
    if(!app.state || app.state.destroyed)return {reconciled:true};
    const pods=(await app.api('pods')).pods;
    if(app.state.pod_id && pods.some(p=>p.id===app.state.pod_id)) return {reconciled:true,pod_id:app.state.pod_id};
    const candidates=pods.filter(p=>app.state.existing_pod_ids
      ? !app.state.existing_pod_ids.includes(p.id)
      : !p.createdAt || !Number.isFinite(Date.parse(p.createdAt)) || Date.parse(p.createdAt)>=Date.parse(app.state.attempt_at)-60000);
    if(!app.state.pod_id && candidates.length) {
      delete app.state.absent_since;await saveJson(app.stateFile,app.state);
      throw Error('Uncertain rental: inspect newly appearing pods before retrying.');
    }
    if(!app.state.absent_since) {app.state.absent_since=Date.now();await saveJson(app.stateFile,app.state);return {reconciled:false,next:'Repeat after 30 seconds.'};}
    if(Date.now()-app.state.absent_since<30000)return {reconciled:false,next:'Repeat after 30 seconds.'};
    app.state.destroyed=true;await saveJson(app.stateFile,app.state);return {reconciled:true};
  }
  if(!id || id!==app.state?.pod_id || app.state.destroyed)throw Error('Command requires the recorded active Seed pod.');
  if(command==='wait')return waitFor(async()=>{
    const pod=await app.api(`pods/${id}`);
    if(pod.status==='ERROR')throw Error('RunPod startup failed. Inspect provider logs, then destroy the failed pod.');
    return pod.status==='RUNNING' && pod.ssh?.direct ? {pod_id:id,ready_for_preparation:true}:null;
  });
  if(command==='prepare') {
    await app.connect(id);
    return prepareWorker(app);
  }
  if(command==='destroy') {
    if(app.state.paired && !await cancelUnusedPreparation(app))await app.safe(id);
    else assertIdle(await app.local('GET','/api/v1/studio'));
    await app.api(`pods/${id}`,'DELETE');
    await waitFor(async()=>!(await app.api('pods')).pods.some(p=>p.id===id),{timeout:60000});
    app.state.destroyed=true;await saveJson(app.stateFile,app.state);
    await stopTunnel(app);
    return {confirmed:'destroy',pod_id:id,disposable_disk_deleted:true};
  }
  throw Error('Unknown lifecycle command.');
}
