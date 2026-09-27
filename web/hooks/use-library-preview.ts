import {useEffect,useRef,useState} from 'react';
import type {LibraryAsset} from '../../shared/studio.js';
import type {useLibrary} from './use-library.js';
import type {PreviewNavigation} from '../preview-navigation.js';

/** Browse the visible library by identity; polling must not change the selected file. */
export function useLibraryPreview(library:ReturnType<typeof useLibrary>, scope:string) {
  const [selected,setSelected]=useState<{id:string;index:number;scope:string}|null>(null);
  const version=useRef(0),paging=useRef(false);
  const found=selected?.scope===scope?library.items.findIndex(asset=>asset.id===selected.id):-1;
  const index=found>=0?found:Math.min(selected?.index??0,library.items.length-1);
  // If a favorite/collection member disappears, continue with its nearest neighbor.
  const asset=selected?.scope===scope?library.items[index]??null:null;
  useEffect(()=>{
    if(!selected)return;
    if(selected.scope!==scope||!asset){version.current++;setSelected(null);}
    else if(selected.id!==asset.id||selected.index!==index){version.current++;setSelected({id:asset.id,index,scope});}
  },[asset?.id,index,scope,selected]);
  const choose=(item:LibraryAsset)=>{version.current++;setSelected({id:item.id,index:library.items.findIndex(asset=>asset.id===item.id),scope});};
  async function change(next:number) {
    if(library.items[next]){choose(library.items[next]);return;}
    if(next!==library.items.length||!library.cursor||paging.current)return;
    paging.current=true;
    const turn=++version.current;
    try {
      const additions=await library.more();
      if(turn===version.current&&additions?.[0])setSelected({id:additions[0].id,index:next,scope});
    } finally {paging.current=false;}
  }
  const navigation:PreviewNavigation={kind:'library',index,total:library.items.length,hasMore:!!library.cursor,loadingMore:library.loadingMore,onChange:next=>void change(next)};
  return {asset,navigation,open:choose,close:()=>{version.current++;setSelected(null);}};
}
