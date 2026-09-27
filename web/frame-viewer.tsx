import {Modal} from './modal.js';
import { FrameCanvas } from './frame-canvas.js';
import { AssetNote } from './asset-note.js';
import { useFrameImage } from './frame-images.js';
import React, { useEffect, useRef, useState } from 'react';
import type { FrameSequence, LibraryAsset } from '../shared/studio.js';
import { ConfirmDialog } from './confirm-dialog.js';

export function FrameViewer({ id, onClose, onChanged, onPick, selectedIds = [], canPick }: {
  id:string; onClose:()=>void; onChanged?:()=>void;
  onPick?:(asset:LibraryAsset)=>void; selectedIds?:string[]; canPick?:(asset:LibraryAsset)=>boolean;
}) {
  const dialog=useRef<HTMLDivElement>(null);
  const [sequence,setSequence]=useState<FrameSequence|null>(null), [position,setPosition]=useState(0);
  const [selected,setSelected]=useState<string[]>([]);
  const [error,setError]=useState(''), [confirm,setConfirm]=useState(false), [zoom,setZoom]=useState(false);
  const [retry,setRetry]=useState(0), [displayed,setDisplayed]=useState('');
  const frame=sequence?.frames[position];
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/v1/sequences/'+encodeURIComponent(id),{signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw Error(body.error?.message??'Could not open sequence.');return body;
    }).then(setSequence).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[id,retry]);
  const original=useFrameImage(sequence,position,retry);
  useEffect(()=>{setZoom(false);},[frame?.id,retry]);
  const inspecting=Boolean(frame && displayed===frame.id && original.quality==='original' && original.bitmap);
  const [slowFrame,setSlowFrame]=useState('');
  useEffect(()=>{
    setSlowFrame('');
    if(inspecting||!frame)return;
    const timer=setTimeout(()=>setSlowFrame(frame.id),500);
    return ()=>clearTimeout(timer);
  },[frame?.id,inspecting,retry]);
  const asset:LibraryAsset|undefined=frame&&{id:frame.id,kind:'image',name:'Frame '+(frame.index+1),created_at:'',mode:sequence!.mode};
  const checked=frame&&(onPick?selectedIds:selected).includes(frame.id);
  const pickBlocked=Boolean(onPick&&!checked&&asset&&canPick&&!canPick(asset));
  const selectedPositions=(sequence?.frames??[]).flatMap((f,index)=>(onPick?selectedIds:selected).includes(f.id)?[index]:[]);
  const previous=[...selectedPositions].reverse().find(index=>index<position), next=selectedPositions.find(index=>index>position);
  return <Modal ref={dialog} className="frame-viewer" aria-label="Image sequence" onCancel={e=>{e.preventDefault();onClose();}}>
    <header><span>{sequence?.frames.length??0} frames{original.buffering && <small className="frame-buffering" role="status">Preparing previews…</small>}</span><div>
      {sequence?.cleanup_pending&&<p>Frame cleanup was interrupted. <button onClick={async()=>{
      try { const r=await fetch('/api/v1/sequences/'+id+'/retry-cleanup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const body=await r.json();if(!r.ok)throw Error(body.error?.message??'Cleanup failed.');onChanged?.();if(body.sequence)setSequence(body.sequence);else onClose(); }catch(e){setError((e as Error).message);}
    }}>Retry cleanup</button></p>}
    {frame&&<><button onClick={()=>setZoom(v=>!v)} disabled={!inspecting} data-frame-waiting={!inspecting}>{zoom?'Fit':'100%'}</button><a href={'/api/v1/assets/'+frame.id+'/content'} download>Download</a></>}
      <button aria-label="Close sequence" onClick={onClose}>×</button></div></header>
    {frame&&<>
      <div className={'frame-canvas'+(zoom?' zoomed':'')}>
        <FrameCanvas bitmap={original.bitmap} crop={original.crop} frameId={frame.id} frameIndex={frame.index} original={original.quality==='original'} onDisplay={setDisplayed}/>
        {!inspecting&&slowFrame===frame.id&&!original.error&&<span className="frame-loading" role="status">Loading original…</span>}
      </div>
      <div className="frame-controls">
        <div className="frame-position"><span>Frame {position+1} / {sequence!.frames.length} <small> · {frame.time.toFixed(2)}s</small></span>
          <button className="frame-check" aria-label="Select frame" aria-pressed={Boolean(checked)} disabled={!inspecting||pickBlocked} data-frame-waiting={!inspecting&&!pickBlocked}
            onClick={()=>{if(!asset)return;if(onPick)onPick(asset);else setSelected(ids=>ids.includes(frame.id)?ids.filter(x=>x!==frame.id):[...ids,frame.id]);}}>✓</button>
        </div>
        <input aria-label="Frame" type="range" min={0} max={sequence!.frames.length-1} step={1} value={position} onChange={e=>setPosition(Number(e.target.value))}/>
        <div className="frame-markers" aria-hidden="true">{sequence!.frames.map(f=><span key={f.id} className={(onPick?selectedIds:selected).includes(f.id)?'selected':''}/>)}</div>
        <div className="frame-bottom">
          <button className="frame-jump" aria-label="Previous selected frame" title="Previous selected frame" disabled={previous===undefined} onClick={()=>{if(previous!==undefined)setPosition(previous);}}>←</button>
          <div className="frame-floating"><span>{selectedPositions.length} selected</span>{!onPick&&<button disabled={!selected.length||selected.length===sequence!.frames.length} onClick={()=>setConfirm(true)}>Keep only</button>}</div>
          <button className="frame-jump" aria-label="Next selected frame" title="Next selected frame" disabled={next===undefined} onClick={()=>{if(next!==undefined)setPosition(next);}}>→</button>
        </div>
      </div>
    </>}
    <details><summary>Sequence note</summary><AssetNote id={id}/></details>
    {frame&&<details><summary>Frame note</summary><AssetNote key={frame.id} id={frame.id}/></details>}
    {(error||original.error)&&<p role="alert">{error||original.error} <button onClick={()=>setRetry(v=>v+1)}>Retry</button></p>}
    {!sequence&&!error&&<p role="status">Loading frames…</p>}
    {confirm&&sequence&&<ConfirmDialog title={`Keep ${selected.length} frames?`} description={`Permanently delete the other ${sequence.frames.length-selected.length} frames from your PC? This cannot be undone.`} action="Keep only" onClose={()=>setConfirm(false)} onConfirm={async()=>{
      const response=await fetch('/api/v1/sequences/'+id+'/keep-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asset_ids:selected,revision:sequence.revision})});
      const body=await response.json();if(!response.ok)throw Error(body.error?.message??'Could not remove frames.');
      setSequence(body);setPosition(0);setSelected([]);onChanged?.();
    }}/>}
  </Modal>;
}
