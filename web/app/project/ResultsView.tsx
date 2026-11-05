import React, { useMemo, useState } from 'react';
import type { Project } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { useApp, useAssets, useStoredState, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media } from '../ui.js';
import { titleOf, latest, tileState, shapeClass } from '../format.js';
import { jobActive } from '../../../shared/jobs.js';

/**
 * The project board: every result in one packed grid (or grouped by request), work in progress
 * first, chosen results marked, and planned drafts listed. Beside the conversation on wide
 * screens, and the Results tab elsewhere. Selecting two compares them.
 */
export function ResultsView({ project, embedded = false }: { project: Project; embedded?: boolean }) {
  const app = useApp();
  const [filter, setFilter] = useState<'all' | 'fav' | 'image' | 'video'>('all');
  const [size, setSize] = useStoredState<'s' | 'm' | 'l'>(embedded ? 'seed.board.size' : 'seed.results.size', 'm');
  const [grouped, setGrouped] = useStoredState('seed.results.grouped', false);
  // A film or set made of numbered shots is shown shot by shot, in story order; anything else as one grid.
  const [viewPref, setView] = useStoredState<'auto' | 'shots' | 'grid'>('seed.results.view', 'auto');
  const [selected, setSelected] = useState<string[]>([]);
  const list = useAssets({ mode: app.mode, chat_id: project.id, source: 'made', ...(filter === 'fav' ? { favorites: true } : {}), ...(filter === 'image' || filter === 'video' ? { kind: filter } : {}) });
  const jobsById = useMemo(() => new Map(project.jobs.map(j => [j.id, j])), [project.jobs]);
  const items: ViewerItem[] = list.items.map(a => {
    const job = a.job_id ? jobsById.get(a.job_id) : undefined, base = a.title ?? (job ? titleOf(job.request) : a.name);
    return { asset: a.id, kind: a.kind, title: job && job.request.count > 1 ? `${base} · ${job.submission_index + 1} of ${job.request.count}` : base, job, project: project.id };
  });
  const fav = new Set(list.items.filter(a => a.favorite).map(a => a.id));
  const running = filter === 'all' || filter === 'image' || filter === 'video' ? project.jobs.filter(j => jobActive(j) && (filter === 'all' || (filter === 'video') === isVideoKind(kindOf[j.request.workflow]))) : [];
  const planned = project.groups.filter(g => ['reviewing', 'revising', 'assembling'].includes(g.state) && !g.direct).flatMap(g => g.cards.map(c => titleOf(latest(c).request)));
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s.slice(-1), id]);
  const min = { s: embedded ? 110 : 120, m: 170, l: 260 }[size];
  const grid = { gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` };
  const tile = (it: ViewerItem) => { const on = selected.includes(it.asset); return <figure key={it.asset} className="cell"><div className={'tile' + (on ? ' selected' : '')}>
    <Media id={it.asset} kind={it.kind} alt={it.title} />
    <button className="open" aria-label={'Open ' + it.title} onClick={() => app.inspect(it, items)} />
    <button className="sel check big" role="checkbox" aria-checked={on} aria-label={'Select ' + it.title + ' to compare'} onClick={() => toggle(it.asset)}>{on && <Icon.Check />}</button>
    <span className="corner">{fav.has(it.asset) && <span className="pill" aria-label="Chosen"><Icon.HeartFill width={12} height={12} style={{ color: 'var(--accent)' }} /></span>}</span>
    {it.kind === 'video' && <span className="badge pill" aria-hidden="true"><Icon.Play width={11} height={11} />{it.job?.request.output.duration_seconds ?? 5} s</span>}
  </div><figcaption><span>{it.title}</span>{it.job?.request && <small>{it.kind === 'video' ? 'Video' : 'Image'}{it.job.request.workflow === 'image-to-image' ? ' · edit' : it.job.request.workflow === 'reference-to-video' ? ' · animated' : ''}</small>}</figcaption></figure>; };
  const shotOf = (title: string) => { const m = title.match(/\bshot\s*(\d{1,3})\b/i); return m ? Number(m[1]) : null; };
  const allTitles = [...items.map(it => it.job ? titleOf(it.job.request) : it.title), ...planned, ...running.map(j => titleOf(j.request))];
  const hasShots = allTitles.some(t => shotOf(t) !== null);
  const view = viewPref === 'auto' ? (hasShots ? 'shots' : 'grid') : viewPref;
  type Shot = { n: number | null; name: string; images: ViewerItem[]; clips: ViewerItem[]; making: typeof running; planned: string[] };
  const shots = new Map<string, Shot>();
  const shotFor = (title: string) => {
    const n = shotOf(title), key = n !== null ? 'n' + n : 't' + title;
    if (!shots.has(key)) shots.set(key, { n, name: n !== null ? title.replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '').replace(/\s*(keyframe|animation|clip|video)\s*$/i, '').trim() : title, images: [], clips: [], making: [], planned: [] });
    const s = shots.get(key)!; if (!s.name && n !== null) s.name = title.replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '').trim(); return s;
  };
  // Oldest first inside a shot, so the newest take is last, like a strip of film.
  for (const it of [...items].reverse()) { const s = shotFor(it.job ? titleOf(it.job.request) : it.title); (it.kind === 'video' ? s.clips : s.images).push(it); }
  for (const j of running) shotFor(titleOf(j.request)).making.push(j);
  for (const t of planned) shotFor(t).planned.push(t);
  const shotList = [...shots.values()].sort((a, b) => (a.n ?? 1e6) - (b.n ?? 1e6));
  const lane = (its: ViewerItem[]) => its.map(it => { const on = selected.includes(it.asset); return <figure key={it.asset} className="cell lane-cell"><div className={'tile ' + (it.job ? shapeClass(it.job.request, it.job.output_dimensions?.width, it.job.output_dimensions?.height) : 'square') + (on ? ' selected' : '')}>
    <Media id={it.asset} kind={it.kind} alt={it.title} />
    <button className="open" aria-label={'Open ' + it.title} onClick={() => app.inspect(it, items)} />
    <button className="sel check big" role="checkbox" aria-checked={on} aria-label={'Select ' + it.title + ' to compare'} onClick={() => toggle(it.asset)}>{on && <Icon.Check />}</button>
    <span className="corner">{fav.has(it.asset) && <span className="pill" aria-label="Chosen"><Icon.HeartFill width={12} height={12} style={{ color: 'var(--accent)' }} /></span>}</span>
    {it.kind === 'video' && <span className="badge pill" aria-hidden="true"><Icon.Play width={11} height={11} />{it.job?.request.output.duration_seconds ?? 5} s</span>}
  </div></figure>; });
  const groups = new Map<string, ViewerItem[]>();
  if (grouped) for (const it of items) { const key = it.job ? titleOf(it.job.request) : it.title; groups.set(key, [...(groups.get(key) ?? []), it]); }
  return <div className={embedded ? 'board' : 'board full'}>
    <div className="toolbar">
      {embedded && <b style={{ marginRight: 4 }}>Board</b>}
      <div className="seg" role="group" aria-label="Show">{([['all', 'All'], ['fav', 'Chosen'], ['image', 'Images'], ['video', 'Videos']] as const).map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'fav' ? <Icon.Heart width={14} height={14} /> : null}{l}</button>)}</div>
      <span style={{ flex: 1 }} />
      <div className="seg" role="group" aria-label="Arrange"><button aria-pressed={view === 'shots'} onClick={() => setView('shots')}>By shot</button><button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button></div>
      {view === 'grid' && <button className="btn small quiet" aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>{grouped ? 'Grouped by request' : 'All together'}</button>}
      <div className="seg no-phone" role="group" aria-label="Tile size">{(['s', 'm', 'l'] as const).map(k => <button key={k} aria-pressed={size === k} aria-label={{ s: 'Small tiles', m: 'Medium tiles', l: 'Large tiles' }[k]} onClick={() => setSize(k)}>{k.toUpperCase()}</button>)}</div>
      <button className={'btn primary small' + (selected.length ? '' : ' no-phone')} disabled={selected.length !== 2} onClick={() => { const [a, b] = selected.map(id => items.find(i => i.asset === id)!); if (a && b) app.compare(a, b); }}><Icon.Compare />{selected.length === 2 ? 'Compare' : selected.length ? 'Select one more' : 'Select two to compare'}</button>
    </div>
    <div className="scroll"><div className={embedded ? 'boardpad' : 'col'} style={embedded ? undefined : { maxWidth: 1400, paddingBottom: 24 }}>
      {view === 'shots' && (items.length > 0 || running.length > 0 || planned.length > 0) && <div className="shots">{shotList.map(s => {
        const chosenImage = s.images.some(i => fav.has(i.asset)), chosenClip = s.clips.some(i => fav.has(i.asset));
        const stage = s.making.length ? 'Making now' : s.clips.length ? (chosenClip ? 'Clip chosen' : `${s.clips.length} ${s.clips.length === 1 ? 'clip' : 'clips'}`) : s.images.length ? (chosenImage ? 'Keyframe chosen · no clip yet' : 'Keyframe made · no clip yet') : s.planned.length ? 'In the plan, not made yet' : '';
        return <section key={(s.n ?? '') + s.name} className="shot-row" aria-label={(s.n !== null ? 'Shot ' + s.n + ': ' : '') + s.name}>
          <div className="shot-head">{s.n !== null && <b className="shot-n">Shot {s.n}</b>}<span className="shot-name">{s.name}</span><span className="faint">{stage}</span></div>
          <div className="shot-lanes">
            {(s.images.length > 0 || !s.clips.length) && <div className="lane"><span className="lane-label">Keyframes</span><div className="lane-strip">{lane(s.images)}{!s.images.length && <span className="faint lane-empty">{s.planned.length ? 'Planned' : 'None yet'}</span>}</div></div>}
            {(s.clips.length > 0 || s.images.length > 0) && <div className="lane"><span className="lane-label">Clips</span><div className="lane-strip">{lane(s.clips)}{!s.clips.length && <span className="faint lane-empty">None yet. Animate a keyframe to make one.</span>}</div></div>}
            {s.making.length > 0 && <div className="lane"><span className="lane-label">Making</span><div className="lane-strip">{s.making.map(j => { const st = tileState(j); return <span key={j.id} className="chip"><span className={'dot ' + (st.tone === 'wait' ? 'amber' : 'live')} /> {st.label}</span>; })}</div></div>}
          </div>
        </section>; })}</div>}
      {view === 'grid' && running.length > 0 && <section><div className="day">Making now</div><div className="grid" style={grid}>
        {running.map(j => { const s = tileState(j); return <figure key={j.id} className="cell"><div className={`tile pending shimmer ${shapeClass(j.request)}`} style={{ aspectRatio: '1' }}><span className="state pill"><span className={'dot ' + (s.tone === 'wait' ? 'amber' : 'live')} />{s.label.split(' · ')[0]}</span>{s.percent !== undefined && <div className="prog"><i style={{ width: s.percent + '%' }} /></div>}</div><figcaption><span>{titleOf(j.request)}</span><small>{s.label}</small></figcaption></figure>; })}
      </div></section>}
      {view === 'grid' && planned.length > 0 && filter === 'all' && <section><div className="day">In the plan, not made yet</div><div className="chips">{planned.map(t => <span key={t} className="chip">{t}</span>)}</div></section>}
      {list.loaded && !items.length && !running.length && !planned.length && <div className="empty" style={{ minHeight: 240 }}><div><h2 className="serif" style={{ fontSize: 22 }}>{filter === 'fav' ? 'Nothing chosen yet' : 'Nothing made yet'}</h2><p>{filter === 'fav' ? 'Tap ♥ on a result to mark it as the one you want.' : 'Everything made in this project gathers here.'}</p>{filter !== 'all' && <button className="btn" onClick={() => setFilter('all')}>Show all</button>}</div></div>}
      {view === 'grid' && items.length > 0 && (grouped
        ? [...groups.entries()].map(([title, its]) => <section key={title}><div className="day">{title} <span className="faint" style={{ fontWeight: 400 }}>· {its.length}{its.some(i => fav.has(i.asset)) ? ' · chosen ♥' : ''}</span></div><div className="grid" style={grid}>{its.map(tile)}</div></section>)
        : <section>{(running.length > 0 || planned.length > 0) && <div className="day">Made</div>}<div className="grid" style={grid}>{items.map(tile)}</div></section>)}
      {list.cursor && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn" disabled={list.loading} onClick={() => void list.more()}>{list.loading ? 'Loading…' : 'Load more'}</button></div>}
    </div></div>
  </div>;
}
