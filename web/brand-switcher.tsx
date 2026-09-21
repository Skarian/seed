import React,{useEffect,useRef,useState} from 'react';
import type {WorkspacePage} from './hooks/use-navigation.js';
import {SpicyBrand} from './spicy-mode.js';
export function BrandSwitcher({children,icon,page,onNavigate}:{children:React.ReactNode;icon:React.ReactNode;page:WorkspacePage;onNavigate:(page:WorkspacePage)=>void}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{function dismiss(e:PointerEvent){if(!root.current?.contains(e.target as Node))setOpen(false);}document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[]);
 return <div className="brand-switcher" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLButtonElement>('.brand')?.focus();}}}>
 <SpicyBrand expanded={open} onNavigate={()=>setOpen(v=>!v)}>{icon}<span className="brand-workspace"><span className="brand-name">{children}</span><small>{page==='admin'?'Admin':page==='generate'?'Generate':page==='library'?'Library':'Chat'}</small></span><svg className="brand-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></SpicyBrand>
 {open&&<div className="brand-menu" role="menu" aria-label="Workspace"><button role="menuitem" onClick={()=>{setOpen(false);onNavigate('chat');}}><span>Chat<small>Create with an assistant</small></span>{page==='chat'&&<span aria-hidden="true">✓</span>}</button><button role="menuitem" onClick={()=>{setOpen(false);onNavigate('generate');}}><span>Generate<small>Build a request directly</small></span>{page==='generate'&&<span aria-hidden="true">✓</span>}</button><button role="menuitem" onClick={()=>{setOpen(false);onNavigate('library');}}><span>Library<small>Browse your media</small></span>{page==='library'&&<span aria-hidden="true">✓</span>}</button></div>}
 </div>;
}
