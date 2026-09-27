import {useEffect, useRef, useState} from 'react';

export type AssetOrganization = {id:string; mode:'sfw'|'nsfw'; favorite:boolean; collection_ids:string[]};
export type OrganizationChange = {id:string; favorite?:boolean; collection_ids?:string[]};
export const ORGANIZATION_CHANGED = 'seed:asset-organization-changed';
const pendingEvent = 'seed:asset-organization-pending';
const readEvent = 'seed:asset-organization-read';
const pendingIds = new Set<string>();
let epoch = 0;
type Change = {favorite?:boolean; favoriteEpoch?:number; collection_ids?:string[]; collectionsEpoch?:number};
// Only successful mutations are retained, never entire assets or Library pages.
const changes = new Map<string, Change>();

export function getOrganizationEpoch() { return epoch; }
export function reconcileOrganization<T extends {id:string; favorite?:boolean; collection_ids?:string[]}>(asset:T, readEpoch:number):T {
  const changed=changes.get(asset.id);
  if(!changed)return asset;
  // Fresh reads can observe edits from another device. Retain the old watermark
  // so an overlapping older read still cannot undo the last confirmed value.
  const confirmed:OrganizationChange={id:asset.id};
  if(changed.favoriteEpoch!==undefined&&readEpoch>=changed.favoriteEpoch&&asset.favorite!==undefined&&asset.favorite!==changed.favorite){changed.favorite=asset.favorite;confirmed.favorite=asset.favorite;}
  if(changed.collectionsEpoch!==undefined&&readEpoch>=changed.collectionsEpoch&&asset.collection_ids!==undefined&&JSON.stringify([...asset.collection_ids].sort())!==JSON.stringify([...(changed.collection_ids??[])].sort())){changed.collection_ids=asset.collection_ids;confirmed.collection_ids=asset.collection_ids;}
  if(confirmed.favorite!==undefined||confirmed.collection_ids!==undefined)window.dispatchEvent(new CustomEvent<OrganizationChange>(readEvent,{detail:confirmed}));
  return {...asset,
    ...((changed.favoriteEpoch??0)>readEpoch?{favorite:changed.favorite}:{}),
    ...((changed.collectionsEpoch??0)>readEpoch?{collection_ids:changed.collection_ids}:{}),
  };
}
export function publishOrganizationChange(change:OrganizationChange) {
  const next=++epoch,previous=changes.get(change.id)??{};
  changes.set(change.id,{...previous,
    ...(change.favorite!==undefined?{favorite:change.favorite,favoriteEpoch:next}:{}),
    ...(change.collection_ids!==undefined?{collection_ids:change.collection_ids,collectionsEpoch:next}:{}),
  });
  window.dispatchEvent(new CustomEvent<OrganizationChange>(ORGANIZATION_CHANGED,{detail:change}));
  window.dispatchEvent(new Event('seed:library-changed'));
  if(change.collection_ids!==undefined)window.dispatchEvent(new Event('seed:collections-changed'));
}
async function organizationApi(path:string, body?:unknown, signal?:AbortSignal) {
  const response=await fetch('/api/v1/'+path,{signal,...(body===undefined?{}:{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const value=await response.json();
  if(!response.ok)throw Error(value.error?.message??'Could not update this file. Try again.');
  return value;
}

export function useAssetOrganization(id:string, initialFavorite?:boolean) {
  const [organization,setOrganization]=useState<Partial<AssetOrganization>>(()=>reconcileOrganization({id,...(initialFavorite===undefined?{}:{favorite:initialFavorite})},0));
  const [loading,setLoading]=useState(initialFavorite===undefined),[error,setError]=useState(''),[revision,setRevision]=useState(0),[pending,setPending]=useState(pendingIds.has(id));
  const initial=useRef(initialFavorite);initial.current=initialFavorite;
  useEffect(()=>{
    const changed=(event:Event)=>{const change=(event as CustomEvent<OrganizationChange>).detail;if(change.id===id)setOrganization(current=>({...current,...change}));};
    const busy=()=>setPending(pendingIds.has(id));
    window.addEventListener(ORGANIZATION_CHANGED,changed);window.addEventListener(readEvent,changed);window.addEventListener(pendingEvent,busy);busy();
    return()=>{window.removeEventListener(ORGANIZATION_CHANGED,changed);window.removeEventListener(readEvent,changed);window.removeEventListener(pendingEvent,busy);};
  },[id]);
  useEffect(()=>{
    const abort=new AbortController();setError('');
    if(initial.current!==undefined){setOrganization(reconcileOrganization({id,favorite:initial.current},0));setLoading(false);return;}
    const readEpoch=getOrganizationEpoch();setOrganization(reconcileOrganization({id},0));setLoading(true);
    void organizationApi('assets/'+encodeURIComponent(id)+'/organization',undefined,abort.signal).then(value=>{
      if(!abort.signal.aborted)setOrganization(reconcileOrganization(value,readEpoch));
    }).catch(failure=>{if(!abort.signal.aborted)setError((failure as Error).message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[id,revision]);
  useEffect(()=>{
    if(initialFavorite!==undefined)setOrganization(current=>({...current,...reconcileOrganization({id,favorite:initialFavorite},0)}));
  },[id,initialFavorite]);
  async function mutate(path:string,body:unknown) {
    if(pendingIds.has(id))throw Error('This file is being updated. Please try again.');
    pendingIds.add(id);window.dispatchEvent(new Event(pendingEvent));
    try {const value=await organizationApi(path,body);publishOrganizationChange(value);}
    finally {pendingIds.delete(id);window.dispatchEvent(new Event(pendingEvent));}
  }
  return {organization, favorite:organization.favorite, loading, error, pending,
    retry:()=>setRevision(value=>value+1),
    setFavorite:(favorite:boolean)=>mutate('assets/'+encodeURIComponent(id)+'/favorite',{favorite}),
    setIncluded:(collectionId:string,included:boolean)=>mutate('assets/'+encodeURIComponent(id)+'/collections/'+encodeURIComponent(collectionId),{included}),
  };
}
