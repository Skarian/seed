import {Modal} from './modal.js';
import { useSpicy } from "./spicy-mode.js";
import React, { useEffect, useRef, useState } from 'react';
import type { LibraryAsset } from '../shared/studio.js';
import type { Reference } from './references.js';
import { LoadingIndicator } from './media-card.js';
import {LibraryFilters,useCollections} from './collections.js';
import {useLibrary} from './hooks/use-library.js';

const ignoreDeletion=()=>{};

export function GalleryPicker({ existing, onClose, onSelect, imagesOnly=false }: {
  imagesOnly?:boolean;
  existing: Reference[]; onClose: () => void; onSelect: (assets: LibraryAsset[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<LibraryAsset[]>([]);
  const [favoritesOnly,setFavoritesOnly]=useState(false),[collectionId,setCollectionId]=useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { spicy } = useSpicy();
  const mode=spicy?'nsfw':'sfw';
  const collections=useCollections(mode),library=useLibrary(mode,imagesOnly?'image':'all',ignoreDeletion,favoritesOnly,collectionId);
  const maximum = imagesOnly?10:12;
  const initialMode=useRef(spicy);
  useEffect(()=>{if(initialMode.current!==spicy)onClose();},[spicy]);
  const visible = library.items;
  function unavailable(asset: LibraryAsset) {
    return existing.some(a => a.asset_id === asset.id) || existing.length + selected.length >= maximum ||
      ([...existing, ...selected].filter(a => a.kind === asset.kind).length >= (imagesOnly?10:asset.kind === 'image' ? 9 : 3));
  }
  return <Modal ref={dialog} className="gallery-picker" aria-label="Choose from gallery" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><h2>Gallery</h2><button type="button" aria-label="Close gallery" disabled={saving} onClick={onClose}>×</button></header>
    <div className="gallery-options"><span>{selected.length} selected · {existing.length} already added · max: {maximum}</span></div>
    <p className="gallery-limits">{imagesOnly?'One source image and up to 9 optional reference images.':'Up to 9 images, 3 videos and 3 audio files; 12 combined, including video soundtracks.'}</p>
    <LibraryFilters collections={collections} favoritesOnly={favoritesOnly} onFavoritesChange={setFavoritesOnly} collectionId={collectionId} onCollectionChange={setCollectionId} disabled={saving}/>
    <div className="gallery-scroll">
      <div className="gallery-grid">{visible.map(asset => {
        const checked = selected.some(a => a.id === asset.id);
        return <button type="button" className="gallery-tile" key={asset.id} aria-label={`Select ${asset.name}`} aria-pressed={checked} disabled={saving || (!checked && unavailable(asset))} onClick={() => setSelected(items => checked ? items.filter(a => a.id !== asset.id) : [...items, asset])}>
          {asset.kind === 'image' ? <img src={`/api/v1/assets/${asset.id}/content`} alt="" loading="lazy" /> : asset.kind === 'video' ? <><video src={`/api/v1/assets/${asset.id}/content`} muted playsInline preload="metadata" /><span className="gallery-kind">▶</span></> : <span className="audio-symbol">♫</span>}
          <span className="gallery-check">{checked ? '✓' : ''}</span>
        </button>;
      })}</div>
      {!library.loaded && !library.error && <LoadingIndicator label="Loading gallery…" />}
      {library.loaded && !visible.length && <p>No matching files in the gallery.</p>}
      {library.error && <p role="alert">{library.error} <button type="button" onClick={library.refresh}>Retry</button></p>}
      {error && <p role="alert">{error}</p>}
      {library.cursor && <button type="button" className="queue-control" disabled={library.loadingMore||saving} onClick={() => void library.more()}>{library.loadingMore?'Loading…':'Load more'}</button>}
    </div>
    <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={!selected.length || saving} onClick={async () => { setSaving(true); try { await onSelect(selected); } catch (e) { setError((e as Error).message); setSaving(false); } }}>{saving ? 'Adding…' : `Select${selected.length ? ` (${selected.length})` : ''}`}</button></footer>
  </Modal>;
}
