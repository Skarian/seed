import React from 'react';
import type {JobRecord} from '../shared/jobs.js';
import {AssetThumbnail} from './asset-thumbnail.js';
import {jobName} from './job-ui.js';
import type {PreviewRequestInput} from './request-preview.js';

export function RequestCardHeader({request,onPreview,onOpen,label}:{request:JobRecord['request'];onPreview:PreviewRequestInput;onOpen:()=>void;label:string}){
 const inputs=request.references??[];
 return <div className="request-card-summary">{inputs[0]&&<AssetThumbnail id={inputs[0].asset_id} onOpen={()=>onPreview(inputs[0]!.asset_id,{inputId:inputs[0]!.id,references:inputs})}/>}<div className="job-title"><button type="button" className="request-card-title" aria-label={label} title={label==='Review / history'?'Review request':label} onClick={onOpen}><strong>{jobName(request.workflow)}</strong></button>{inputs.length>0&&<small>{inputs.length} input{inputs.length===1?'':'s'}</small>}</div></div>;
}
