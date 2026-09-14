import {NoteSavedContext} from './asset-note.js';
import {Modal} from './modal.js';
import React, { useEffect, useRef, useState, type ReactNode } from 'react';

export type PreviewMedia = {
  name: string; url: string; kind: 'image' | 'video' | 'audio'; type: string;
  width?: number; height?: number; duration?: number; size?:number; has_audio?:boolean;
};
export function MediaPreview({ media, onClose, onDelete, controls, note, referenceLabel, navigation, label='Media preview' }: {
  media: PreviewMedia; onClose: () => void; onDelete?: () => void; controls?: ReactNode; note?:ReactNode; label?:string; referenceLabel?:string; navigation?:{index:number;total:number;onChange:(index:number)=>void};
}) {
  const dialog = useRef<HTMLDivElement>(null),info=useRef<HTMLDetailsElement>(null),hold=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),held=useRef(false);
  const [editing,setEditing]=useState(false);
  const [dimensions,setDimensions]=useState({width:media.width,height:media.height,duration:media.duration});
  useEffect(()=>{setDimensions({width:media.width,height:media.height,duration:media.duration});setEditing(false);},[media.url]);
  useEffect(()=>()=>clearTimeout(hold.current),[]);
  function cancelHold(){clearTimeout(hold.current);}

  return <Modal ref={dialog} className="media-viewer" aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="viewer-toolbar">
      <button type="button" className="viewer-button" aria-label="Close preview" onClick={onClose}><Glyph name="close" /></button>
      {referenceLabel&&<strong className="viewer-reference-label">{referenceLabel}</strong>}
      {navigation&&navigation.total>1&&<nav className="viewer-navigation" aria-label="Input navigation"><button type="button" className="viewer-button" aria-label="Previous input" disabled={navigation.index===0} onClick={()=>navigation.onChange(navigation.index-1)}>‹</button><span aria-live="polite">{navigation.index+1} of {navigation.total}</span><button type="button" className="viewer-button" aria-label="Next input" disabled={navigation.index===navigation.total-1} onClick={()=>navigation.onChange(navigation.index+1)}>›</button></nav>}
      <div className="viewer-actions">
        <details ref={info} className="viewer-info" onPointerEnter={e=>{if(e.pointerType==='mouse')e.currentTarget.open=true;}} onPointerLeave={e=>{cancelHold();if(e.pointerType==='mouse')e.currentTarget.open=false;}}><summary aria-label="File information" onPointerDown={e=>{held.current=false;if(e.pointerType==='touch'){hold.current=setTimeout(()=>{held.current=true;if(info.current)info.current.open=true;},500);}}} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerMove={cancelHold} onContextMenu={e=>e.preventDefault()} onClick={e=>{if(held.current){e.preventDefault();held.current=false;}else if(e.detail&&matchMedia('(hover:hover)').matches){e.preventDefault();if(info.current)info.current.open=true;}}}><Glyph name="info" /></summary><div><strong>{media.name}</strong><span>{media.type || media.kind}</span>{dimensions.width !== undefined && <span>{dimensions.width} × {dimensions.height}</span>}{dimensions.duration !== undefined && <span>{dimensions.duration.toFixed(1)} seconds</span>}{media.size!==undefined&&<span>{media.size>=1048576?(media.size/1048576).toFixed(1)+' MB':Math.ceil(media.size/1024)+' KB'}</span>}{media.has_audio!==undefined&&<span>{media.has_audio?'Includes audio':'No audio track'}</span>}</div></details>
        {note&&<button className="viewer-button" aria-label="Edit note" aria-expanded={editing} onClick={()=>setEditing(value=>!value)}><Glyph name="edit"/></button>}
        <a className="viewer-button" href={media.url} download={media.name} aria-label="Download file"><Glyph name="download" /></a>
        {onDelete && <button type="button" className="viewer-button" aria-label="Delete file" onClick={onDelete}><Glyph name="delete" /></button>}
      </div>
    </header>
    <div className="viewer-canvas" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      {media.kind === 'image' ? <img src={media.url} alt={media.name} onLoad={e=>setDimensions({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight,duration:undefined})} /> : media.kind === 'video' ? <video src={media.url} onLoadedMetadata={e=>setDimensions({width:e.currentTarget.videoWidth,height:e.currentTarget.videoHeight,duration:e.currentTarget.duration})} controls playsInline preload="metadata" /> : <div className="viewer-audio"><span aria-hidden="true">♫</span><audio src={media.url} controls preload="metadata" /></div>}
    </div>
    {note&&editing&&<aside className="viewer-note-panel" aria-label="Edit asset note"><NoteSavedContext.Provider value={()=>setEditing(false)}>{note}</NoteSavedContext.Provider></aside>}
    {controls && <div className="viewer-controls">{controls}</div>}
  </Modal>;
}
export function Glyph({ name }: { name: 'close' | 'info' | 'download' | 'delete' | 'edit' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'edit' && <path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z" />}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
    {name === 'info' && <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>}
    {name === 'download' && <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>}
    {name === 'delete' && <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>}
  </svg>;
}

