import {NoteSavedContext} from './asset-note.js';
import {Modal} from './modal.js';
import {PreviewImage} from './preview-image.js';
import {usePreviewHistory} from './hooks/use-preview-history.js';
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import './media-preview.css';
import {FavoriteButton,AssetCollections,CollectionGlyph} from './asset-organization.js';
import {PreviewNavigationControls,movePreview,usePreviewKeyboard,type PreviewNavigation} from './preview-navigation.js';
import {usePreviewSwipe} from './hooks/use-preview-swipe.js';

export type PreviewMedia = {
  id?:string;favorite?:boolean;
  name: string; url: string; kind: 'image' | 'video' | 'audio'; type: string;
  width?: number; height?: number; duration?: number; size?:number; has_audio?:boolean; fps?:number;
};
export function MediaPreview({ media:loadedMedia, loadingError, onRetry, onClose, dismiss, onDelete, controls, note, referenceLabel, navigation, label='Media preview' }: {
  media: PreviewMedia|null; loadingError?:string;onRetry?:()=>void; onClose: () => void; dismiss?: (after?:()=>void)=>void; onDelete?: () => void; controls?: ReactNode; note?:ReactNode; label?:string; referenceLabel?:string; navigation?:PreviewNavigation;
}) {
  // Keep one dialog mounted while changing files, including loading/error states.
  const media:PreviewMedia=loadedMedia??{name:'',url:'',kind:'image',type:''};
  // Loading wrappers own the history entry across changes to the displayed file.
  const ownClose = usePreviewHistory(onClose, !dismiss);
  const close = dismiss ?? ownClose;
  const dialog = useRef<HTMLDivElement>(null),info=useRef<HTMLDetailsElement>(null),hold=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),held=useRef(false);
  const [editing,setEditing]=useState(false);
  const [organizing,setOrganizing]=useState(false);
  const [dimensions,setDimensions]=useState({width:media.width,height:media.height,duration:media.duration});
  const video=useRef<HTMLVideoElement>(null),displayedTime=useRef(0);
  const [picking,setPicking]=useState(false),[time,setTime]=useState(0),[seeking,setSeeking]=useState(false),[saving,setSaving]=useState(false),[frameError,setFrameError]=useState(''),[saved,setSaved]=useState<{id?:string;url:string;width:number;height:number}|null>(null),[showFrame,setShowFrame]=useState(false),[fps,setFps]=useState(media.fps??24);
  const assetId=media.url.match(/^\/api\/v1\/assets\/([-\w]+)\/content(?:[?#].*)?$/)?.[1];
  const activeNavigation=!organizing&&!showFrame&&!picking&&!saving?navigation:undefined;
  usePreviewKeyboard(dialog,activeNavigation);
  const swipe=usePreviewSwipe(media.kind!=='image'&&activeNavigation?direction=>movePreview(activeNavigation,direction):undefined);
  useEffect(()=>{setPicking(false);setSaved(null);setFrameError('');setShowFrame(false);displayedTime.current=0;setTime(0);setFps(media.fps??24);setSeeking(false);
    const element=video.current;if(!element)return;
    let callback=0;
    function frame(_now:number,metadata:VideoFrameCallbackMetadata){displayedTime.current=metadata.mediaTime;callback=element!.requestVideoFrameCallback(frame);}
    if(element.requestVideoFrameCallback)callback=element.requestVideoFrameCallback(frame);
    return()=>{if(callback)element.cancelVideoFrameCallback(callback);};
  },[media.url]);
  useEffect(()=>{if(!assetId||media.kind!=='video')return;const controller=new AbortController();
    void fetch('/api/v1/assets/'+assetId,{signal:controller.signal}).then(r=>r.ok?r.json():null).then(a=>{if(a?.fps>0&&!controller.signal.aborted)setFps(a.fps);}).catch(()=>{});return()=>controller.abort();
  },[assetId,media.kind]);
  function seek(seconds:number){if(!video.current)return;video.current.pause();video.current.currentTime=Math.max(0,Math.min(seconds,(dimensions.duration??0)-1/fps));setTime(video.current.currentTime);setSaved(null);setFrameError('');}
  async function saveFrame(){if(!video.current||!assetId||saving)return;setSaving(true);setFrameError('');
    try{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const current=video.current.currentTime,shown=displayedTime.current;
      const seconds=Math.abs(current-shown)<1.5/fps?shown:current;
      const response=await fetch('/api/v1/assets/'+assetId+'/frames',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time_seconds:seconds})});const result=await response.json();if(!response.ok)throw Error(result.error?.message??'Could not save frame.');
      setSaved(result);window.dispatchEvent(new Event('seed:library-changed'));
    }catch(error){setFrameError((error as Error).message);}finally{setSaving(false);}
  }
  useEffect(()=>{setDimensions({width:media.width,height:media.height,duration:media.duration});setEditing(false);setOrganizing(false);if(info.current)info.current.open=false;},[media.url]);
  useEffect(()=>()=>clearTimeout(hold.current),[]);
  function cancelHold(){clearTimeout(hold.current);}

  return <Modal ref={dialog} className="media-viewer" aria-label={label} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="viewer-toolbar">
      <button type="button" className="viewer-button" aria-label="Close preview" onClick={()=>close()}><Glyph name="close" /></button>
      {referenceLabel&&<strong className="viewer-reference-label">{referenceLabel}</strong>}
      {navigation&&(!navigation.kind||navigation.kind==='input')&&navigation.total>1&&<nav className="viewer-navigation" aria-label="Input navigation"><button type="button" className="viewer-button" aria-label="Previous input" disabled={navigation.index===0} onClick={()=>navigation.onChange(navigation.index-1)}>‹</button><span aria-live="polite">{navigation.index+1} of {navigation.total}</span><button type="button" className="viewer-button" aria-label="Next input" disabled={navigation.index===navigation.total-1} onClick={()=>navigation.onChange(navigation.index+1)}>›</button></nav>}
      {loadedMedia&&<div className="viewer-actions">
        {media.id&&assetId&&<><FavoriteButton assetId={media.id} favorite={media.favorite} className="viewer-button"/><button type="button" className="viewer-button asset-organization-button" aria-label="Add to collection" title="Add to collection" onClick={()=>setOrganizing(true)}><CollectionGlyph/></button></>}
        {media.kind==='video'&&assetId&&<button type="button" className="viewer-button viewer-text-action" disabled={!dimensions.duration||saving} aria-pressed={picking} onClick={()=>{video.current?.pause();setTime(video.current?.currentTime??0);setPicking(value=>!value);}}>Pick Frame</button>}
        <details ref={info} className="viewer-info" onPointerEnter={e=>{if(e.pointerType==='mouse')e.currentTarget.open=true;}} onPointerLeave={e=>{cancelHold();if(e.pointerType==='mouse')e.currentTarget.open=false;}}><summary aria-label="File information" onPointerDown={e=>{held.current=false;if(e.pointerType==='touch'){hold.current=setTimeout(()=>{held.current=true;if(info.current)info.current.open=true;},500);}}} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerMove={cancelHold} onContextMenu={e=>e.preventDefault()} onClick={e=>{if(held.current){e.preventDefault();held.current=false;}else if(e.detail&&matchMedia('(hover:hover)').matches){e.preventDefault();if(info.current)info.current.open=true;}}}><Glyph name="info" /></summary><div><strong>{media.name}</strong><span>{media.type || media.kind}</span>{dimensions.width !== undefined && <span>{dimensions.width} × {dimensions.height}</span>}{dimensions.duration !== undefined && <span>{dimensions.duration.toFixed(1)} seconds</span>}{media.size!==undefined&&<span>{media.size>=1048576?(media.size/1048576).toFixed(1)+' MB':Math.ceil(media.size/1024)+' KB'}</span>}{media.has_audio!==undefined&&<span>{media.has_audio?'Includes audio':'No audio track'}</span>}</div></details>
        {note&&<button className="viewer-button" aria-label="Edit note" aria-expanded={editing} onClick={()=>setEditing(value=>!value)}><Glyph name="edit"/></button>}
        {assetId&&media.kind==='image'&&<button className="viewer-button viewer-text-action" onClick={()=>close(()=>window.dispatchEvent(new CustomEvent('seed:edit-image',{detail:{id:assetId,name:media.name}})))}>Edit image</button>}
        <a className="viewer-button" href={media.url} download={media.name} aria-label="Download file"><Glyph name="download" /></a>
        {onDelete && <button type="button" className="viewer-button" aria-label="Delete file" onClick={onDelete}><Glyph name="delete" /></button>}
      </div>}
    </header>
    <div className="viewer-canvas" {...swipe} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      {!loadedMedia?<div className="output-preview-status">{loadingError?<><p role="alert">{loadingError}</p>{onRetry&&<button type="button" onClick={onRetry}>Retry</button>}</>:<p role="status">Loading preview…</p>}</div>:media.kind === 'image' ? <PreviewImage key={media.url} src={media.url} name={media.name} onSwipe={activeNavigation?direction=>movePreview(activeNavigation,direction):undefined} onLoad={e=>setDimensions({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight,duration:undefined})} /> : media.kind === 'video' ? <video key={media.url} ref={video} src={media.url} onLoadedMetadata={e=>setDimensions({width:e.currentTarget.videoWidth,height:e.currentTarget.videoHeight,duration:e.currentTarget.duration})} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onSeeking={()=>{setSeeking(true);setSaved(null);}} onSeeked={()=>setSeeking(false)} onPlay={()=>setPicking(false)} controls playsInline preload="metadata" /> : <div className="viewer-audio"><span aria-hidden="true">♫</span><audio key={media.url} src={media.url} controls preload="metadata" /></div>}
      {(activeNavigation?.kind==='output'||activeNavigation?.kind==='library')&&<PreviewNavigationControls navigation={activeNavigation}/>}
    </div>
    {picking&&<section className="frame-picker" aria-label="Pick a frame"><button type="button" aria-label="Previous frame" disabled={saving||time<=0} onClick={()=>seek(time-1/fps)}>‹</button><label>Frame<input aria-label="Frame position" type="range" min={0} max={Math.max(0,(dimensions.duration??0)-1/fps)} step={1/fps} value={time} disabled={saving} onChange={e=>seek(Number(e.target.value))}/></label><button type="button" aria-label="Next frame" disabled={saving||time>=(dimensions.duration??0)-1/fps} onClick={()=>seek(time+1/fps)}>›</button><time>{time.toFixed(2)}s</time><button type="button" disabled={saving||seeking} onClick={()=>void saveFrame()}>{saving?'Saving…':'Save frame'}</button>{saved&&<><span className="frame-saved" role="status">Saved to Library</span><button type="button" onClick={()=>setShowFrame(true)}>View frame</button></>}{frameError&&<p role="alert">{frameError}</p>}</section>}
    {note&&editing&&<aside className="viewer-note-panel" aria-label="Edit asset note"><NoteSavedContext.Provider value={()=>setEditing(false)}>{note}</NoteSavedContext.Provider></aside>}
    {controls && <div className="viewer-controls">{controls}</div>}
    {showFrame&&saved&&<MediaPreview media={{id:saved.id,name:'Picked frame',url:saved.url,kind:'image',type:'image/png',width:saved.width,height:saved.height}} onClose={()=>setShowFrame(false)}/>}
    {organizing&&media.id&&<AssetCollections assetId={media.id} onClose={()=>setOrganizing(false)}/>}
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

