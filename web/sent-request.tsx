import React,{useState} from 'react';
import type {ChatMessage} from '../shared/chat.js';
import {RequestCardHeader} from './request-card-header.js';
import {jobName} from './job-ui.js';
import {RequestDetails} from './request-details.js';
import type {PreviewRequestInput} from './request-preview.js';
export function SentRequest({attachment,onOpen}:{attachment:NonNullable<ChatMessage['request_attachment']>;onOpen:PreviewRequestInput}){
 const [open,setOpen]=useState(false),request=attachment.request,refs=request.references??[];
 return <><div className="sent-request" aria-label="Attached request"><RequestCardHeader request={request} onPreview={onOpen} label="View attached request" onOpen={()=>setOpen(true)}/></div>{open&&<RequestDetails label="Sent request" title={jobName(request.workflow)} caption={`Request sent with this message · revision ${attachment.revision}`} close={()=>setOpen(false)} request={request} inputs={Object.entries(attachment.notes).map(([id,note])=>({id,note}))} onPreview={onOpen}/>}</>;
}
