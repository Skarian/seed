import React, { createContext, useContext, useEffect, useState } from 'react';

export const NoteSavedContext=createContext<(()=>void)|undefined>(undefined);
export function AssetNote({ id,onSaved }: { id: string;onSaved?:()=>void }) {
  const closeEditor=useContext(NoteSavedContext);
  const [note,setNote]=useState(''), [revision,setRevision]=useState<number|null>(null);
  const [inherited,setInherited]=useState(''), [error,setError]=useState(''), [saving,setSaving]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setRevision(null);setNote('');setError('');
    void fetch('/api/v1/notes/'+encodeURIComponent(id),{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error('Could not load note.');return response.json();
    }).then(value=>{setNote(value.note);setRevision(value.revision);setInherited(value.inherited??'');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[id]);
  return <div className="asset-note"><label>Note<textarea aria-label="Asset note" value={note} maxLength={4000} disabled={revision===null||saving} placeholder={inherited || 'Optional description for prompting'} onChange={e=>setNote(e.target.value)}/></label>
    <button type="button" disabled={revision===null||saving} onClick={async()=>{
      setSaving(true);setError('');
      try {const response=await fetch('/api/v1/notes/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({note,revision})});const value=await response.json();if(!response.ok)throw Error(value.error?.message??'Could not save note.');setNote(value.note);setRevision(value.revision);(onSaved??closeEditor)?.();}
      catch(e){setError((e as Error).message);}finally{setSaving(false);}
    }}>{saving?'Saving…':'Save note'}</button>{error&&<p role="alert">{error}</p>}</div>;
}
