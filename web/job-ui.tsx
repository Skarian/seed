import { isVideoWorkflow } from '../shared/workflows.js';
import {useActivity} from './hooks/use-activity.js';
import {ImportActivity} from './import-activity.js';
import {useWorkerPool} from './hooks/use-worker-pool.js';
import {WorkerActivityRow} from './worker-pool.js';
type ProviderIssue={code:string;message:string;action?:string;url?:string;retry_after_seconds?:number};
import {RequestSummary} from './request-details.js';
import {RequestInputPreview} from './request-input-preview.js';
import type {RequestPreviewContext} from './request-preview.js';
import React,{useEffect,useRef,useState} from 'react';
import {Modal} from './modal.js';
import {JobMedia} from './job-media.js';
export {JobMedia} from './job-media.js';
import {AssetThumbnail} from './asset-thumbnail.js';
import {jobState,jobStateLabels,jobActive,jobNeedsAttention,groupJobs,type JobRecord} from '../shared/jobs.js';


export async function jobApi(url:string,body?:unknown,key?:string){const r=await fetch('/api/v1/'+url,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error?.message??'Could not complete this action.');return value;}
export const jobName=(workflow:string)=>workflow==='image-to-image'?'Image to image':workflow==='reference-to-video'?'Ref to video':workflow==='text-to-video'?'Text to video':'Text to image';
export function JobIcon({name}:{name:string}){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{name==='info'?<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>:<path d={({close:'M6 6l12 12M18 6 6 18',edit:'M16 3l5 5-12 12-6 1 1-6zM14 5l5 5',branch:'M6 3v12a5 5 0 0 0 5 5h7M6 9h6a5 5 0 0 0 5-5V3M15 17l3 3-3 3M14 6l3-3 3 3',pause:'M8 5v14M16 5v14',play:'m9 5 10 7-10 7z',expand:'M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6',review:'M14 3H5v18h14V8zM14 3v5h5m-11 6 2 2 5-5'} as Record<string,string>)[name]??'M12 3v18'}/> }</svg>;}
export function JobButton({icon,label,onClick,disabled=false,danger=false,iconOnly=false}:{icon:string;label:string;onClick:()=>void;disabled?:boolean;danger?:boolean;iconOnly?:boolean}){return <button type="button" className={'job-button'+(danger?' danger':'')+(iconOnly?' icon-only':'')} title={label} aria-label={label} disabled={disabled} onClick={onClick}><JobIcon name={icon}/>{!iconOnly&&label}</button>;}
export async function branchJobs(jobs:JobRecord[],fresh:boolean,destination:'chat'|'generate'){
 if(destination==='chat'&&!window.dispatchEvent(new CustomEvent('seed:branch-chat',{cancelable:true,detail:{jobs,fresh}})))return;
 if(destination==='chat'){location.assign('/chat?fromJob='+encodeURIComponent(jobs[0]!.id)+'&seed='+(fresh?'new':'same')+'&outputs='+encodeURIComponent(jobs.map(j=>j.id).join(',')));}
 else location.assign('/?fromJob='+encodeURIComponent(jobs[0]!.id)+'&seed='+(fresh?'new':'same')+'&outputs='+encodeURIComponent(jobs.map(j=>j.id).join(',')));
}
export function SeedMenu({onChoose,disabled=false}:{onChoose:(fresh:boolean,destination:'chat'|'generate')=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),[destination,setDestination]=useState<'chat'|'generate'|null>(null);
 return <span className="job-seed-menu" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}><JobButton icon="branch" label="Create another request" iconOnly disabled={disabled} onClick={()=>{setDestination(null);setOpen(v=>!v);}}/>{open&&<div className="job-seed-options" role="group" aria-label="Create another request">{destination?<><small>Branch in {destination==='chat'?'Chat':'Generate'}</small><button onClick={()=>{setOpen(false);onChoose(false,destination);}}>Same seed</button><button onClick={()=>{setOpen(false);onChoose(true,destination);}}>New seed</button></>:<><small>Create another request</small><button onClick={()=>setDestination('chat')}>Branch in Chat</button><button onClick={()=>setDestination('generate')}>Branch in Generate</button></>}</div>}</span>;
}
export function JobDot({state}:{state:string}){return <span className={'job-dot '+state} title={jobStateLabels[state]??state} aria-label={jobStateLabels[state]??state}/>;}
function OutputTile({job,onSelect,selected}:{job:JobRecord;onSelect:()=>void;selected?:boolean}){const state=jobState(job),asset=job.outputs[0];const [missing,setMissing]=useState(false);useEffect(()=>setMissing(false),[asset]);return <button className={'job-output-tile '+state+(selected?' selected':'')} aria-pressed={selected} aria-label={selected!==undefined?'Select output: '+jobStateLabels[state]:state==='completed'?'Open preview':jobStateLabels[state]} title={selected!==undefined?'Select output':state==='completed'?'Open preview':jobStateLabels[state]} onClick={onSelect}><JobDot state={state}/>{state==='completed'&&asset&&!missing?<>{!isVideoWorkflow(job.request.workflow)||job.request.output.format==='images'?<img src={'/api/v1/assets/'+asset+'/content'} alt="Generated output" onError={()=>setMissing(true)}/>:<video src={'/api/v1/assets/'+asset+'/content#t=0.1'} muted playsInline preload="metadata" onError={()=>setMissing(true)}/>}{isVideoWorkflow(job.request.workflow)&&job.request.output.format!=='images'&&<span className="job-tile-play"><JobIcon name="play"/></span>}</>:state==='completed'?<small>No longer available</small>:<>{['running','starting','saving','cancelling'].includes(state)?<span className="job-loading-spinner" aria-label="Waiting for progress"/>:<span className="job-tile-symbol">{state==='queued'?'◷':state==='failed'||state==='unknown'?<JobIcon name="info"/>:'·'}</span>}<small>{jobStateLabels[state]??state}</small></>}</button>;}
export function JobOutputs({jobs,onSelect,selected}:{jobs:JobRecord[];onSelect:(job:JobRecord)=>void;selected?:string}){return <div className="job-output-tiles">{jobs.map(job=><OutputTile key={job.id} selected={selected===undefined?undefined:selected===job.id} job={job} onSelect={()=>onSelect(job)}/>)}</div>;}
function unknownJobDescription(job:JobRecord){
 if(!job.recovery)return 'The worker has not confirmed this output yet. Reconnect it to recover its receipt before trying again.';
 if(job.recovery.action==='retry'||job.recovery.pending)return 'Seed couldn’t confirm this request. Retry checks the original worker and resumes or safely resends the same request.';
 switch(job.recovery.reason){
  case 'worker_unavailable':return 'The original worker is unavailable. View its status to check the connection.';
  case 'submission_unavailable':return 'The saved submission is incomplete. Seed cannot safely retry this request.';
  case 'engine_interrupted':return 'The worker accepted this request before its engine was interrupted. Seed cannot safely start it again.';
  case 'cancelled':return 'Cancellation has been requested for this output.';
  default:return 'Seed still cannot confirm this request. View the original worker for its status.';
 }
}
export function JobDetails({jobs,initial,onClose,onRefresh}:{jobs:JobRecord[];initial?:string;onClose:()=>void;onRefresh?:()=>void}){
 const pool=useWorkerPool();
 const [inputPreview,setInputPreview]=useState<{assetId:string;context?:RequestPreviewContext}|null>(null);
 const [selected,setSelected]=useState(initial??jobs[0]!.id),[preview,setPreview]=useState<JobRecord|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const [recovered,setRecovered]=useState<Record<string,JobRecord>>({});
 const recovering=useRef(new Set<string>()),selectedRef=useRef(selected),jobsRef=useRef(jobs);
 selectedRef.current=selected;jobsRef.current=jobs;
 // Keep the accepted recovery visible until polling observes it or a later job
 // revision. A pre-action list response must not briefly re-enable Retry.
 useEffect(()=>{
   setRecovered(current=>{
     const next={...current};let changed=false;
     for(const fresh of jobs){
       const accepted=next[fresh.id];
       if(accepted&&(fresh.updated_at>accepted.updated_at||(fresh.updated_at===accepted.updated_at&&fresh.recovery?.pending))){delete next[fresh.id];changed=true;}
     }
     return changed?next:current;
   });
 },[jobs]);
 const current=jobs.find(j=>j.id===selected)??jobs[0]!;
 const accepted=recovered[current.id];
 const job=accepted&&accepted.updated_at>=current.updated_at?accepted:current,state=jobState(job),request=job.request;
 const recoveryPending=Boolean(job.recovery?.pending||recovering.current.has(job.id));
 async function recover(){
   const id=job.id;
   if(recovering.current.has(id)||job.recovery?.pending||job.recovery?.action!=='retry')return;
   recovering.current.add(id);setPending(true);setError('');
   try{
     const value:JobRecord=await jobApi('jobs/'+encodeURIComponent(id)+'/recover',{});
     const latest=jobsRef.current.find(item=>item.id===id);
     if(!latest||value.updated_at>=latest.updated_at)setRecovered(current=>({...current,[id]:value}));
     onRefresh?.();pool.refresh();
   }catch(failure){if(selectedRef.current===id)setError((failure as Error).message);}
   finally{recovering.current.delete(id);setPending(false);}
 }
 async function repeatOutput(fresh:boolean,destination:'chat'|'generate'=job.source?.chat_id?'chat':'generate'){setPending(true);setError('');try{await branchJobs([job],fresh,destination);}catch(e){setError((e as Error).message);setPending(false);}}
 async function action(url:string){setPending(true);setError('');try{await jobApi(url,{});onRefresh?.();}catch(e){setError((e as Error).message);}finally{setPending(false);}}
 return <Modal className="job-record-modal" aria-label="Request details" onCancel={onClose}><header className="job-record-heading"><div><h2>{jobName(request.workflow)}</h2><small>{new Date(job.created_at).toLocaleString()}{job.source?.chat_id&&<> · <a href={'/chat?chat='+encodeURIComponent(job.source.chat_id)}>View chat ↗</a></>}</small></div><div className="job-controls"><JobButton icon="close" label="Close request details" iconOnly onClick={onClose}/></div></header><div className="job-record-columns"><div><RequestSummary request={request} seedLabel={job.seed} inputs={job.input_snapshot??[]} onPreview={(assetId,context)=>setInputPreview({assetId,context})}/><details className="job-technical"><summary>Technical details</summary><p>Saved request, worker receipt, selected adapters, and timing.</p><button onClick={()=>void Promise.resolve().then(()=>navigator.clipboard.writeText(JSON.stringify(job,null,2))).catch(()=>setError('Could not copy. Use Download instead.'))}>Copy</button><button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(job,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='job-'+job.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download</button><pre>{JSON.stringify(job,null,2)}</pre></details></div><div><h3>Outputs</h3><div className="job-selected-outputs"><JobOutputs jobs={jobs} selected={selected} onSelect={j=>{setSelected(j.id);setError('');}}/></div><section className={'job-output-detail '+state} aria-label="Selected output" aria-busy={recoveryPending}><h3>{state==='failed'&&/\bdisconnected\b|\bunreachable\b|\bconnection (lost|closed|failed)\b/i.test(job.error??'')?'Worker connection lost':jobStateLabels[state]??state}</h3>{state==='completed'?(job.outputs.length?<>{!isVideoWorkflow(request.workflow)||request.output.format==='images'?<button className="job-large-preview" title="Open full screen preview" aria-label="Open full screen preview" onClick={()=>setPreview(job)}><img src={'/api/v1/assets/'+job.outputs[0]+'/content'} alt="Generated output"/></button>:<div className="job-large-preview"><video src={'/api/v1/assets/'+job.outputs[0]+'/content#t=0.1'} controls playsInline/></div>}</>:<p>No longer available</p>):state==='failed'||state==='unknown'||state==='blocked'?<><p>{state==='blocked'?'This output is waiting for a compatible worker. Resolve the issue below, then continue this request.':state==='unknown'?unknownJobDescription(job):job.recovery_blocked?'This output is already generated. Fix the connection or storage issue, then retry saving. This does not generate again.':'This output could not be completed. See the error below before trying again.'}</p><ProviderError issue={job.provider_issue}/><details><summary>Error details</summary><pre>{job.error||'No additional error details.'}</pre><button onClick={()=>void Promise.resolve().then(()=>navigator.clipboard.writeText(job.error??'')).catch(()=>setError('Could not copy error.'))}>Copy error</button></details>{state==='failed'&&!job.recovery_blocked&&<button disabled={pending} onClick={()=>void repeatOutput(false)}>Retry</button>}{job.recovery_blocked&&<button disabled={pending} onClick={()=>void action('jobs/'+job.id+'/retry-save')}>Retry saving</button>}{state==='blocked'&&<><button disabled={pending} onClick={()=>void action('jobs/'+job.id+'/continue')}>Continue request</button><JobButton icon="close" label="Cancel" danger disabled={pending} onClick={()=>void action('jobs/'+job.id+'/cancel')}/></>}{state==='unknown'&&!job.recovery&&!job.uncertainty_acknowledged&&<button disabled={pending} onClick={()=>void action('jobs/'+job.id+'/acknowledge')}>I reviewed the worker status</button>}</>:<><p>{state==='queued'?(job.waiting_reason??('Waiting for a compatible '+(!isVideoWorkflow(request.workflow)?'image':'video')+' worker.')):state==='saving'?'Saving the output to Library.':state==='cancelled'?'This output was cancelled.':state==='starting'?'Sending to the worker.':state==='cancelling'?'Cancellation requested. The worker remains rented until you quit it.':job.activity??'Generating this output.'}</p>{state==='queued'&&<button onClick={()=>pool.open(!isVideoWorkflow(request.workflow)?'image':'video')}>Open workers</button>}{jobActive(job)&&<JobButton icon="close" label="Cancel" danger disabled={pending} onClick={()=>void action('jobs/'+job.id+'/cancel')}/>}</> }{job.recovery&&(state==='unknown'||recoveryPending)&&<><div className="job-recovery-actions">{(job.recovery.action==='retry'||recoveryPending)&&<button type="button" disabled={pending||recoveryPending} onClick={()=>void recover()}>{recoveryPending?'Checking worker…':'Retry'}</button>}{job.recovery.worker_id&&<button type="button" onClick={()=>{onClose();pool.open(undefined,job.recovery!.worker_id);}}>View worker</button>}</div>{recoveryPending&&<p className="job-recovery-status" role="status">Checking the original worker for this request…</p>}</>}<small>Seed {job.seed} · {new Date(job.metrics?.terminal_at??job.updated_at).toLocaleString()}</small>{['completed','cancelled'].includes(state)&&<SeedMenu disabled={pending} onChoose={(fresh,destination)=>void repeatOutput(fresh,destination)}/>}</section>{error&&<p role="alert">{error}</p>}</div></div>{preview&&<JobMedia job={preview} jobs={jobs} onClose={()=>setPreview(null)}/ >}{inputPreview&&<RequestInputPreview {...inputPreview} onClose={()=>setInputPreview(null)}/>}</Modal>;
}
export function JobsView({mode,onClose}:{mode:string;onClose:()=>void}){
 const activity=useActivity(mode),{jobs,imports,loaded,refresh}=activity;
 const pool=useWorkerPool();
 const [error,setError]=useState(''),[detail,setDetail]=useState<string|null>(null),[preview,setPreview]=useState<JobRecord|null>(null),[pending,setPending]=useState(false);
 async function cancel(group:JobRecord[]){setPending(true);setError('');try{await Promise.all(group.filter(j=>jobActive(j)||j.state==='blocked').map(j=>jobApi('jobs/'+j.id+'/cancel',{})));await refresh();}catch(e){setError((e as Error).message);}finally{setPending(false);}}
 const groups=groupJobs(jobs);
 const records=[...groups.map(group=>({type:'generation' as const,group,created:group[0]!.created_at})),...imports.map(job=>({type:'import' as const,job,created:job.created_at})),...(pool.snapshot?.workers??[]).map(worker=>({type:'worker' as const,worker,created:worker.created_at}))].sort((a,b)=>b.created.localeCompare(a.created));
 return <Modal className="jobs-modal shared-jobs" aria-label="Activity" onCancel={onClose}>
   <header><div><h2>Activity</h2><p className="activity-intro">Generations, workers and LoRA imports.</p></div><JobButton icon="close" label="Close activity" iconOnly onClick={onClose}/></header>
   {error&&<p role="alert">{error}</p>}
   {activity.error&&<p role="alert">{activity.error}</p>}
   <div className="shared-job-list">{records.map(record=>{
     if(record.type==='worker')return <WorkerActivityRow key={'worker-'+record.worker.id} worker={record.worker}/>;
     if(record.type==='import')return <ImportActivity key={'import-'+record.job.id} job={record.job} onRefresh={refresh}/>;
     const group=record.group;
     const first=group[0]!,active=group.filter(jobActive),saved=group.filter(j=>j.state==='completed'),issues=group.filter(jobNeedsAttention),cancellable=group.some(j=>jobActive(j)||j.state==='blocked');
     const status=[active.length&&`${active.length} in progress`,saved.length&&`${saved.length} saved`,issues.length&&`${issues.length} need attention`].filter(Boolean).join(' · ')||'Finished';
     return <section key={first.submission_id}>
       <div className="job-list-heading"><h3>{jobName(first.request.workflow)}</h3><span className={'activity-state'+(issues.length?' needs-attention':'')}><JobDot state={issues.length?'failed':active.length?'running':'completed'}/>{status}</span></div>
       <p>{first.request.prompt}</p><small>{new Date(first.created_at).toLocaleString()}{first.source?.chat_id&&<> · <a href={'/chat?chat='+encodeURIComponent(first.source.chat_id)}>View chat ↗</a></>}</small>
       {saved.length>0&&<div className="activity-results"><JobOutputs jobs={saved} onSelect={setPreview}/></div>}
       <div className="activity-actions"><button type="button" onClick={()=>setDetail(issues[0]?.id??active[0]?.id??first.id)}>{issues.length?'Resolve issue':'View details'}</button>{cancellable&&<button type="button" disabled={pending} onClick={()=>void cancel(group)}>Cancel request</button>}</div>
     </section>;
   })}{!records.length&&<p className="job-empty">{loaded?'No activity yet.':'Loading activity…'}</p>}</div>
   {detail&&groups.find(g=>g.some(j=>j.id===detail))&&<JobDetails jobs={groups.find(g=>g.some(j=>j.id===detail))!} initial={detail} onClose={()=>setDetail(null)} onRefresh={()=>void refresh()}/>}
   {preview&&<JobMedia job={preview} jobs={jobs} onClose={()=>setPreview(null)}/>}
 </Modal>;
}

export function ProviderError({issue}:{issue?:ProviderIssue}){return issue?<div className="provider-error" role="alert"><strong>{issue.message}</strong><p>{issue.action}{issue.retry_after_seconds?` Wait at least ${issue.retry_after_seconds} seconds.`:''}</p>{issue.url&&<a href={issue.url} {...(issue.url.startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{issue.code==='invalid_credentials'?'Open Credentials':'Open provider ↗'}</a>}</div>:null;}
