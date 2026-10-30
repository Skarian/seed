import React,{useEffect,useState} from 'react';
import type {LocalWorkerView} from '../shared/local-worker.js';
import {LOCAL_MODEL_IDLE_MINUTES} from '../shared/local-worker.js';
import {poolApi,useWorkerPool} from './hooks/use-worker-pool.js';
import {ConfirmDialog} from './confirm-dialog.js';
type Status={worker:LocalWorkerView|null;setup:{supported:boolean;installed:boolean;state:string;phase:string;error?:string;bytes_done:number;bytes_total:number}};
const labels:Record<string,string>={sleeping:'Ready on demand',disabled:'Off',starting:'Starting',preparing:'Loading models',generating:'Generating',saving:'Saving output',recovering:'Recovering output',ready:'Ready',needs_attention:'Needs attention',releasing:'Stopping'};
export function LocalWorkerCard(){
  const pool=useWorkerPool();const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const [cleanup,setCleanup]=useState<'models'|'runtime'|'all'|null>(null);
  useEffect(()=>{let disposed=false;const load=async()=>{try{const value=await poolApi<Status>('/local');if(!disposed){setStatus(value);setError('');}}catch(error){if(!disposed)setError((error as Error).message);}};void load();const timer=setInterval(()=>void load(),2000);return()=>{disposed=true;clearInterval(timer);};},[]);
  async function action(action:string){setPending(true);setError('');try{await poolApi(action==='setup'?'/local/setup':'/local/actions',action==='setup'?{}:{action});setStatus(await poolApi<Status>('/local'));pool.refresh();}catch(error){setError((error as Error).message);}finally{setPending(false);}}
  const worker=status?.worker,setup=status?.setup;
  const installed=setup?.installed;
  return <section className="local-worker-card" aria-label="This PC worker">
    <div className="local-worker-heading"><h3>This PC</h3><span>{worker?labels[worker.state]??worker.state:'Off'}</span></div>
    <p>{worker?.gpu??'Use your own GPU for supported requests.'}</p>
    {setup?.supported===false?<p>Native local workers currently require Windows.</p>:<>
      <p className="pool-running-note">Models load when needed and unload {LOCAL_MODEL_IDLE_MINUTES} minutes after the last output is saved.</p>
      {!installed&&<p>{setup?`${Math.ceil(setup.bytes_total/1024**3)} GiB of models. Allow 140 GiB of free space for initial setup.`:'Checking local setup…'}</p>}
      {setup?.state==='running'&&<div role="status"><p>{setup.phase}</p><progress max={setup.bytes_total||1} value={setup.bytes_done}/><p>{(setup.bytes_done/1024**3).toFixed(1)} / {(setup.bytes_total/1024**3).toFixed(1)} GiB downloaded</p></div>}
      {worker?.enabled&&<p>{worker.workflows.some(workflow=>workflow.endsWith('video'))?'Images and video run on this GPU.':'Images run on this GPU. It has no video profile.'}</p>}
      {worker?.enabled&&<p>Selected image LoRAs download on first use and stay cached. Add more in Admin at any time.</p>}
      {worker?.current_activity&&<p role="status">{worker.current_activity}</p>}
      {worker?.adapter_download&&<div role="status"><progress max={worker.adapter_download.bytes_total||1} value={worker.adapter_download.bytes_done}/><p>{(worker.adapter_download.bytes_done/1024**2).toFixed(0)} / {(worker.adapter_download.bytes_total/1024**2).toFixed(0)} MiB</p></div>}
      <div className="activity-actions">
        {worker?.issue&&<button disabled={pending} onClick={()=>void action('recover')}>{worker.issue.code==='local_adapter_failed'?'Retry LoRA download':'Retry recovery'}</button>}
        {!installed?<button disabled={pending||!setup||setup.state==='running'} onClick={()=>void action('setup')}>{setup?.state==='failed'?'Resume setup':'Set up local GPU'}</button>:
          !worker?.enabled||worker.paused?<button disabled={pending||setup?.state==='running'} onClick={()=>void action('enable')}>{worker?.paused?'Resume This PC':'Enable This PC'}</button>:
          <><button disabled={pending} onClick={()=>void action('pause')}>Pause after current</button><button disabled={pending} onClick={()=>void action('disable')}>Turn off after current</button></>}
        {worker?.state==='ready'&&!worker.current_job_id&&<button disabled={pending} onClick={()=>void action('unload')}>Unload now</button>}
        {!!worker?.current_job_id&&<button className="pool-danger" disabled={pending} onClick={()=>void action('cancel')}>Cancel current and stop</button>}
      </div>
      {(setup?.installed||!!setup?.bytes_done||setup?.state==='failed')&&<details><summary>Local storage</summary><p>Remove downloaded files when this worker is stopped. Library outputs and recovery receipts are preserved.</p><div className="activity-actions">{(['models','runtime','all'] as const).map(kind=><button key={kind} disabled={pending||setup?.state==='running'||!!worker?.current_job_id} onClick={()=>setCleanup(kind)}>Remove {kind==='all'?'models and runtime':kind}</button>)}</div></details>}
    </>}
    {(error||setup?.error||worker?.issue)&&<p role="alert">{error||setup?.error||worker?.issue?.message}</p>}
    {cleanup&&<ConfirmDialog title="Remove local GPU files?" description={`This turns off This PC and removes ${cleanup==='all'?'its downloaded models and runtime':cleanup==='models'?'its downloaded models':'its installed runtime'}. Setup will be required before using it again. Library outputs and recovery receipts are kept.`} action="Remove files" onClose={()=>setCleanup(null)} onConfirm={async()=>{await poolApi('/local/cleanup',{kind:cleanup});setStatus(await poolApi<Status>('/local'));pool.refresh();}}/>}
  </section>;
}
