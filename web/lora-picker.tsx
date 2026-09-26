import React, {useEffect,useState} from 'react';
import type {LoraSelection} from '../shared/generation.js';
import {useSpicy} from './spicy-mode.js';
import './lora-picker.css';
import {useWorkerPool} from './hooks/use-worker-pool.js';
type Entry={id:string;revision:string;name:string;version?:string;description?:string;source_url?:string;route:string;availability:'all'|'spicy';compatibility:string;source_status?:'ready'|'needs_source';default_scale?:number;trigger_words?:string[]};
export function LoraPicker({route,mode,value=[],onChange}:{route:string;mode?:'sfw'|'nsfw';value?:LoraSelection[];onChange:(next:LoraSelection[])=>void}) {
  const pool=useWorkerPool();
  const {spicy}=useSpicy(),currentMode=mode??(spicy?'nsfw':'sfw');
  const [loaded,setLoaded]=useState<{mode:string;items:Entry[]}|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const entries=loaded?.mode===currentMode?loaded.items:[];
  useEffect(()=>{const controller=new AbortController();setError('');
    void fetch('/api/v1/loras?mode='+currentMode,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Could not load LoRAs.');return r.json();}).then(data=>{if(!controller.signal.aborted)setLoaded({mode:currentMode,items:data.items});}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[currentMode,revision]);
  useEffect(()=>{
    if(loaded?.mode!==currentMode)return;
    const available=value.filter(v=>entries.some(e=>e.id===v.id&&e.revision===v.revision&&e.route===route));
    if(available.length!==value.length)onChange(available);
  },[loaded,currentMode,route,value,onChange]);
  useEffect(()=>{const refresh=()=>setRevision(v=>v+1);window.addEventListener('seed:loras-changed',refresh);return()=>window.removeEventListener('seed:loras-changed',refresh);},[]);
  function strength(id:string,scale:number){onChange(value.map(v=>v.id===id?{...v,scale}:v));}
  return <fieldset className="lora-picker"><legend>LoRAs{value.length?` (${value.length})`:''}</legend>
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Retry</button></p>}
    {!error&&loaded?.mode!==currentMode&&<p role="status">Loading LoRAs…</p>}
    {!error&&loaded?.mode===currentMode&&!entries.some(e=>e.route===route)&&<p className="lora-empty">No LoRAs available for this workflow.</p>}
    {entries.filter(e=>e.route===route).map(entry=>{const selected=value.find(v=>v.id===entry.id);return <section className={'lora-option'+(selected?' enabled':'')} key={entry.id}>
      <label className="lora-name"><input type="checkbox" checked={Boolean(selected)} disabled={!selected&&(value.length>=3||entry.source_status==='needs_source')} onChange={e=>onChange(e.target.checked?[...value,{id:entry.id,revision:entry.revision,scale:entry.default_scale??1}]:value.filter(v=>v.id!==entry.id))}/><span>{entry.name}{entry.version&&<small>{entry.version}</small>}</span></label>
      {entry.description&&<p className="lora-description">{entry.description}</p>}{entry.source_status==='needs_source'&&<p className="lora-worker-notice">Reimport from Civitai before starting a worker. <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('seed:admin-open',{detail:{section:'loras'}}))}>Open LoRAs ↗</button></p>}
      {selected&&entry.source_status!=='needs_source'&&!pool.snapshot?.workers.some(worker=>!worker.quit_mode&&worker.state!=='released'&&worker.installed_loras.some(lora=>lora.id===entry.id&&lora.revision===entry.revision))&&<p className="lora-worker-notice">Needs a newly prepared worker. <button type="button" onClick={()=>pool.open(route==='image'?'image':'video')}>Open workers ↗</button></p>}
      {selected&&<div className="lora-strength"><label>Strength<input aria-label="Strength" type="number" min={0} max={4} step={0.1} value={selected.scale} onChange={e=>strength(entry.id,Number(e.target.value))}/></label><input aria-label={'Strength slider for '+entry.name} type="range" min={0} max={4} step={0.1} value={selected.scale} onChange={e=>strength(entry.id,Number(e.target.value))}/><small>0–4 · Default {entry.default_scale??1}</small></div>}
      <details className="lora-details"><summary>Details</summary><div><span>{entry.compatibility==='verified'?'Runtime verified':'Not yet tested on a worker'}</span>{entry.source_url&&<a href={entry.source_url} target="_blank" rel="noopener noreferrer">Source ↗</a>}{entry.trigger_words?.length?<span>Triggers: {entry.trigger_words.join(', ')}</span>:null}<a href="/admin?section=loras">Manage in Admin ↗</a></div></details>
    </section>;})}
  </fieldset>;
}

export function SelectedLoras({request}:{request:{mode:'sfw'|'nsfw';loras?:LoraSelection[]}}){
 const [entries,setEntries]=useState<Entry[]>([]);const ids=request.loras?.map(l=>l.id).join(',')??'';
 useEffect(()=>{if(!ids)return;const controller=new AbortController();void fetch('/api/v1/loras?mode='+request.mode,{signal:controller.signal}).then(r=>r.json()).then(data=>{if(!controller.signal.aborted)setEntries(data.items??[]);}).catch(()=>{});return()=>controller.abort();},[request.mode,ids]);
 return ids?<span className="selected-loras">{request.loras!.map(l=>{const entry=entries.find(e=>e.id===l.id);return <span key={l.id}>{entry?.name??'LoRA'}{entry?.version?' '+entry.version:''} · {l.scale}</span>;})}</span>:null;
}
