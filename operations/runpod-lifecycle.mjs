import { readFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { readJson, saveJson, assertIdle } from './common.mjs';
import { waitFor } from './wait.mjs';
import { run, sshArgs } from './vast.mjs';
import { transferModels } from './model-transfer.mjs';

export async function createPod(app, { gpu, maxHourly }) {
  if (!gpu || !Number.isFinite(maxHourly) || maxHourly <= 0) throw Error('Supply --gpu and a positive approved --max-hourly.');
  if (app.state && !app.state.destroyed) throw Error('A recorded or uncertain RunPod rental exists. Reconcile it first.');
  const pods = (await app.api('pods')).pods;
  if (pods.some(p => !['EXITED','ERROR'].includes(p.status))) throw Error('An active RunPod pod already exists.');
  const saved = await readJson(path.join(app.paths.config, 'pod-deployment.json'));
  if (!saved?.templateId || !saved.volumeId) throw Error('Run seed pod-setup first.');
  const volume = await app.api(`network-volumes/${encodeURIComponent(saved.volumeId)}`);
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
  app.state = { attempt_at:new Date().toISOString(), image:app.image, destroyed:false, hourly:price };
  await saveJson(app.stateFile,app.state);
  const pod = await app.api('pods','POST',{
    name:'seed', templateId:saved.templateId, image:app.image,
    gpu:{id:gpu,count:1,minCudaVersion:'13.0'}, dataCenterIds:[volume.dataCenter],
    mounts:{network:[{volumeId:saved.volumeId,path:'/workspace'}]},
    ports:['8080/http','8888/http','22/tcp'], env:{PUBLIC_KEY:publicKey},
    args:`bash -lc 'mkdir -p /root/.ssh /run/sshd; printf "%s\\n" "$PUBLIC_KEY" > /root/.ssh/authorized_keys; chmod 700 /root/.ssh; chmod 600 /root/.ssh/authorized_keys; /usr/sbin/sshd; exec /opt/venv/bin/python -m worker.run'`,
  });
  if (!pod?.id) throw Error('Creation outcome is uncertain. Reconcile before retrying.');
  app.state.pod_id=pod.id;
  await saveJson(app.stateFile,app.state);
  return {pod_id:pod.id,hourly:pod.cost,status:pod.status};
}

export async function lifecycle(app, command, id = app.state?.pod_id) {
  if(command==='reconcile') {
    if(!app.state || app.state.destroyed)return {reconciled:true};
    const pods=(await app.api('pods')).pods;
    if(app.state.pod_id && pods.some(p=>p.id===app.state.pod_id)) return {reconciled:true,pod_id:app.state.pod_id};
    if(!app.state.pod_id && pods.length)throw Error('Uncertain rental: inspect existing pods before retrying.');
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
    const pod=await app.api(`pods/${id}`), direct=pod.ssh?.direct;
    if(!direct || direct.username!=='root')throw Error('Direct root SSH is not ready.');
    const dir=path.join(app.paths.config,'seed-runpod');
    await transferModels(app.repo,app.paths,sshArgs({public_ipaddr:direct.host,ports:{'22/tcp':[{HostPort:direct.port}]}},path.join(dir,'ssh-key'),path.join(dir,'known-hosts')));
    return {prepared:true,pod_id:id};
  }
  if(command==='destroy') {
    if(app.state.paired)await app.safe(id);
    else assertIdle(await app.local('GET','/api/v1/studio'));
    await app.api(`pods/${id}`,'DELETE');
    await waitFor(async()=>!(await app.api('pods')).pods.some(p=>p.id===id),{timeout:60000});
    app.state.destroyed=true;await saveJson(app.stateFile,app.state);
    return {confirmed:'destroy',pod_id:id,network_volume_retained:true};
  }
  throw Error('Unknown lifecycle command.');
}
