import React, { useEffect, useRef, useState } from 'react';
import { MediaPreview, Glyph } from './media-preview.js';
export type MediaKind = 'image' | 'video' | 'audio';
export type Reference = { id: string; name: string; url: string; kind: MediaKind; type: string; width?: number; height?: number; duration?: number; start: number; end: number; role: string };
type Group = 'edit' | 'video';
let nextReferenceId = 0;
async function inspect(file: File): Promise<Reference> {
  const kind = file.type.split('/')[0] as MediaKind;
  if (!['image', 'video', 'audio'].includes(kind)) throw new Error(`${file.name}: choose an image, video or audio file.`);
  const url = URL.createObjectURL(file);
  try {
    const metadata = await new Promise<{ width?: number; height?: number; duration?: number }>((resolve, reject) => {
      const element = kind === 'image' ? new Image() : document.createElement(kind);
      const timer = setTimeout(() => finish(new Error('Preview could not be read.')), 15000);
      function finish(error?: Error) {
        clearTimeout(timer); element.onerror = null;
        if (element instanceof HTMLImageElement) element.onload = null;
        else { element.onloadedmetadata = null; element.removeAttribute('src'); element.load(); }
        if (error) reject(error);
      }
      element.onerror = () => finish(new Error('This browser cannot preview this file. Try JPEG/PNG, MP4 or WAV/MP3.'));
      if (element instanceof HTMLImageElement) element.onload = () => {
        resolve({ width: element.naturalWidth, height: element.naturalHeight }); finish();
      };
      else {
        element.preload = 'metadata';
        element.onloadedmetadata = () => {
          if (!Number.isFinite(element.duration) || element.duration <= 0) { finish(new Error('No readable duration.')); return; }
          resolve({ duration: element.duration, ...(element instanceof HTMLVideoElement ? { width: element.videoWidth, height: element.videoHeight } : {}) }); finish();
        };
      }
      element.src = url;
    });
    return { id: `reference-${++nextReferenceId}`, name: file.name, url, kind, type: file.type, ...metadata, start: 0, end: Math.min(15, metadata.duration ?? 0), role: 'reference' };
  } catch (error) { URL.revokeObjectURL(url); throw new Error(`${file.name}: ${(error as Error).message}`); }
}
export function useReferences() {
  const [groups, setGroups] = useState<Record<Group, Reference[]>>({ edit: [], video: [] });
  const latest = useRef(groups); latest.current = groups;
  const epochs = useRef({ edit: 0, video: 0 });
  const [errors, setErrors] = useState<Record<Group, string[]>>({ edit: [], video: [] });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => () => { for (const list of Object.values(latest.current)) for (const item of list) URL.revokeObjectURL(item.url); }, []);
  function change(group: Group, list: Reference[]) { latest.current = { ...latest.current, [group]: list }; setGroups(latest.current); }
  function reset(group: Group) { epochs.current[group]++; for (const item of latest.current[group]) URL.revokeObjectURL(item.url); change(group, []); setErrors(previous => ({ ...previous, [group]: [] })); }
  async function add(group: Group, files: File[]) {
    if (pending.current) return;
    pending.current = true; setBusy(true); const epoch = epochs.current[group]; const messages: string[] = [];
    try {
      for (const file of files) {
        let item: Reference;
        try { item = await inspect(file); } catch (error) { messages.push((error as Error).message); continue; }
        if (epochs.current[group] !== epoch) { URL.revokeObjectURL(item.url); break; }
        const rest = latest.current[group];
        let reason = '';
        if (group === 'edit' && (item.kind !== 'image' || rest.length >= 2)) reason = 'Image editing accepts a source image and an optional subject image.';
        if (group === 'video' && (rest.length >= 12 || rest.filter(entry => entry.kind === item.kind).length >= (item.kind === 'image' ? 9 : 3))) reason = 'Reference video supports up to 9 images, 3 videos and 3 audio files, with 12 references combined.';
        if (group === 'video' && item.duration !== undefined && item.duration < 2) reason = 'Choose a video or audio source at least 2 seconds long.';
        if (reason) { messages.push(`${file.name}: ${reason}`); URL.revokeObjectURL(item.url); continue; }
        item.role = group === 'edit' ? (rest.some(entry => entry.role === 'source') ? 'subject' : 'source') : item.kind === 'image' && !rest.length ? 'first_frame' : 'reference';
        change(group, [...rest, item]);
      }
      if (epochs.current[group] === epoch) setErrors(previous => ({ ...previous, [group]: messages }));
    } finally { pending.current = false; setBusy(false); }
  }
  function remove(group: Group, id: string) { const item = latest.current[group].find(entry => entry.id === id); if (item) URL.revokeObjectURL(item.url); change(group, latest.current[group].filter(entry => entry.id !== id)); }
  function update(group: Group, id: string, values: Partial<Reference>) { change(group, latest.current[group].map(entry => entry.id === id ? { ...entry, ...values } : entry)); }
  return { groups, errors, busy, add, remove, update, reset };
}
export function ReferenceInputs({ group, state }: { group: Group; state: ReturnType<typeof useReferences> }) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const items = state.groups[group];
  const [dragging, setDragging] = useState(false);
  const issues: string[] = [];
  for (const item of items) if (item.kind !== 'image' && (item.start < 0 || item.end > item.duration! || item.end - item.start < 2 || item.end - item.start > 15)) issues.push(`${item.name}: choose a 2–15 second range within the source.`);
  for (const kind of ['video', 'audio'] as const) if (items.filter(item => item.kind === kind).reduce((total, item) => total + item.end - item.start, 0) > 15) issues.push(`Choose at most 15 seconds of ${kind} across the selected clips.`);
  const roles = group === 'edit' ? ['source', 'subject'] : ['first_frame', 'last_frame'];
  for (const role of roles) if (items.filter(item => item.role === role).length > 1) issues.push(`Choose only one ${role.replaceAll('_', ' ')} image.`);
  const active = items.find(item => item.id === selected);
  const errors = [...state.errors[group], ...issues];
  const controls = active && <>
    {active.kind === 'image' && <label className="viewer-role">Use as<select aria-label={`Role for ${active.name}`} value={active.role} onChange={event => state.update(group, active.id, { role: event.target.value })}>{(group === 'edit' ? [['source', 'Source scene'], ['subject', 'Subject identity']] : [['reference', 'Reference'], ['first_frame', 'First frame'], ['last_frame', 'Last frame']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    {active.duration !== undefined && <div className="clip-range"><span>Range (seconds)</span><label>From<input aria-label={`Start for ${active.name}`} type="number" min="0" max={active.duration} step="any" value={active.start} onChange={event => state.update(group, active.id, { start: Number(event.target.value) })} /></label><label>To<input aria-label={`End for ${active.name}`} type="number" min="0" max={active.duration} step="any" value={active.end} onChange={event => state.update(group, active.id, { end: Number(event.target.value) })} /></label></div>}
    {errors.length > 0 && <ul className="reference-errors" role="alert">{errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
  </>;
  return <section className="references" aria-label={group === 'edit' ? 'Image inputs' : 'Video references'}>
    <input ref={input} aria-label="Choose reference files" className="file-picker" type="file" accept={group === 'edit' ? 'image/*' : 'image/*,video/*,audio/*'} multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void state.add(group, files); }} />
    <div className={`reference-dropbox ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void state.add(group, Array.from(event.dataTransfer.files)); }}>
      <div className="reference-bar"><div className="reference-label"><span>{group === 'edit' ? 'Input Images' : 'References'}</span><details className="reference-help"><summary aria-label="Asset limits"><Glyph name="info" /></summary><div><span>{items.length} {items.length === 1 ? 'file' : 'files'} selected</span><strong>max: {group === 'edit' ? 2 : 12}</strong><span>{group === 'edit' ? 'One source image and an optional subject image.' : 'Up to 9 images, 3 videos and 3 audio files; 12 files combined.'}</span></div></details></div><button type="button" className="reference-add" aria-label="Add references" disabled={state.busy} onClick={() => input.current?.click()}>{state.busy ? '…' : '+'}</button></div>
      <div>
        {items.length ? <div className="reference-thumbnails">{items.map(item => <button type="button" className="reference-thumb" key={item.id} aria-label={`Preview ${item.name}`} onClick={() => setSelected(item.id)}>
          {item.kind === 'image' ? <img src={item.url} alt="" /> : item.kind === 'video' ? <><video src={item.url} muted preload="metadata" /><span className="media-symbol" aria-hidden="true">▶</span></> : <span className="audio-symbol" aria-hidden="true">♫</span>}
        </button>)}</div> : <button type="button" className="reference-empty" disabled={state.busy} onClick={() => input.current?.click()}>{state.busy ? 'Reading files…' : group === 'edit' ? 'Drop images here or browse' : 'Drop images, video or audio here or browse'}</button>}
      </div>
    </div>
    {!active && errors.length > 0 && <ul className="reference-errors" role="alert">{errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    {active && <MediaPreview key={active.id} media={active} onClose={() => setSelected(null)} onDelete={() => { state.remove(group, active.id); setSelected(null); }} controls={controls} />}
  </section>;
}
