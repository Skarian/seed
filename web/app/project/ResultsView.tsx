import React, { useMemo, useState } from 'react';
import type { Project } from '../api.js';
import { useApp, useAssets, useStoredState, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media } from '../ui.js';
import { titleOf, latest } from '../format.js';

/**
 * The project board: every deliverable (a draft's title) with its variants side by side, what is
 * still planned, and which result is the chosen one (a favorite). Selecting two compares them.
 */
export function ResultsView({ project }: { project: Project }) {
  const app = useApp();
  const [filter, setFilter] = useState<'all' | 'fav' | 'image' | 'video'>('all');
  const [size, setSize] = useStoredState<'s' | 'm' | 'l'>('seed.results.size', 'm');
  const [selected, setSelected] = useState<string[]>([]);
  const list = useAssets({ mode: app.mode, chat_id: project.id, source: 'made', ...(filter === 'fav' ? { favorites: true } : {}), ...(filter === 'image' || filter === 'video' ? { kind: filter } : {}) });
  const jobsById = useMemo(() => new Map(project.jobs.map(j => [j.id, j])), [project.jobs]);
  const items: ViewerItem[] = list.items.map(a => {
    const job = a.job_id ? jobsById.get(a.job_id) : undefined, base = a.title ?? (job ? titleOf(job.request) : a.name);
    return { asset: a.id, kind: a.kind, title: job && job.request.count > 1 ? `${base} · ${job.submission_index + 1} of ${job.request.count}` : base, job, project: project.id };
  });
  const fav = new Set(list.items.filter(a => a.favorite).map(a => a.id));
  // Deliverables in the order they were first made; planned drafts that have no result yet are listed too.
  const groups = new Map<string, ViewerItem[]>();
  for (const it of [...items].reverse()) { const key = (it.job ? titleOf(it.job.request) : it.title).toLowerCase(); groups.set(key, [...(groups.get(key) ?? []), it]); }
  const planned = project.groups.filter(g => ['reviewing', 'revising', 'assembling'].includes(g.state) && !g.direct).flatMap(g => g.cards.map(c => titleOf(latest(c).request))).filter(t => !groups.has(t.toLowerCase()));
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s.slice(-1), id]);
  const min = { s: 120, m: 180, l: 280 }[size];
  return <>
    <div className="toolbar">
      <div className="seg" role="group" aria-label="Show">{([['all', 'All'], ['fav', 'Chosen'], ['image', 'Images'], ['video', 'Videos']] as const).map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'fav' ? <Icon.Heart width={14} height={14} /> : null}{l}</button>)}</div>
      <div className="seg" role="group" aria-label="Tile size">{(['s', 'm', 'l'] as const).map(k => <button key={k} aria-pressed={size === k} aria-label={{ s: 'Small tiles', m: 'Medium tiles', l: 'Large tiles' }[k]} onClick={() => setSize(k)}>{k.toUpperCase()}</button>)}</div>
      <span style={{ flex: 1 }} />
      <span className="muted" aria-live="polite">{selected.length ? `${selected.length} selected` : 'Select two to compare'}</span>
      <button className="btn primary" disabled={selected.length !== 2} onClick={() => { const [a, b] = selected.map(id => items.find(i => i.asset === id)!); if (a && b) app.compare(a, b); }}><Icon.Compare />Compare</button>
    </div>
    <div className="scroll"><div className="col" style={{ maxWidth: 1400, paddingBottom: 24 }}>
      {list.loaded && !items.length && !planned.length && <div className="empty" style={{ minHeight: 280 }}><div><h2 className="serif" style={{ fontSize: 24 }}>{filter === 'fav' ? 'Nothing chosen yet' : 'Nothing made yet'}</h2><p>{filter === 'fav' ? 'Tap ♥ on a result to mark it as the one you want.' : 'Results from this project appear here, grouped by what they are.'}</p>{filter !== 'all' && <button className="btn" onClick={() => setFilter('all')}>Show all</button>}</div></div>}
      {[...groups.entries()].map(([key, its]) => <section key={key} className="deliverable">
        <div className="day"><span>{its[0]!.job ? titleOf(its[0]!.job.request) : its[0]!.title}</span><span className="faint" style={{ fontWeight: 400 }}> · {its.length} {its.length === 1 ? 'result' : 'results'}{its.some(i => fav.has(i.asset)) ? ' · chosen ♥' : ''}</span></div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
          {its.map(it => { const on = selected.includes(it.asset); return <figure key={it.asset} className="cell"><div className={'tile' + (on ? ' selected' : '')}>
            <Media id={it.asset} kind={it.kind} alt={it.title} />
            <button className="open" aria-label={'Open ' + it.title} onClick={() => app.inspect(it, items)} />
            <button className="sel check" role="checkbox" aria-checked={on} aria-label={'Select ' + it.title + ' to compare'} onClick={() => toggle(it.asset)} style={{ position: 'absolute', top: 6, left: 6, background: on ? 'var(--accent)' : '#121311aa' }}>{on && <Icon.Check />}</button>
            <span className="corner">{fav.has(it.asset) && <span className="pill" aria-label="Chosen"><Icon.HeartFill width={12} height={12} style={{ color: 'var(--accent)' }} /></span>}<button className="pill" onClick={() => app.go({ name: 'project', id: project.id, view: 'conversation', focus: it.job?.source?.card_id })} aria-label={'Show ' + it.title + ' in conversation'}><Icon.Chat width={13} height={13} /></button></span>
            {it.kind === 'video' && <span className="badge pill" aria-hidden="true"><Icon.Play width={11} height={11} />{it.job?.request.output.duration_seconds ?? 5} s</span>}
          </div><figcaption><span>{it.title}</span>{it.job?.request && <small>{it.kind === 'video' ? 'Video' : 'Image'}{it.job.request.workflow === 'image-to-image' ? ' · edit' : it.job.request.workflow === 'reference-to-video' ? ' · animated' : ''} · seed {it.job.seed}</small>}</figcaption></figure>; })}
        </div>
      </section>)}
      {planned.length > 0 && filter === 'all' && <section><div className="day">Planned, not made yet</div><div className="chips">{planned.map(t => <button key={t} className="chip" onClick={() => app.go({ name: 'project', id: project.id, view: 'conversation' })}>{t}</button>)}</div></section>}
      {list.cursor && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn" disabled={list.loading} onClick={() => void list.more()}>{list.loading ? 'Loading…' : 'Load more'}</button></div>}
    </div></div>
  </>;
}
