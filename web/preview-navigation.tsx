import React,{useEffect,type RefObject} from 'react';

export type PreviewNavigation={index:number;total:number;onChange:(index:number)=>void;kind?:'input'|'output'|'library';hasMore?:boolean;loadingMore?:boolean};
export function movePreview(navigation:PreviewNavigation|undefined,direction:-1|1){
  if(!navigation)return;
  const next=navigation.index+direction;
  if(next>=0&&(next<navigation.total||(next===navigation.total&&navigation.hasMore&&!navigation.loadingMore)))navigation.onChange(next);
}
export function usePreviewKeyboard(dialog:RefObject<HTMLElement|null>,navigation?:PreviewNavigation){
  useEffect(()=>{
    function keydown(event:KeyboardEvent){
      if(!navigation||(navigation.total<2&&!navigation.hasMore)||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      // Disabled pending buttons can temporarily move focus to body. Still handle
      // arrows, but only for the topmost dialog and never inside editable/media controls.
      if([...document.querySelectorAll('[role="dialog"]')].at(-1)!==dialog.current)return;
      const target=event.target as Element;
      if(target.closest('input,textarea,select,video,audio,summary,[contenteditable="true"]'))return;
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();movePreview(navigation,event.key==='ArrowLeft'?-1:1);}
    }
    window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
  },[dialog,navigation]);
}
export function PreviewNavigationControls({navigation}:{navigation:PreviewNavigation}){
  if(navigation.total<2&&!navigation.hasMore)return null;
  const library=navigation.kind==='library';
  return <nav className="viewer-batch-navigation" aria-label={library?'Library navigation':'Output navigation'}>
    <button type="button" className="viewer-batch-arrow previous" aria-label={library?'Previous file':'Previous output'} disabled={navigation.index===0} onClick={()=>movePreview(navigation,-1)}><Chevron previous/></button>
    <span className="viewer-batch-position" aria-live="polite">{navigation.loadingMore?'Loading more…':`${navigation.index+1} of ${navigation.total}${navigation.hasMore?'+':''}`}</span>
    <button type="button" className="viewer-batch-arrow next" aria-label={library?'Next file':'Next output'} disabled={navigation.index===navigation.total-1&&(!navigation.hasMore||navigation.loadingMore)} onClick={()=>movePreview(navigation,1)}><Chevron/></button>
  </nav>;
}
function Chevron({previous=false}:{previous?:boolean}){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={previous?'m15 5-7 7 7 7':'m9 5 7 7-7 7'}/></svg>;
}
