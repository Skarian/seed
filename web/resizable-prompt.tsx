import React,{useRef,useState} from 'react';
import './resizable-prompt.css';

/** Shared pointer resize affordance for plain and rich prompt editors. */
export function ResizablePrompt({children,chat=false}:{children:React.ReactNode;chat?:boolean}){
 const root=useRef<HTMLDivElement>(null),drag=useRef<{y:number;height:number}|null>(null);
 const [height,setHeight]=useState<number>();
 function measured(){return root.current?.querySelector<HTMLElement>('textarea,[contenteditable]')?.offsetHeight??200;}
 function resize(value:number){setHeight(Math.round(Math.max(chat?96:140,Math.min(Math.max(240,window.innerHeight*.7),value))));}
 if(chat)return <>{children}</>;
 return <div ref={root} className={'resizable-prompt'+(chat?' resizable-chat':'')} style={height===undefined?undefined:{'--editor-height':height+'px'} as React.CSSProperties}>
  {children}
  <button type="button" className="prompt-resize-grip" aria-label="Resize prompt" title="Drag to resize, or use the up and down arrow keys" onPointerDown={e=>{e.preventDefault();drag.current={y:e.clientY,height:measured()};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)resize(drag.current.height+(e.clientY-drag.current.y)*(chat?-1:1));}} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();resize(measured()+(e.key==='ArrowDown'?24:-24));}}}>
   <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m8 19 11-11m-5 11 5-5"/></svg>
  </button>
 </div>;
}
