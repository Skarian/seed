import React,{useEffect,useRef} from 'react';
export function AttachmentMenu({disabled,onFiles,onLibrary}:{disabled:boolean;onFiles:()=>void;onLibrary:()=>void}){
 const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{const popup=menu.current!;let frame=0;
  function position(){if(!popup.matches(':popover-open'))return;const button=trigger.current!.getBoundingClientRect(),viewport=window.visualViewport;const left=Math.max((viewport?.offsetLeft??0)+8,Math.min(button.left,(viewport?.offsetLeft??0)+(viewport?.width??innerWidth)-popup.offsetWidth-8));const top=Math.max((viewport?.offsetTop??0)+8,button.top-popup.offsetHeight-8);const x=left+'px',y=top+'px';if(popup.style.left!==x)popup.style.left=x;if(popup.style.top!==y)popup.style.top=y;frame=requestAnimationFrame(position);}
  function toggle(){cancelAnimationFrame(frame);if(popup.matches(':popover-open'))position();}
  popup.addEventListener('toggle',toggle);return()=>{cancelAnimationFrame(frame);popup.removeEventListener('toggle',toggle);};
 },[]);
 function close(action:()=>void){menu.current?.hidePopover();action();}
 return <><button ref={trigger} type="button" className="attachment-trigger" aria-label="Add attachments" popoverTarget="chat-attachments" disabled={disabled}>+</button><div ref={menu} id="chat-attachments" className="attachment-menu" popover="auto"><button type="button" onClick={()=>close(onFiles)}>Add File(s)</button><button type="button" onClick={()=>close(onLibrary)}>Add from Library</button></div></>;
}
