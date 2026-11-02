import React,{useEffect,useState} from 'react';
import {progressLabel,progressParts} from '../shared/generation-progress.js';
import type {JobRecord} from '../shared/jobs.js';

/** Re-renders once a second while a timed phase is showing, so elapsed time counts up between polls. */
function useClock(running:boolean){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(!running)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running]);
  return now;
}

/** Two-line text for an output tile: phase name, then percent or elapsed time. */
export function TileProgress({job}:{job:JobRecord}){
  const progress=job.progress,now=useClock(Boolean(progress&&progress.phase!=='generating'));
  if(!progress)return null;
  const {name,detail}=progressParts(progress,job.request.workflow,now);
  return <small className="job-progress" role="status">{name}{detail&&<><br/><span className="job-progress-detail">{detail}</span></>}</small>;
}

/** One-line text for rows and details, for example "Loading models · 18 s". */
export function ProgressText({job}:{job:JobRecord}){
  const progress=job.progress,now=useClock(Boolean(progress&&progress.phase!=='generating'));
  return progress?<>{progressLabel(progress,job.request.workflow,now)}</>:null;
}
