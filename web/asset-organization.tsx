import React, {useRef, useState} from 'react';
import {toast} from 'react-hot-toast/headless';
import {Modal} from './modal.js';
import {usePreviewHistory} from './hooks/use-preview-history.js';
import {useAssetOrganization} from './hooks/use-asset-organization.js';
import {collectionApi, useCollections} from './collections.js';
import './asset-organization.css';

export {ORGANIZATION_CHANGED, getOrganizationEpoch, reconcileOrganization, publishOrganizationChange} from './hooks/use-asset-organization.js';
export type {OrganizationChange, AssetOrganization} from './hooks/use-asset-organization.js';

export function CollectionGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/><path d="M9 13h6m-3-3v6"/></svg>;
}

export function FavoriteButton({assetId,favorite,className=''}:{assetId:string;favorite?:boolean;className?:string}) {
  const state=useAssetOrganization(assetId,favorite);
  const label=state.error?'Retry loading favorite':state.favorite?'Remove from favorites':'Add to favorites';
  return <button type="button" className={'asset-favorite '+(state.favorite?'is-favorite ':'')+className} aria-label={label} title={label} aria-pressed={Boolean(state.favorite)} disabled={state.loading||state.pending} onClick={()=>{
    if(state.error){state.retry();return;}
    void state.setFavorite(!state.favorite).catch(error=>toast.error((error as Error).message));
  }}><svg viewBox="0 0 24 24" fill={state.favorite?'currentColor':'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.38 1.06 6.19L12 17.19l-5.56 2.92 1.06-6.19L3 9.54l6.22-.91z"/></svg></button>;
}

export function AssetCollections({assetId,onClose}:{assetId:string;onClose:()=>void}) {
  const close=usePreviewHistory(onClose),asset=useAssetOrganization(assetId);
  return <Modal className="asset-collections" aria-label="Add to collection" onCancel={event=>{event.preventDefault();close();}}>
    <header><h2>Add to collection</h2><button type="button" className="organization-close" aria-label="Close collections" onClick={()=>close()}>×</button></header>
    {asset.error?<p role="alert">{asset.error} <button type="button" onClick={asset.retry}>Retry</button></p>:asset.loading||!asset.organization.mode?<p role="status">Loading collections…</p>:<CollectionChoices key={assetId} asset={asset} mode={asset.organization.mode}/>}
  </Modal>;
}
function CollectionChoices({asset,mode}:{asset:ReturnType<typeof useAssetOrganization>;mode:'sfw'|'nsfw'}) {
  const collections=useCollections(mode),[name,setName]=useState(''),[creating,setCreating]=useState(false),[error,setError]=useState('');
  const createPending=useRef(false);
  const ids=asset.organization.collection_ids??[];
  async function create(event:React.FormEvent) {
    event.preventDefault();if(createPending.current||asset.pending||!name.trim())return;
    createPending.current=true;setCreating(true);setError('');
    try {const collection=await collectionApi('collections','POST',{name:name.trim(),mode});setName('');window.dispatchEvent(new Event('seed:collections-changed'));await asset.setIncluded(collection.id,true);}
    catch(failure){setError((failure as Error).message);}finally{createPending.current=false;setCreating(false);}
  }
  return <>
    {!collections.loaded?<p role="status">Loading collections…</p>:collections.items.length?<fieldset className="asset-collection-choices" disabled={asset.pending||creating}><legend>Save this file in</legend>{collections.items.map(collection=><label key={collection.id}><input type="checkbox" aria-label={collection.name} checked={ids.includes(collection.id)} onChange={event=>{setError('');void asset.setIncluded(collection.id,event.target.checked).catch(failure=>setError((failure as Error).message));}}/><span>{collection.name}</span><small>{collection.count}</small></label>)}</fieldset>:!collections.error&&<p className="organization-empty">No collections yet. Create one below.</p>}
    {collections.error&&<p role="alert">{collections.error} <button type="button" onClick={collections.refresh}>Retry</button></p>}
    <form className="asset-collection-create" onSubmit={event=>void create(event)}><label htmlFor="asset-collection-name">Collection name</label><div><input id="asset-collection-name" value={name} maxLength={80} placeholder="New collection" disabled={creating||asset.pending} onChange={event=>setName(event.target.value)}/><button type="submit" disabled={creating||asset.pending||!name.trim()}>{creating?'Adding…':'Create collection'}</button></div></form>
    {asset.pending&&<p className="organization-status" role="status">Saving…</p>}
    {error&&<p role="alert">{error}</p>}
  </>;
}
