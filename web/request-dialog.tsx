import React,{useEffect,useState} from 'react';
import {Modal} from './modal.js';
import './review-request.css';

export function RequestDialog({title,label,close,closeLabel='Close request',header,children,footer,error}:{title:string;label:string;close:()=>void;closeLabel?:string;header?:React.ReactNode;children:React.ReactNode;footer?:React.ReactNode;error?:string}){
 const [body,setBody]=useState<HTMLDivElement|null>(null),[more,setMore]=useState(false);
 useEffect(()=>{if(!body)return;const update=()=>setMore(body.scrollHeight>body.clientHeight+body.scrollTop+4);const observer=new ResizeObserver(update);observer.observe(body);for(const child of body.children)observer.observe(child);body.addEventListener('scroll',update);update();return()=>{observer.disconnect();body.removeEventListener('scroll',update);};},[body,children]);
 useEffect(()=>{if(!error||!body)return;const frame=requestAnimationFrame(()=>{body.scrollTo({top:body.scrollHeight,behavior:'instant'});body.querySelector<HTMLElement>('.review-error')?.focus({preventScroll:true});});return()=>cancelAnimationFrame(frame);},[error,body]);
 return <Modal className="review-request" aria-label={label} onCancel={close}><header><h2>{title}</h2>{header}<button type="button" className="request-dialog-close" aria-label={closeLabel} title={closeLabel} onClick={close}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div className="review-body" ref={setBody}>{children}{error&&<p role="alert" tabIndex={-1} className="review-error">{error}</p>}</div>{more&&<div className="request-scroll-fade" aria-hidden="true"/>}{footer&&<footer>{footer}</footer>}</Modal>;
}
