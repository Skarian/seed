import {Modal} from './modal.js';
import { useSpicy, presentAsset } from "./spicy-mode.js";
import React, { useEffect, useRef, useState } from 'react';
import type { LibraryAsset } from '../shared/studio.js';
import type { Reference } from './references.js';
import { LoadingIndicator } from './media-card.js';

export function GalleryPicker({ existing, onClose, onSelect }: {
  existing: Reference[]; onClose: () => void; onSelect: (assets: LibraryAsset[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [selected, setSelected] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { spicy } = useSpicy();
  const maximum = 12;
  async function load(after = '') {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/v1/assets?mode=' + (spicy?'nsfw':'sfw') + '&cursor=' + encodeURIComponent(after));
      if (!response.ok) throw Error('Could not load the gallery. Try again.');
      const page = await response.json();
      page.items = page.items.map(presentAsset);
      setAssets(current => after ? [...current, ...page.items.filter((a: LibraryAsset) => !current.some(b => a.id === b.id))] : page.items);
      setCursor(page.next_cursor);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(()=>{void load();},[]);
  const initialMode=useRef(spicy);
  useEffect(()=>{if(initialMode.current!==spicy)onClose();},[spicy]);
  const visible = assets.filter(a => (a.mode??'sfw') === (spicy?'nsfw':'sfw'));
  function unavailable(asset: LibraryAsset) {
    return existing.some(a => a.asset_id === asset.id) || existing.length + selected.length >= maximum ||
      ([...existing, ...selected].filter(a => a.kind === asset.kind).length >= (asset.kind === 'image' ? 9 : 3));
  }
  return <Modal ref={dialog} className="gallery-picker" aria-label="Choose from gallery" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><h2>Gallery</h2><button type="button" aria-label="Close gallery" disabled={saving} onClick={onClose}>×</button></header>
    <div className="gallery-options"><span>{selected.length} selected · {existing.length} already added · max: {maximum}</span></div>
    <p className="gallery-limits">Up to 9 images, 3 videos and 3 audio files; 12 combined, including video soundtracks.</p>
    <div className="gallery-scroll">
      <div className="gallery-grid">{visible.map(asset => {
        const checked = selected.some(a => a.id === asset.id);
        return <button type="button" className="gallery-tile" key={asset.id} aria-label={`Select ${asset.name}`} aria-pressed={checked} disabled={saving || (!checked && unavailable(asset))} onClick={() => setSelected(items => checked ? items.filter(a => a.id !== asset.id) : [...items, asset])}>
          {asset.kind === 'image' ? <img src={`/api/v1/assets/${asset.id}/content`} alt="" loading="lazy" /> : asset.kind === 'video' ? <><video src={`/api/v1/assets/${asset.id}/content`} muted playsInline preload="metadata" /><span className="gallery-kind">▶</span></> : <span className="audio-symbol">♫</span>}
          <span className="gallery-check">{checked ? '✓' : ''}</span>
        </button>;
      })}</div>
      {loading && <LoadingIndicator label="Loading gallery…" />}
      {!loading && !visible.length && <p>No matching files in the gallery.</p>}
      {error && <p role="alert">{error} <button onClick={() => void load(cursor ?? '')}>Retry</button></p>}
      {cursor && !loading && <button className="queue-control" onClick={() => void load(cursor)}>Load more</button>}
    </div>
    <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={!selected.length || saving} onClick={async () => { setSaving(true); try { await onSelect(selected); } catch (e) { setError((e as Error).message); setSaving(false); } }}>{saving ? 'Adding…' : `Select${selected.length ? ` (${selected.length})` : ''}`}</button></footer>
  </Modal>;
}
