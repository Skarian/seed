import React, { useEffect, useMemo, useState } from 'react';
import { assets as assetsApi, collections as collectionsApi, projects as projectsApi, type AssetCollection, type LibraryAsset } from '../api.js';
import { useApp, useAssets, useStoredState, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media, MenuButton, Confirm, Dialog, downloadAsset } from '../ui.js';
import { dayLabel } from '../format.js';
import { StatusControl } from '../App.js';

type Filters = { kind: '' | 'image' | 'video' | 'audio'; source: '' | 'made' | 'uploaded'; favorites: boolean; collection: string; project: string; order: 'newest' | 'oldest' };
const none: Filters = { kind: '', source: '', favorites: false, collection: '', project: '', order: 'newest' };

export const assetTitle = (a: LibraryAsset) => (a.title ?? (a.name === 'Generated image' || a.name === 'Generated video' ? (a.kind === 'video' ? 'Video' : 'Image') : a.name)) + (a.variant && a.variants ? ` · ${a.variant} of ${a.variants}` : '');

/** Every result and upload: search, filter, sort into collections, act on several at once. */
export function LibraryPage({ collection }: { collection?: string } = {}) {
  const app = useApp();
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [f, setF] = useStoredState<Filters>('seed.library.filters', none);
  const [dense, setDense] = useStoredState('seed.library.dense', false);
  const [captions, setCaptions] = useStoredState('seed.library.captions', true);
  const [cols, setCols] = useState<AssetCollection[]>([]), [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<string[]>([]), [confirm, setConfirm] = useState(false), [toCollection, setToCollection] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQuery(q), 250); return () => clearTimeout(t); }, [q]);
  // Opened from a collection chip: show just that collection.
  useEffect(() => { if (collection) { setF({ ...none, collection }); app.go({ name: 'library' }, true); } }, [collection]);
  useEffect(() => { void collectionsApi.list(app.mode).then(setCols).catch(() => {}); }, [app.mode, toCollection]);
  // Membership changed elsewhere (a result's Details): refresh counts here too.
  useEffect(() => { const again = () => { void collectionsApi.list(app.mode).then(setCols).catch(() => {}); list.refresh(); }; addEventListener('seed:collections', again); return () => removeEventListener('seed:collections', again); }, [app.mode]);
  // Picking items to put into a collection: browse everything, then add the selection in one step.
  const [filling, setFilling] = useState<AssetCollection | null>(null);
  function startFilling(c: AssetCollection) { setFilling(c); setQ(''); setF(none); setSelecting(true); setSelected([]); }
  async function finishFilling() { const c = filling!; await bulk(id => assetsApi.inCollection(id, c.id, true), `Added to ${c.name}:`); setFilling(null); setSelecting(false); setF({ ...none, collection: c.id }); }
  const current = cols.find(c => c.id === f.collection);
  const list = useAssets({ mode: app.mode, q: query || undefined, kind: f.kind || undefined, source: f.source || undefined, favorites: f.favorites || undefined, collection_id: f.collection || undefined, chat_id: f.project || undefined, order: f.order });
  const items: ViewerItem[] = list.items.map(a => ({ asset: a.id, kind: a.kind, title: assetTitle(a), project: a.chat_id }));
  const shownKey = items.map(x => x.asset).join();
  useEffect(() => { app.syncSiblings(items); }, [shownKey]);
  const groups = useMemo(() => { const out: Array<[string, LibraryAsset[]]> = []; for (const a of list.items) { const d = dayLabel(a.created_at); const g = out.find(([k]) => k === d); if (g) g[1].push(a); else out.push([d, [a]]); } return out; }, [list.items]);
  const active: Array<[string, () => void]> = [
    ...(f.kind ? [[{ image: 'Images', video: 'Videos', audio: 'Audio' }[f.kind], () => setF({ ...f, kind: '' })] as [string, () => void]] : []),
    ...(f.source ? [[f.source === 'made' ? 'Made in Seed' : 'Uploaded', () => setF({ ...f, source: '' })] as [string, () => void]] : []),
    ...(f.favorites ? [['Favorites', () => setF({ ...f, favorites: false })] as [string, () => void]] : []),
    ...(f.collection ? [[cols.find(c => c.id === f.collection)?.name ?? 'Collection', () => setF({ ...f, collection: '' })] as [string, () => void]] : []),
    ...(f.project ? [[app.projectList.find(p => p.id === f.project)?.title ?? 'Project', () => setF({ ...f, project: '' })] as [string, () => void]] : []),
  ];
  const anyFilter = active.length > 0 || Boolean(query);
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  async function bulk(fn: (id: string) => Promise<unknown>, done: string) {
    const ids = [...selected]; let failed = 0;
    for (const id of ids) { try { await fn(id); } catch { failed++; } }
    app.toast(failed ? `${done} ${ids.length - failed}; ${failed} could not be changed (still saving or in use)` : `${done} ${ids.length}`);
    setSelected([]); list.refresh(); void collectionsApi.list(app.mode).then(setCols).catch(() => {});
  }
  return <>
    <header className="head"><h1 className="serif">Library</h1><span className="spacer" /><StatusControl /></header>
    <div className="toolbar">
      <label className="search-box"><Icon.Search /><input type="search" placeholder="Search prompts, titles and notes" aria-label="Search the Library" value={q} onChange={e => setQ(e.target.value)} /></label>
      <button className="btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><Icon.Tune />Filters{active.length ? ' · ' + active.length : ''}</button>
      <MenuButton label="Sort" className="btn" items={[{ label: 'Newest first', checked: f.order === 'newest', onSelect: () => setF({ ...f, order: 'newest' }) }, { label: 'Oldest first', checked: f.order === 'oldest', onSelect: () => setF({ ...f, order: 'oldest' }) }, 'divider', { label: dense ? 'Larger tiles' : 'Smaller tiles', onSelect: () => setDense(!dense) }, { label: captions ? 'Hide titles' : 'Show titles', onSelect: () => setCaptions(!captions) }]}>{f.order === 'newest' ? 'Newest' : 'Oldest'} ▾</MenuButton>
      <button className="btn" aria-pressed={selecting} onClick={() => { setSelecting(s => !s); setSelected([]); }}>{selecting ? 'Done' : 'Select'}</button>
      <nav className="chips shelves" aria-label="Collections" style={{ flexBasis: '100%' }}>
        <button className={'chip' + (!f.favorites && !f.collection ? ' on' : '')} onClick={() => setF({ ...f, favorites: false, collection: '' })}>Everything</button>
        <button className={'chip' + (f.favorites ? ' on' : '')} onClick={() => setF({ ...f, favorites: !f.favorites, collection: '' })}><Icon.Heart width={13} height={13} />Favorites</button>
        <NewShelf onCreate={async name => { const c = await collectionsApi.create(app.mode, name); setCols(x => [...x, c]); startFilling(c); }} />
        {cols.map(c => <button key={c.id} className={'chip' + (f.collection === c.id ? ' on' : '')} onClick={() => setF({ ...f, collection: f.collection === c.id ? '' : c.id, favorites: false })}>{c.name} <span className="faint">{c.count}</span></button>)}
      </nav>
      {active.length > 0 && <div className="chips" style={{ flexBasis: '100%' }}>{active.map(([label, clear]) => <button key={label} className="chip on" onClick={clear} aria-label={'Remove filter ' + label}>{label} <Icon.Close width={12} height={12} /></button>)}<button className="chip" onClick={() => setF(none)}>Clear filters</button></div>}
    </div>
    <div className="scroll"><div className="col" style={{ maxWidth: 1400, paddingBottom: 24 }}>
      {list.error && <div className="notice error" style={{ marginTop: 16 }}>{list.error} <button className="link" onClick={list.refresh}>Try again</button></div>}
      {list.loaded && !list.items.length && <div className="empty" style={{ minHeight: 320 }}><div>
        {current && current.count === 0 ? <><h2 className="serif" style={{ fontSize: 26 }}>“{current.name}” is empty</h2><p>Pick results from your Library to put in it.</p><button className="btn primary" onClick={() => startFilling(current)}>Add items</button></>
          : <><h2 className="serif" style={{ fontSize: 26 }}>{anyFilter ? 'Nothing matches' : 'Your Library is empty'}</h2>
        <p>{anyFilter ? (query ? `No results for “${query}”` : 'No media match these filters') + (current ? ` in “${current.name}”` : '') + '.' : 'Everything you make, and every file you attach in a project, appears here.'}</p>
        {anyFilter ? <button className="btn" onClick={() => { setF(none); setQ(''); }}>Clear search and filters</button>
          : <button className="btn primary" onClick={() => void projectsApi.create(app.mode).then(p => { app.refreshProjects(); app.go({ name: 'project', id: p.id, view: 'conversation' }); })}>Start a project</button>}</>}
      </div></div>}
      {groups.map(([day, list2]) => <section key={day}><div className="day">{day}</div><div className={'grid' + (dense ? ' dense' : '')}>
        {list2.map(a => { const it = items.find(i => i.asset === a.id)!, on = selected.includes(a.id); return <figure key={a.id} className="cell"><div className={'tile' + (on ? ' selected' : '')}>
          <Media id={a.id} kind={a.kind} alt={it.title} />
          <button className="open" aria-label={selecting ? (on ? 'Deselect ' : 'Select ') + it.title : 'Open ' + it.title} onClick={() => selecting ? toggle(a.id) : app.inspect(it, items)} />
          {selecting && <span className="check sel" role="checkbox" aria-checked={on} aria-hidden="true" style={{ position: 'absolute', top: 6, left: 6, background: on ? 'var(--accent)' : '#121311aa' }}>{on && <Icon.Check />}</span>}
          {a.favorite && <span className="corner" aria-label="Favorite"><Icon.HeartFill width={16} height={16} style={{ color: 'var(--accent)' }} /></span>}
          {a.kind !== 'image' && <span className="badge pill" aria-hidden="true">{a.kind === 'video' ? <><Icon.Play width={11} height={11} />Video</> : '♪ Audio'}</span>}
        </div>{captions && <figcaption><Caption title={it.title} /><small>{app.projectList.find(p => p.id === a.chat_id)?.title ?? (a.job_id ? '' : 'Uploaded')}</small></figcaption>}</figure>; })}
      </div></section>)}
      {list.cursor && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn" disabled={list.loading} onClick={() => void list.more()}>{list.loading ? 'Loading…' : 'Load more'}</button></div>}
    </div></div>
    {selecting && <div className="selectbar" role="toolbar" aria-label="Selected items">
      <b>{filling ? `Pick items for “${filling.name}” · ${selected.length} selected` : `${selected.length} selected`}</b>{list.cursor ? <span className="faint">(loaded items)</span> : null}
      {filling && <><span style={{ flex: 1 }} /><button className="btn" onClick={() => { const c = filling; setFilling(null); setSelecting(false); setF({ ...none, collection: c.id }); }}>Cancel</button><button className="btn primary" disabled={!selected.length} onClick={() => void finishFilling()}>Add {selected.length || ''} to “{filling.name}”</button></>}
      {!filling && <>
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={() => setSelected(selected.length === list.items.length ? [] : list.items.map(a => a.id))}>{selected.length === list.items.length ? 'Select none' : 'Select all loaded'}</button>
      <button className="btn" disabled={!selected.length} onClick={() => void bulk(id => assetsApi.favorite(id, true), 'Added to favorites:')}><Icon.Heart />Favorite</button>
      <button className="btn" disabled={!selected.length} onClick={() => void (async () => { for (const id of selected) { const a = list.items.find(x => x.id === id); if (a) await downloadAsset(id, assetTitle(a)); } app.toast(`Downloaded ${selected.length}`); })()}><Icon.Download />Download {selected.length || ''}</button>
      {selected.length === 2 && <button className="btn" onClick={() => { const [a, b] = selected.map(id => items.find(i => i.asset === id)); if (a && b) app.compare(a, b); }}><Icon.Compare />Compare</button>}
      <button className="btn" disabled={!selected.length} onClick={() => setToCollection(true)}>Add to collection</button>
      {f.collection && <button className="btn" disabled={!selected.length} onClick={() => void bulk(id => assetsApi.inCollection(id, f.collection, false), 'Removed from collection:')}>Remove from collection</button>}
      <button className="btn danger" disabled={!selected.length} onClick={() => setConfirm(true)}><Icon.Trash />Delete</button>
      </>}
    </div>}
    {filtersOpen && <Dialog title="Filters" onClose={() => setFiltersOpen(false)} footer={<><button className="btn" onClick={() => setF(none)}>Clear</button><button className="btn primary" onClick={() => setFiltersOpen(false)}>Show results</button></>}>
      <div className="field"><span>Kind</span><div className="seg">{([['', 'All'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio']] as const).map(([k, l]) => <button key={k} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div></div>
      <div className="field"><span>Source</span><div className="seg">{([['', 'All'], ['made', 'Made in Seed'], ['uploaded', 'Uploaded']] as const).map(([k, l]) => <button key={k} aria-pressed={f.source === k} onClick={() => setF({ ...f, source: k })}>{l}</button>)}</div></div>
      <button className="option" role="checkbox" aria-checked={f.favorites} onClick={() => setF({ ...f, favorites: !f.favorites })}><span className="check" aria-checked={f.favorites}>{f.favorites && <Icon.Check />}</span><span>Favorites only</span></button>
      <label className="field"><span>Collection</span><select className="select" value={f.collection} onChange={e => setF({ ...f, collection: e.target.value })}><option value="">Any</option>{cols.map(c => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}</select></label>
      <label className="field"><span>Project</span><select className="select" value={f.project} onChange={e => setF({ ...f, project: e.target.value })}><option value="">Any</option>{app.projectList.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    </Dialog>}
    {toCollection && <Dialog title={`Add ${selected.length} to a collection`} onClose={() => setToCollection(false)}>
      {cols.map(c => <button key={c.id} className="option" onClick={() => { setToCollection(false); void bulk(id => assetsApi.inCollection(id, c.id, true), `Added to ${c.name}:`); }}><span>{c.name}<small>{c.count} items</small></span></button>)}
      <NewCollection onCreate={async name => { const c = await collectionsApi.create(app.mode, name); setToCollection(false); await bulk(id => assetsApi.inCollection(id, c.id, true), `Added to ${c.name}:`); }} />
    </Dialog>}
    {confirm && <Confirm title={`Delete ${selected.length} ${selected.length === 1 ? 'item' : 'items'}?`} danger action="Delete permanently" onClose={() => setConfirm(false)}
      body={<p style={{ margin: 0 }}>They are removed from the Library and from their projects. Items that are still saving or used by a running request are skipped. This can't be undone.</p>}
      onConfirm={() => { setConfirm(false); void bulk(id => assetsApi.remove(id), 'Deleted'); }} />}
  </>;
}

/** A one-line way to start a new collection from the shelf row. */
function NewShelf({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false), [name, setName] = useState('');
  const create = () => { if (name.trim()) void onCreate(name.trim()).then(() => { setOpen(false); setName(''); }); };
  return <><button className="chip" onClick={() => setOpen(true)}><Icon.Plus width={13} height={13} />New collection</button>
    {open && <Dialog title="New collection" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={create}>Create</button></>}>
      <input className="input" autoFocus placeholder="For example: Postcard shortlist" aria-label="New collection name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} />
    </Dialog>}</>;
}

function NewCollection({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  return <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); if (name.trim()) void onCreate(name.trim()); }}><input className="input" placeholder="New collection" aria-label="New collection name" value={name} onChange={e => setName(e.target.value)} /><button className="btn" disabled={!name.trim()}>Create and add</button></form>;
}

/** A tile title whose version or batch place never truncates away. */
export function Caption({ title }: { title: string }) {
  const m = title.match(/^(.*?)((?: · v\d+)?(?: · \d+ of \d+)?)$/);
  const base = m?.[1] || title, badge = (m?.[2] ?? '').replace(/^ · /, '').trim();
  return <span className="cap"><span>{base}</span>{badge && <b>{badge}</b>}</span>;
}
