import {SelectedLoras} from './lora-picker.js';
import React,{useEffect,useState} from 'react';
import type {ImageRequest} from '../shared/generation.js';
import {AssetThumbnail} from './asset-thumbnail.js';
import {RequestDialog} from './request-dialog.js';
import type {PreviewRequestInput} from './request-preview.js';

type InputInfo={id:string;name?:string;note?:string};
function RequestText({text,label}:{text:string;label:string}){
 const [expanded,setExpanded]=useState(false),long=text.length>400;
 return <><p className={'request-prompt'+(long&&!expanded?' request-text-clamped':'')}>{text}</p>{long&&<button type="button" className="request-text-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Show less':`Show full ${label}`}</button>}</>;
}
const emptyInputs:InputInfo[]=[];
export function RequestSummary({request,inputs=emptyInputs,onPreview,seedLabel}:{request:ImageRequest;inputs?:InputInfo[];onPreview:PreviewRequestInput;seedLabel?:string}){
 const [loaded,setLoaded]=useState<InputInfo[]>([]);
 useEffect(()=>{const controller=new AbortController();void Promise.all((request.references??[]).map(async ref=>{const saved=inputs.find(a=>a.id===ref.asset_id);try{const response=await fetch('/api/v1/assets/'+ref.asset_id,{signal:controller.signal});if(!response.ok)return {id:ref.asset_id,name:'No longer available',note:saved?.note};const asset=await response.json();return {id:ref.asset_id,name:saved?.name??asset.name,note:saved?.note};}catch{return {id:ref.asset_id,name:ref.kind,note:saved?.note};}})).then(values=>{if(!controller.signal.aborted)setLoaded(values);});return()=>controller.abort();},[request.references,inputs]);
 const settings={'Quantity':request.count,'Aspect ratio':request.output.aspect==='source'?'Source image':request.output.aspect,Length:request.output.duration_seconds?`${request.output.duration_seconds} seconds`:undefined,Seed:seedLabel??request.resolved_seeds?.join(', ')??request.seed,Resolution:request.workflow==='image-to-image'?'Up to 1 MP':request.workflow==='text-to-image'?(request.output.aspect==='16:9'?'1280 × 720':'720 × 1280'):'768P',Soundtrack:request.audio?.output};
 return <div className="request-summary"><SelectedLoras request={request}/><section><h3>Prompt</h3><RequestText text={request.prompt} label="prompt"/></section>{(!!request.references?.length||!!request.note)&&<section className={'request-input-note'+(!request.references?.length||!request.note?' single':'')}>{!!request.references?.length&&<div><h3>Inputs</h3>{request.references?.map(ref=>{const input=loaded.find(a=>a.id===ref.asset_id)??inputs.find(a=>a.id===ref.asset_id);return <div className="review-input request-input-summary" key={ref.id}><AssetThumbnail id={ref.asset_id} name={input?.name??'Input'} onOpen={()=>onPreview(ref.asset_id,{inputId:ref.id,references:request.references!})}/><div className="review-input-content"><span className="review-input-name">{input?.name??ref.kind}</span><small>{ref.role.replaceAll('_',' ')}{ref.framing?` · ${ref.framing}`:''}{ref.range?` · ${ref.range.start_seconds}–${ref.range.start_seconds+ref.range.duration_seconds}s`:''}{ref.include_audio?' · Audio on':''}</small>{input?.note&&<p>{input.note}</p>}</div></div>;})}</div>}{request.note&&<div><h3>Note</h3><RequestText text={request.note} label="note"/></div>}</section>}<details className="review-disclosure"><summary>Settings</summary><dl className="request-setting-values">{Object.entries(settings).filter(([,value])=>value!==undefined).map(([label,value])=><div key={label}><dt title={label==='Seed'?'The seed used to reproduce this request.':`${label} saved with this request.`}>{label}</dt><dd>{typeof value==='string'?value.charAt(0).toUpperCase()+value.slice(1):value}</dd></div>)}</dl></details></div>;
}
export function RequestDetails({title,label,caption,close,...props}:React.ComponentProps<typeof RequestSummary>&{title:string;label:string;caption?:string;close:()=>void}){
 return <RequestDialog title={title} label={label} close={close}>{caption&&<p className="review-history-note request-caption">{caption}</p>}<RequestSummary {...props}/></RequestDialog>;
}
