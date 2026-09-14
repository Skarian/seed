import React from 'react';
import type {JobRecord} from '../shared/jobs.js';
import {AssetThumbnail} from './asset-thumbnail.js';
import {jobName} from './job-ui.js';

export function RequestCardHeader({request,onPreview,onOpen,label}:{request:JobRecord['request'];onPreview:(id:string)=>void;onOpen:()=>void;label:string}){
 const inputs=request.references??[];
 return <div className="request-card-summary">{inputs[0]&&<AssetThumbnail id={inputs[0].asset_id} onOpen={()=>onPreview(inputs[0]!.asset_id)}/>}<div className="job-title"><button type="button" className="request-card-title" aria-label={label} title={label==='Review / history'?'Review request':label} onClick={onOpen}><strong>{jobName(request.workflow)}</strong></button>{inputs.length>0&&<small>{inputs.length} input{inputs.length===1?'':'s'}</small>}</div></div>;
}
