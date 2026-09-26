import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Modal} from './modal.js';
import {ConfirmDialog} from './confirm-dialog.js';
import {usePreviewHistory} from './hooks/use-preview-history.js';
import './collections.css';

export type Collection = {id:string;name:string;mode:'sfw'|'nsfw';count:number};
export async function collectionApi(url:string,method='GET',body?:unknown){
  const response=await fetch('/api/v1/'+url,{method,...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const value=response.status===204?null:await response.json();
  if(!response.ok)throw Error(value?.error?.message??'Could not save collection. Please try again.');
  return value;
}
export function useCollections(mode:'sfw'|'nsfw'){
  const [state,setState]=useState<{items:Collection[];loaded:boolean;error:string}>({items:[],loaded:false,error:''});
  const [revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/v1/collections?mode='+mode,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error('Could not load collections.');return response.json();
    }).then(value=>{if(!controller.signal.aborted)setState({items:value.items,loaded:true,error:''});})
      .catch(error=>{if(!controller.signal.aborted)setState(current=>({...current,loaded:true,error:error.message}));});
    return()=>controller.abort();
  },[mode,revision]);
  useEffect(()=>{
    window.addEventListener('seed:collections-changed',refresh);window.addEventListener('seed:library-changed',refresh);window.addEventListener('focus',refresh);
    return()=>{window.removeEventListener('seed:collections-changed',refresh);window.removeEventListener('seed:library-changed',refresh);window.removeEventListener('focus',refresh);};
  },[refresh]);
  return {...state,refresh};
}
export function LibraryFilters({collections,favoritesOnly,onFavoritesChange,collectionId,onCollectionChange,onManage,disabled=false}:{
  collections:ReturnType<typeof useCollections>;
  favoritesOnly:boolean;onFavoritesChange:(value:boolean)=>void;
  collectionId:string;onCollectionChange:(id:string)=>void;
  onManage?:()=>void;disabled?:boolean;
}){
  useEffect(()=>{
    if(collectionId&&collections.loaded&&!collections.error&&!collections.items.some(item=>item.id===collectionId))onCollectionChange('');
  },[collectionId,collections.loaded,collections.error,collections.items,onCollectionChange]);
  return <>
    <div className="library-tools">
      <button type="button" aria-label="Favorites" aria-pressed={favoritesOnly} disabled={disabled} onClick={()=>onFavoritesChange(!favoritesOnly)}>★ Favorites</button>
      <label>Collection<select value={collectionId} disabled={disabled||!collections.loaded||Boolean(collections.error)} onChange={event=>onCollectionChange(event.target.value)}><option value="">All collections</option>{collections.items.map(item=><option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}</select></label>
      {onManage&&<button type="button" disabled={disabled} onClick={onManage}>Manage collections</button>}
    </div>
    {collections.error&&<p role="alert">{collections.error} <button type="button" disabled={disabled} onClick={collections.refresh}>Retry</button></p>}
  </>;
}
export function CollectionManager({mode,onClose}:{mode:'sfw'|'nsfw';onClose:()=>void}){
  const close=usePreviewHistory(onClose),collections=useCollections(mode);
  const [name,setName]=useState(''),[editing,setEditing]=useState<{id:string;name:string}|null>(null),[deleting,setDeleting]=useState<Collection|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false);
  async function save(operation:()=>Promise<void>){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{await operation();window.dispatchEvent(new Event('seed:collections-changed'));}
    catch(error){setError((error as Error).message);}finally{pending.current=false;setBusy(false);}
  }
  return <Modal className="collections-dialog" aria-label="Manage collections" onCancel={()=>{if(!pending.current)close();}}>
    <header><div><h2>Collections</h2><p>Keep related files together.</p></div><button type="button" className="collection-close" aria-label="Close collections" disabled={busy} onClick={()=>close()}>×</button></header>
    <form className="collection-create" onSubmit={event=>{event.preventDefault();void save(async()=>{await collectionApi('collections','POST',{name:name.trim(),mode});setName('');});}}>
      <label>Collection name<input value={name} maxLength={80} placeholder="e.g. Summer portraits" onChange={event=>setName(event.target.value)} disabled={busy}/></label>
      <button className="primary-action" disabled={busy||!name.trim()}>Create collection</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {collections.error?<p role="alert">{collections.error} <button type="button" onClick={collections.refresh}>Retry</button></p>:!collections.loaded?<p role="status">Loading collections…</p>:<>
      {!collections.items.length&&<p className="collections-empty">No collections yet. Create one to get started.</p>}
      <ul className="collection-list">{collections.items.map(collection=><li key={collection.id}>
        {editing?.id===collection.id?<form className="collection-rename" onSubmit={event=>{event.preventDefault();void save(async()=>{await collectionApi('collections/'+collection.id,'PATCH',{name:editing.name.trim()});setEditing(null);});}}>
          <label>New collection name<input autoFocus value={editing.name} maxLength={80} disabled={busy} onChange={event=>setEditing({...editing,name:event.target.value})}/></label>
          <div className="collection-row-actions"><button className="primary-action" disabled={busy||!editing.name.trim()}>Save name</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Cancel rename</button></div>
        </form>:<><div className="collection-name"><strong>{collection.name}</strong><small>{collection.count} {collection.count===1?'file':'files'}</small></div><div className="collection-row-actions"><button type="button" disabled={busy} aria-label={'Rename '+collection.name} onClick={()=>{setEditing({id:collection.id,name:collection.name});setError('');}}>Rename</button><button type="button" disabled={busy} aria-label={'Delete '+collection.name} onClick={()=>setDeleting(collection)}>Delete</button></div></>}
      </li>)}</ul>
    </>}
    {deleting&&<ConfirmDialog title="Delete collection?" description={'Delete “'+deleting.name+'”? The files in it will stay in your Library.'} action="Delete collection" onClose={()=>setDeleting(null)} onConfirm={async()=>{await collectionApi('collections/'+deleting.id,'DELETE');if(editing?.id===deleting.id)setEditing(null);window.dispatchEvent(new Event('seed:collections-changed'));window.dispatchEvent(new Event('seed:library-changed'));}}/>}
  </Modal>;
}
