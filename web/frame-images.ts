import { useEffect, useRef, useState } from 'react';
import type { FrameSequence } from '../shared/studio.js';

// Keep only the inspected original and its two neighbors in memory.
export function useFrameImage(frames: FrameSequence['frames'] | undefined, index: number, retry: number) {
  const cache=useRef(new Map<string,{url?:string;error?:string;controller:AbortController}>());
  const [,refresh]=useState(0);
  const lastRetry=useRef(retry);
  useEffect(()=>{
    const wanted=(frames??[]).slice(Math.max(0,index-1),index+2).map(f=>f.id);
    for(const [id,entry] of cache.current) if(!wanted.includes(id)) {
      entry.controller.abort();if(entry.url)URL.revokeObjectURL(entry.url);cache.current.delete(id);
    }
    if(lastRetry.current!==retry) {for(const [id,entry] of cache.current)if(entry.error)cache.current.delete(id);lastRetry.current=retry;}
    const current=frames?.[index]?.id;
    for(const id of [current,...wanted].filter((id):id is string=>Boolean(id))) {
      if(cache.current.has(id))continue;
      const controller=new AbortController(), entry:{url?:string;error?:string;controller:AbortController}={controller};
      cache.current.set(id,entry);
      void fetch('/api/v1/assets/'+id+'/content',{signal:controller.signal}).then(async response=>{
        if(!response.ok)throw Error('Original frame is unavailable.');
        const blob=await response.blob();if(controller.signal.aborted)return;
        entry.url=URL.createObjectURL(blob);refresh(v=>v+1);
      }).catch(e=>{if(!controller.signal.aborted){entry.error=e.message;refresh(v=>v+1);}});
    }
  },[frames,index,retry]);
  useEffect(()=>()=>{for(const entry of cache.current.values()){entry.controller.abort();if(entry.url)URL.revokeObjectURL(entry.url);}cache.current.clear();},[]);
  return {url:cache.current.get(frames?.[index]?.id??'')?.url??'',error:cache.current.get(frames?.[index]?.id??'')?.error??''};
}
