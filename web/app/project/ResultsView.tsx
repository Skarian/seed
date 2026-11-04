import React, { useMemo, useState } from 'react';
import type { Project } from '../api.js';
import { useApp, useAssets, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media } from '../ui.js';
import { titleOf, dayLabel } from '../format.js';

/** Every result made in this project, to compare and choose. Selection uses small tiles; inspection opens the viewer. */
export function ResultsView({ project }: { project: Project }) {
  const app = useApp();
  const [filter, setFilter] = useState<'all' | 'fav' | 'image' | 'video'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const list = useAssets({ mode: app.mode, chat_id: project.id, source: 'made', ...(filter === 'fav' ? { favorites: true } : {}), ...(filter === 'image' || filter === 'video' ? { kind: filter } : {}) });
  const jobsById = useMemo(() => new Map(project.jobs.map(j => [j.id, j])), [project.jobs]);
  const items: ViewerItem[] = list.items.map(a => { const job = a.job_id ? jobsById.get(a.job_id) : undefined; return { asset: a.id, kind: a.kind, title: a.title ?? (job ? titleOf(job.request) : a.name), job, project: project.id }; });
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s.slice(-1), id]);
  const groups: Array<[string, ViewerItem[]]> = [];
  for (const it of items) { const a = list.items.find(x => x.id === it.asset)!; const d = dayLabel(a.created_at); const g = groups.find(([k]) => k === d); if (g) g[1].push(it); else groups.push([d, [it]]); }
  return <>
    <div className="toolbar">
      <div className="seg" role="group" aria-label="Show">{([['all', 'All'], ['fav', 'Favorites'], ['image', 'Images'], ['video', 'Videos']] as const).map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'fav' ? <Icon.Heart width={14} height={14} /> : null}{l}</button>)}</div>
      <span className="spacer" style={{ flex: 1 }} />
      <span className="muted" aria-live="polite">{selected.length ? `${selected.length} selected` : 'Select two to compare'}</span>
      <button className="btn primary" disabled={selected.length !== 2} onClick={() => { const [a, b] = selected.map(id => items.find(i => i.asset === id)!); if (a && b) app.compare(a, b); }}><Icon.Compare />Compare</button>
    </div>
    <div className="scroll"><div className="col" style={{ maxWidth: 1200, paddingBottom: 24 }}>
      {list.loaded && !items.length && <div className="empty" style={{ minHeight: 280 }}><div><h2 className="serif" style={{ fontSize: 24 }}>{filter === 'fav' ? 'No favorites yet' : 'Nothing made yet'}</h2><p>{filter === 'fav' ? 'Tap ♥ on a result to keep it here.' : 'Results from this project appear here.'}</p>{filter !== 'all' && <button className="btn" onClick={() => setFilter('all')}>Show all</button>}</div></div>}
      {groups.map(([day, its]) => <section key={day}><div className="day">{day}</div><div className="grid dense">
        {its.map(it => { const on = selected.includes(it.asset); return <div key={it.asset} className={'tile' + (on ? ' selected' : '')}>
          <Media id={it.asset} kind={it.kind} alt={it.title} />
          <button className="open" aria-label={'Open ' + it.title} onClick={() => app.inspect(it, items)} />
          <button className="sel check" role="checkbox" aria-checked={on} aria-label={'Select ' + it.title + ' to compare'} onClick={() => toggle(it.asset)} style={{ position: 'absolute', top: 6, left: 6, background: on ? 'var(--accent)' : '#121311aa' }}>{on && <Icon.Check />}</button>
          <span className="corner"><button className="pill" onClick={() => app.go({ name: 'project', id: project.id, view: 'conversation', focus: it.job?.source?.card_id })} aria-label={'Show ' + it.title + ' in conversation'}><Icon.Chat width={13} height={13} /></button></span>
        </div>; })}
      </div></section>)}
      {list.cursor && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn" disabled={list.loading} onClick={() => void list.more()}>{list.loading ? 'Loading…' : 'Load more'}</button></div>}
    </div></div>
  </>;
}
