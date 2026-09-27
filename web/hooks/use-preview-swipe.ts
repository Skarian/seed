import {useRef, type PointerEvent,type MouseEvent} from 'react';

/** A deliberate, single-finger horizontal swipe. Leave screen edges for browser Back. */
export function usePreviewSwipe(onSwipe?: (direction: -1 | 1) => void) {
  const gesture=useRef<{id:number;x:number;y:number;lastX:number;lastY:number}|null>(null);
  const suppressClick=useRef(false);
  function cancel(){gesture.current=null;}
  return {
    onPointerDown(event:PointerEvent<HTMLElement>){
      suppressClick.current=false;
      if(gesture.current){cancel();return;}
      const target=event.target as Element;
      if(!onSwipe||event.pointerType!=='touch'||!event.isPrimary||event.clientX<24||event.clientX>window.innerWidth-24||target.closest('button,a,input,textarea,select,audio,summary'))return;
      // Native video scrubber/volume controls must retain their gestures.
      const video=target.closest('video');if(video&&event.clientY>video.getBoundingClientRect().bottom-64)return;
      gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY};
    },
    onPointerMove(event:PointerEvent<HTMLElement>){
      const start=gesture.current;if(start?.id!==event.pointerId)return;
      start.lastX=event.clientX;start.lastY=event.clientY;
      if(Math.abs(start.lastY-start.y)>48&&Math.abs(start.lastY-start.y)>Math.abs(start.lastX-start.x))cancel();
    },
    onPointerUp(event:PointerEvent<HTMLElement>){
      const start=gesture.current;cancel();if(start?.id!==event.pointerId)return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;
      if(Math.abs(dx)>=64&&Math.abs(dx)>Math.abs(dy)*1.5){suppressClick.current=true;onSwipe?.(dx<0?1:-1);}
    },
    onClickCapture(event:MouseEvent<HTMLElement>){if(suppressClick.current){suppressClick.current=false;event.preventDefault();event.stopPropagation();}},
    onPointerCancel:cancel,onLostPointerCapture:cancel,
  };
}
