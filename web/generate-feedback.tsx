import React, {useEffect, useRef, useState} from 'react';
import {toast} from 'react-hot-toast/headless';
import {jobActive, jobState, type JobRecord} from '../shared/jobs.js';
import type {WorkflowId} from '../shared/studio.js';
import './generate-feedback.css';

type Submission = {ids:string[]; workflow:WorkflowId; mode:string};
const mediaName = (workflow:WorkflowId, count:number) => `${count} ${workflow==='text-to-image'?'image':'video'}${count===1?'':'s'}`;

// Track only submissions made in this page session; loading history must not replay notifications.
export function useGenerationFeedback(jobs:JobRecord[], workflow:WorkflowId, mode:string) {
  const [submissions,setSubmissions] = useState<Submission[]>([]);
  const notified = useRef(new Map<string,string>());
  const toastIds = useRef<string[]>([]);
  const currentMode=useRef(mode);currentMode.current=mode;
  useEffect(()=>()=>{toastIds.current.forEach(id=>toast.dismiss(id));toastIds.current=[];},[mode]);
  useEffect(()=>{
    for(const submission of submissions){
      const id=submission.ids[0]!;
      const records=submission.ids.map(id=>jobs.find(job=>job.id===id));
      if(records.some(job=>!job||jobActive(job!)))continue;
      const state=records.map(job=>jobState(job!)+':'+job!.outputs.length).join(',');
      if(notified.current.get(id)===state)continue;
      notified.current.set(id,state);
      if(submission.mode!==mode)continue;
      const saved=records.filter(job=>job!.state==='completed'&&job!.outputs.length).length;
      const failed=records.filter(job=>['failed','unknown','blocked'].includes(jobState(job!))).length;
      const message=saved===records.length
        ? `${mediaName(submission.workflow,saved)} saved to Library`
        : saved ? `${saved} of ${records.length} saved to Library${failed?' · '+failed+' need attention':''}`
        : failed ? 'Generation needs attention. Check the request for details.' : 'Generation cancelled';
      toastIds.current.push((failed?toast.error:saved?toast.success:toast)(message,{duration:5000}));
    }
  },[jobs,submissions,mode]);
  function submitted(records:JobRecord[], submittedWorkflow:WorkflowId, submittedMode:string){
    if(!records.length)return;
    const ids=records.map(job=>job.id);
    setSubmissions(current=>[...current.filter(s=>s.ids[0]!==ids[0]),{ids,workflow:submittedWorkflow,mode:submittedMode}]);
    if(submittedMode===currentMode.current)toastIds.current.push(toast.success(`Request submitted · ${mediaName(submittedWorkflow,records.length)}`,{duration:3500}));
  }
  const latest=[...submissions].reverse().find(s=>s.workflow===workflow&&s.mode===mode);
  return {submitted, jobs:latest?latest.ids.flatMap(id=>jobs.find(j=>j.id===id)??[]):[]};
}

export function GenerateFeedback({jobs,onPreview,onDetails,onLibrary}:{jobs:JobRecord[];onPreview:(job:JobRecord)=>void;onDetails:(id:string)=>void;onLibrary:()=>void}){
  if(!jobs.length)return null;
  const saved=jobs.filter(job=>job.state==='completed'&&job.outputs.length);
  const active=jobs.filter(jobActive).length;
  const failed=jobs.filter(job=>['failed','unknown','blocked'].includes(jobState(job))).length;
  const status=active ? `${mediaName(jobs[0]!.request.workflow,active)} in progress${saved.length?' · '+saved.length+' saved':''}`
    : saved.length ? `${mediaName(jobs[0]!.request.workflow,saved.length)} saved to Library` : failed ? 'Generation needs attention' : 'Generation cancelled';
  return <section className="generate-feedback" aria-label="Latest generation">
    <div className="generate-feedback-line">
      <span role="status">{active>0&&<span className="generation-spinner" aria-hidden="true"/>}{status}</span>
      {active>0||failed>0?<button type="button" onClick={()=>onDetails(jobs.find(j=>jobActive(j)||['failed','unknown','blocked'].includes(jobState(j)))!.id)}>{failed?'View issue':'View progress'}</button>:null}
      {saved.length>0&&<button type="button" onClick={onLibrary}>Library ↗</button>}
    </div>
    {saved.length>0&&<div className="generation-thumbnails">{saved.map((job,index)=><GenerationThumbnail key={job.id} job={job} index={index} onOpen={()=>onPreview(job)}/>)}</div>}
  </section>;
}

function GenerationThumbnail({job,index,onOpen}:{job:JobRecord;index:number;onOpen:()=>void}){
  const [missing,setMissing]=useState(false);
  const video=job.request.workflow!=='text-to-image',label=`Open ${video?'video':'image'} ${index+1} preview`,url='/api/v1/assets/'+job.outputs[0]+'/content';
  return <button type="button" className="generation-thumbnail" aria-label={label} title={label} onClick={onOpen}>
    {missing?<span>Preview</span>:video?<><video src={url+'#t=0.1'} muted playsInline preload="metadata" onError={()=>setMissing(true)}/><span className="generation-play" aria-hidden="true">▶</span></>:<img src={url} alt="" onError={()=>setMissing(true)}/>}
  </button>;
}
