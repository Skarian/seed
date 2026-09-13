import React,{useEffect,useState} from 'react';
export function AssetThumbnail({id,name,onOpen,onRemove}:{id:string;name?:string;onOpen:()=>void;onRemove?:()=>void}){
 const [asset,setAsset]=useState<{name:string;kind:string}|null>(null);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/v1/assets/'+id,{signal:controller.signal}).then(r=>r.ok?r.json():null).then(setAsset).catch(()=>{});return()=>controller.abort();},[id]);
 const label=name??asset?.name??'Attached file',url='/api/v1/assets/'+id+'/content';
 return <div className="asset-thumbnail"><button type="button" className="asset-thumbnail-open" aria-label={'Preview '+label} onClick={onOpen}>{asset?.kind==='image'?<img src={url} alt=""/>:asset?.kind==='video'?<><video src={url+'#t=0.1'} muted playsInline preload="metadata"/><span className="thumbnail-play" aria-hidden="true">▶</span></>:<span className="thumbnail-file" aria-hidden="true">{asset?.kind==='audio'?'♫':'▧'}</span>}<span className="thumbnail-name">{label}</span></button>{onRemove&&<button type="button" className="asset-thumbnail-remove" aria-label={'Remove '+label} title="Remove attachment" onClick={onRemove}>×</button>}</div>;
}
