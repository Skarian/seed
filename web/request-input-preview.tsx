import React,{useEffect,useState} from 'react';
import {inputLabels} from '../shared/reference-labels.js';
import {MediaPreview,type PreviewMedia} from './media-preview.js';
import {AssetNote} from './asset-note.js';
import {Modal} from './modal.js';
import type {RequestPreviewContext} from './request-preview.js';
import {usePreviewHistory} from './hooks/use-preview-history.js';

/** A saved job's input preview navigates its input instances, including repeated files. */
export function RequestInputPreview({assetId,context,onClose}:{assetId:string;context?:RequestPreviewContext;onClose:()=>void}){
 const close=usePreviewHistory(onClose);
 const [selected,setSelected]=useState({assetId,context}),[media,setMedia]=useState<PreviewMedia|null>(null),[error,setError]=useState('');
 useEffect(()=>setSelected({assetId,context}),[assetId,context]);
 useEffect(()=>{
  const controller=new AbortController();setMedia(null);setError('');
  void fetch('/api/v1/assets/'+selected.assetId,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('No longer available');const value=await response.json();
   if(!controller.signal.aborted)setMedia({...value,url:'/api/v1/assets/'+selected.assetId+'/content',type:value.mime_type??''});
  }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
  return()=>controller.abort();
 },[selected.assetId]);
 const input=selected.context?.references.find(ref=>ref.id===selected.context!.inputId);
 const label=selected.context?.label??(input?(inputLabels(selected.context!.references).get(input.id)?.slice(1,-1)??(input.role==='first_frame'?'First frame':input.role==='last_frame'?'Last frame':'Input')):undefined);
 const navigation=selected.context?{index:selected.context.references.findIndex(ref=>ref.id===selected.context!.inputId),total:selected.context.references.length,onChange:(index:number)=>{
  const refs=selected.context!.references,ref=refs[index];if(ref)setSelected({assetId:ref.asset_id,context:{inputId:ref.id,references:refs}});
 }}:undefined;
 return media?<MediaPreview media={media} referenceLabel={label} navigation={navigation} onClose={onClose} dismiss={close} note={<AssetNote id={selected.assetId}/>} controls={input?.range&&<p className="viewer-input-range">Selected clip: {input.range.start_seconds}–{Number((input.range.start_seconds+input.range.duration_seconds).toFixed(2))} seconds · Preview plays the full source</p>}/>:<Modal aria-label="Input preview" onCancel={()=>close()}><p>{error||'Loading preview…'}</p><button onClick={()=>close()}>Close</button></Modal>;
}
