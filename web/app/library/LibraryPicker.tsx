import React, { useEffect, useState } from 'react';
import type { LibraryAsset } from '../api.js';
import { useApp, useAssets } from '../data.js';
import { Icon } from '../icons.js';
import { Dialog, Media } from '../ui.js';
import { assetTitle } from './LibraryPage.js';

/** Attach from the Library without leaving the composer. Unsent text stays where it was. */
export function LibraryPicker({ onClose, onPick }: { onClose: () => void; onPick: (items: Array<LibraryAsset & { title?: string }>) => void }) {
  const app = useApp();
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [kind, setKind] = useState<'' | 'image' | 'video' | 'audio'>('');
  const [chosen, setChosen] = useState<LibraryAsset[]>([]);
  useEffect(() => { const t = setTimeout(() => setQuery(q), 250); return () => clearTimeout(t); }, [q]);
  const list = useAssets({ mode: app.mode, q: query || undefined, kind: kind || undefined });
  const toggle = (a: LibraryAsset) => setChosen(c => c.some(x => x.id === a.id) ? c.filter(x => x.id !== a.id) : [...c, a]);
  return <Dialog title="Attach from Library" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!chosen.length} onClick={() => onPick(chosen.map(a => ({ ...a, title: assetTitle(a) })))}>Attach {chosen.length || ''}</button></>}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <label className="search-box" style={{ flex: 1, minWidth: 200 }}><Icon.Search /><input type="search" placeholder="Search prompts, titles and notes" aria-label="Search the Library" value={q} onChange={e => setQ(e.target.value)} autoFocus /></label>
      <div className="seg">{([['', 'All'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio']] as const).map(([k, l]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>
    </div>
    {list.loaded && !list.items.length && <p className="muted">{query ? `Nothing matches “${query}”.` : 'Nothing here yet.'}</p>}
    <div className="grid dense">
      {list.items.map(a => { const on = chosen.some(x => x.id === a.id); return <div key={a.id} className={'tile' + (on ? ' selected' : '')}>
        <Media id={a.id} kind={a.kind} alt={assetTitle(a)} />
        <button className="open" role="checkbox" aria-checked={on} aria-label={assetTitle(a)} onClick={() => toggle(a)} />
        {on && <span className="check sel" aria-hidden="true" style={{ position: 'absolute', top: 6, left: 6, background: 'var(--accent)' }}><Icon.Check /></span>}
      </div>; })}
    </div>
    {list.cursor && <button className="btn" disabled={list.loading} onClick={() => void list.more()}>Load more</button>}
  </Dialog>;
}
