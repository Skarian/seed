import React,{useEffect,useState} from 'react';
import type {JobRecord} from '../shared/jobs.js';
import {FrameViewer} from './frame-viewer.js';
import {MediaPreview,type PreviewMedia} from './media-preview.js';
import type {PreviewNavigation} from './preview-navigation.js';
import {usePreviewHistory} from './hooks/use-preview-history.js';

/** One preview/history entry for the saved outputs of one submission. */
export function JobMedia({job,jobs,onClose}:{job:JobRecord;jobs?:JobRecord[];onClose:()=>void}){
  const close=usePreviewHistory(onClose);
  const [selected,setSelected]=useState(job.outputs[0]);
  const [result,setResult]=useState<{id:string;media?:PreviewMedia;error?:string}|null>(null);
  const [revision,setRevision]=useState(0);
  const outputs=[...new Set((jobs??[job])
    .filter(item=>(item.submission_id||item.id)===(job.submission_id||job.id)&&item.state==='completed'&&item.request.output.format!=='images')
    .sort((a,b)=>a.submission_index-b.submission_index).flatMap(item=>item.outputs))];
  const id=selected&&outputs.includes(selected)?selected:outputs[0];
  const index=id?outputs.indexOf(id):0;
  const navigation:PreviewNavigation={kind:'output',index,total:outputs.length,onChange:next=>{if(outputs[next])setSelected(outputs[next]);}};
  useEffect(()=>setSelected(job.outputs[0]),[job.id]);
  useEffect(()=>{
    if(!id)return;
    const controller=new AbortController();setResult(null);
    void fetch('/api/v1/assets/'+encodeURIComponent(id),{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error(response.status===404?'This output is no longer available.':'Could not load this output. Please try again.');
      const asset=await response.json();
      if(!controller.signal.aborted)setResult({id,media:{...asset,id,url:'/api/v1/assets/'+id+'/content',type:asset.mime_type??''}});
    }).catch(error=>{if(!controller.signal.aborted)setResult({id,error:error.message});});
    return()=>controller.abort();
  },[id,revision]);
  if(job.request.output.format==='images')return <FrameViewer id={job.id} onClose={()=>close()}/>;
  const current=result?.id===id?result:null;
  return <MediaPreview media={current?.media??null} loadingError={!id?'This output is no longer available.':current?.error} onRetry={id?()=>setRevision(value=>value+1):undefined} navigation={navigation} onClose={onClose} dismiss={close}/>;
}
