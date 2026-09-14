import {inputLabels} from '../shared/reference-labels.js';
import {RequestSummary} from './request-details.js';
import React,{useEffect,useState} from 'react';
import type {ChatCard,ChatRevision} from '../shared/chat.js';
import type {ImageRequest} from '../server/workflows.js';
import {RequestDialog} from './request-dialog.js';
import {RequestFields,type RequestAsset} from './request-fields.js';
import {jobName} from './job-ui.js';
import {RevisionControls} from './revision-controls.js';
import './review-request.css';
export function Review({card,initial,error,assets,mode,busy,editable,close,save,approve,feedback,restore,stop,onPreview}:{card:ChatCard;initial:ChatRevision;error:string;assets:RequestAsset[];mode:'sfw'|'nsfw';busy:boolean;editable:boolean;close:()=>void;save:(r:unknown)=>Promise<boolean>;approve:()=>Promise<void>;feedback:()=>void;restore:(n:number,r:unknown)=>Promise<void>;stop:()=>void;onPreview:(id:string)=>void}){
 const [revision,setRevision]=useState(initial.number),[request,setRequest]=useState(initial.request),[step,setStep]=useState(1);
 useEffect(()=>{setRevision(initial.number);setRequest(initial.request);},[initial.number,initial.request]);
 useEffect(()=>{const abort=new AbortController();void fetch('/api/v1/capabilities',{signal:abort.signal}).then(r=>r.json()).then(c=>setStep(!c.revision||c.workflows?.[card.workflow]?.duration_seconds?.step===1?1:5)).catch(()=>{});return()=>abort.abort();},[card.workflow]);
 const historical=revision!==card.revisions.at(-1)!.number,dirty=JSON.stringify(request)!==JSON.stringify(card.revisions.at(-1)!.request),video=card.workflow!=='text-to-image';
 const raw=()=>{const v:any={...request};delete v.workflow;delete v.capabilities_revision;if(mode==='sfw')delete v.mode;return v;};
 const validSeed=request.seed==='random'||(/^(0|[1-9][0-9]{0,15})$/.test(request.seed)&&BigInt(request.seed)+BigInt(request.count-1)<=9007199254740991n);
 const missing=request.prompt.includes('[removed reference]')||[...request.prompt.matchAll(/<(?:Picture|Video|Audio) [1-9][0-9]*>/g)].some(m=>!new Set(inputLabels(request.references??[]).values()).has(m[0]));
 const invalid=missing?'Remove or replace the missing input mentions.':!request.prompt.trim()?'Enter a prompt.':!validSeed?'Use a valid starting seed with room for the batch.':request.count<1||request.count>16?'Choose a batch size from 1 to 16.':video&&(!Number.isInteger(request.output.duration_seconds)||request.output.duration_seconds!<5||request.output.duration_seconds!>15||(step!==1&&![5,10,15].includes(request.output.duration_seconds!)))?'Choose a supported length between 5 and 15 seconds.':'';
 return <RequestDialog title={jobName(card.workflow)} label="Review generation" close={close} closeLabel="Close review" error={invalid||error} header={<> {card.revisions.length>1&&<RevisionControls current={revision} total={card.revisions.length} label="request revision" onChange={n=>{setRevision(n);setRequest(card.revisions.find(r=>r.number===n)!.request);}}/>}{busy&&<button type="button" onClick={stop}>Stop</button>} </>} footer={<> {historical?<button disabled={busy} onClick={()=>void(editable?save(raw()):restore(revision,raw()))}>Restore revision</button>:editable?<>{!dirty&&<button className="review-feedback" disabled={busy} title={dirty?'Save changes before providing feedback':'Return to the composer with this request'} onClick={feedback}>↩ Provide feedback</button>}{dirty&&<button disabled={busy||!!invalid} onClick={()=>void save(raw())}>Save changes</button>}<button className="primary-action" disabled={busy||dirty||!!invalid} onClick={()=>void approve()}>Approve</button></>:<button disabled={busy||!!invalid} onClick={()=>void restore(revision,raw())}>Restore request</button>} </>}> {historical?<RequestSummary request={request} inputs={assets} onPreview={onPreview}/>:<RequestFields request={request} assets={assets} mode={mode} disabled={busy||historical} step={step} onChange={setRequest} onPreview={onPreview}/>}{historical&&<p className="review-history-note">Earlier revision · read-only</p>}</RequestDialog>;
}
