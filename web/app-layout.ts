import {useEffect,useState} from 'react';
export function useAppLayout(){
  const [wide,setWide]=useState(()=>matchMedia('(min-width:1100px)').matches);
  const [open,setOpen]=useState(()=>matchMedia('(min-width:1100px)').matches);
  useEffect(()=>{const media=matchMedia('(min-width:1100px)');const change=()=>{setWide(media.matches);setOpen(media.matches);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{const viewport=visualViewport;const update=()=>{document.documentElement.style.setProperty('--viewport-height',`${viewport?.height??innerHeight}px`);document.documentElement.style.setProperty('--viewport-top',`${viewport?.offsetTop??0}px`);};update();viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);return()=>{viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);};},[]);
  return {open,setOpen,wide};
}
