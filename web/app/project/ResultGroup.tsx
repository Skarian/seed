import React, { useState } from 'react';
import type { ChatCard, ChatGroup, JobRecord, Project } from '../api.js';
import { jobs as jobsApi, kindOf, isVideoKind } from '../api.js';
import { Icon } from '../icons.js';
import { Media, MenuButton } from '../ui.js';
import { latest, titleOf, tileState, shapeClass, isFailed, cardJobs, outputNoun, settingChips } from '../format.js';
import { useApp, type ViewerItem } from '../data.js';
import { styleName, type StyleEntry } from './readiness.js';

type Actions = {
  onVariations: (card: ChatCard) => void; onRetryFailed: (card: ChatCard) => void; onBringBack: (card: ChatCard) => void;
  onMakeAgain: (card: ChatCard) => void; onReuse: (card: ChatCard) => void;
};

/** What a plan becomes after Make: each made draft with its results, plus drafts that were set aside. */
export function ResultGroup({ project, group, styles, collapsed, onExpand, actions, flash }: { project: Project; group: ChatGroup; styles: StyleEntry[]; collapsed: boolean; onExpand: () => void; actions: Actions; flash?: string }) {
  const made = group.cards.filter(c => latest(c).decision === 'approved');
  const notNow = group.cards.filter(c => latest(c).decision !== 'approved');
  if (group.state === 'stopped' && group.direct) return <section className="notice error" id={'group-' + group.id}>
    <b>Couldn't start “{titleOf(latest(group.cards[0]!).request)}”.</b> {group.submission_error ?? 'Nothing ran and nothing was charged.'}
    <div className="actions"><button className="btn small" onClick={() => actions.onMakeAgain(group.cards[0]!)}>Try again</button></div>
  </section>;
  if (!made.length || group.state === 'stopped') return <section className="card" id={'group-' + group.id}>
    <div className="notnow"><span>{group.state === 'stopped' ? 'Stopped' : 'Set aside'}:</span>{group.cards.map(c => <span key={c.id}><b>{titleOf(latest(c).request)}</b> <button className="link" onClick={() => actions.onBringBack(c)}>Bring back</button></span>)}</div>
  </section>;
  return <>{made.map((card, i) => <CardResults key={card.id} project={project} group={group} card={card} styles={styles} collapsed={collapsed} onExpand={onExpand} actions={actions} flash={flash === card.id || flash === group.id} notNow={i === made.length - 1 ? notNow : []} />)}</>;
}

function CardResults({ project, group, card, styles, collapsed, onExpand, actions, flash, notNow }: { project: Project; group: ChatGroup; card: ChatCard; styles: StyleEntry[]; collapsed: boolean; onExpand: () => void; actions: Actions; flash: boolean; notNow: ChatCard[] }) {
  const app = useApp();
  const r = latest(card).request, list = cardJobs(project, card), title = titleOf(r);
  const done = list.filter(j => j.state === 'completed'), failed = list.filter(isFailed), running = list.filter(j => !['completed', 'failed', 'cancelled'].includes(j.state) && !isFailed(j));
  const [how, setHow] = useState(false);
  const items: ViewerItem[] = done.flatMap((j, n) => j.outputs.map(asset => ({ asset, kind: isVideoKind(kindOf[r.workflow]) ? 'video' as const : 'image' as const, title: `${title}${list.length > 1 ? `, ${n + 1} of ${list.length}` : ''}`, job: j, project: project.id })));
  const status = running.length ? `${done.length} of ${list.length} done · making` : failed.length ? `${done.length} of ${list.length} done · ${failed.length} failed` : list.some(j => j.state === 'cancelled') && !done.length ? 'Cancelled' : `${outputNoun(r, done.length)} · done`;
  const head = <div className="card-head">
    <span className="title">{title}</span><span className="meta">{status}{group.direct ? ' · made directly' : ''}</span>
    <span className="end">
      {collapsed ? <button className="btn quiet small" onClick={onExpand}>Show</button> : <button className="btn quiet small" aria-expanded={how} onClick={() => setHow(h => !h)}>How it was made</button>}
      <MenuButton label={'Options for ' + title} items={[
        { label: 'More like this', hint: 'Same settings, new seeds. Starts now.', onSelect: () => actions.onVariations(card) },
        { label: 'Reuse settings', hint: 'Load this prompt and settings into Make, to change one thing.', onSelect: () => actions.onReuse(card) },
        ...(failed.length ? [{ label: `Retry ${failed.length} failed`, hint: 'Only the failed outputs, same settings.', onSelect: () => actions.onRetryFailed(card) }] : []),
        ...(running.length ? [{ label: 'Cancel what is still making', danger: true, onSelect: () => { for (const j of running) void jobsApi.cancel(j.id).then(() => app.refreshTasks()); } }] : []),
      ]}><Icon.More /></MenuButton>
    </span>
  </div>;
  if (collapsed) return <section className="card" id={'card-' + card.id}>{head}<div className="strip">{items.map(it => <button key={it.asset} className={'tile ' + shapeClass(r)} onClick={() => app.inspect(it, items)} aria-label={'Open ' + it.title}><Media id={it.asset} kind={it.kind} alt={it.title} /></button>)}</div></section>;
  return <section className={'card' + (flash ? ' flash' : '')} id={'card-' + card.id} data-group={group.id} aria-label={title}>
    {head}
    {how && <HowItWasMade project={project} card={card} styles={styles} />}
    <div className={'results' + (list.length === 1 ? ' one' : '') + (r.output.aspect === '9:16' && list.length > 2 ? ' tall' : '')} style={r.output.aspect === '9:16' && list.length > 2 ? { ['--cols' as string]: String(Math.min(list.length, 4)) } : undefined}>
      {list.map((job, n) => <ResultTile key={job.id} job={job} project={project} title={`${title}${list.length > 1 ? `, ${n + 1} of ${list.length}` : ''}`} siblings={items} card={card} actions={actions} />)}
    </div>
    {notNow.length > 0 && <div className="notnow"><span>Not now:</span>{notNow.map(c => <span key={c.id}><b>{titleOf(latest(c).request)}</b> <button className="link" onClick={() => actions.onBringBack(c)}>Bring back</button></span>)}</div>}
  </section>;
}

/** What a waiting output is waiting for: a GPU starting up, with its download progress and time left when known. */
function gpuWait(pool: ReturnType<typeof useApp>['pool'], role: 'image' | 'video') {
  const w = pool?.workers.find(x => x.worker_class === role && ['starting', 'preparing'].includes(x.state));
  if (!w) return null;
  const p = w.preparation, pct = p && p.bytes_total ? Math.round(p.bytes_done / p.bytes_total * 100) : null;
  const eta = p?.eta_seconds ? ' · about ' + Math.max(1, Math.round(p.eta_seconds / 60)) + ' min' : '';
  return w.state === 'starting' ? 'Waiting for GPU · starting' : pct !== null ? `Waiting for GPU · models ${pct}%${eta}` : 'Waiting for GPU · loading models';
}

export function HowItWasMade({ project, card, styles }: { project: Project; card: ChatCard; styles: StyleEntry[] }) {
  const r = latest(card).request, names = new Map((project.asset_manifest ?? []).map(a => [a.id, a.name]));
  return <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }} className="kv">
    <span>Prompt</span><div className="prompt">{r.prompt}</div>
    <span>Settings</span><div>{settingChips(r, id => styleName(styles, id)).map(([, v]) => v).join(' · ')}</div>
    {(r.references ?? []).length > 0 && <><span>Inputs</span><div>{r.references!.map(x => (names.get(x.asset_id) ?? 'Input') + ' as ' + x.role.replace('_', ' ')).join(', ')}</div></>}
    {r.resolved_seeds && <><span>Seeds</span><div>{r.resolved_seeds.join(', ')}</div></>}
  </div>;
}

function ResultTile({ job, project, title, siblings, card, actions }: { job: JobRecord; project: Project; title: string; siblings: ViewerItem[]; card: ChatCard; actions: Actions }) {
  const app = useApp();
  const r = job.request, video = isVideoKind(kindOf[r.workflow]);
  const base = tileState(job), shape = shapeClass(r, job.output_dimensions?.width, job.output_dimensions?.height);
  const state = base.label === 'Waiting for GPU' || base.label === 'Queued' ? { ...base, label: gpuWait(app.pool, video ? 'video' : 'image') ?? base.label } : base;
  const asset = job.outputs[0];
  if (job.state !== 'completed' || !asset) return <div className={`tile ${shape} ${state.tone === 'bad' ? 'failed' : ''} ${state.tone === 'live' || state.tone === 'wait' ? 'shimmer' : ''}`} role="group" aria-label={title + ': ' + state.label}>
    <span className="state pill"><span className={'dot ' + (state.tone === 'live' ? 'live' : state.tone === 'bad' ? 'red' : state.tone === 'wait' ? 'amber' : 'off')} />{state.tone === 'bad' ? state.label.split(' · ')[0] : state.label}</span>
    <div className="placeholder">{state.tone === 'bad' ? <span>{state.label.replace(/^Failed · /, '')}<br /><button className="btn small" style={{ marginTop: 8 }} onClick={() => job.state === 'needs_attention' ? void jobsApi.recover(job.id) : actions.onRetryFailed(card)}>{job.state === 'needs_attention' ? 'Check again' : 'Retry'}</button></span> : state.tone === 'off' ? <span>Cancelled<br /><button className="btn small" style={{ marginTop: 8 }} onClick={() => actions.onMakeAgain(card)}>Make again</button></span> : null}</div>
    {state.cancellable && <span className="corner"><button className="pill" onClick={() => void jobsApi.cancel(job.id).then(() => { app.refreshTasks(); app.toast('Cancelled · the GPU keeps running for other work'); })} aria-label={'Cancel ' + title}>Cancel</button></span>}
    {state.percent !== undefined && <div className="prog"><i style={{ width: state.percent + '%' }} /></div>}
  </div>;
  const item: ViewerItem = { asset, kind: video ? 'video' : 'image', title, job, project: project.id };
  return <div className={`tile ${shape}`}>
    <Media id={asset} kind={item.kind} alt={title} />
    <button className="open" aria-label={'Open ' + title} onClick={() => app.inspect(item, siblings)} onDoubleClick={() => app.view(item, siblings)} />
    {video && <span className="state pill" aria-hidden="true"><Icon.Play width={12} height={12} />{r.output.duration_seconds ?? 5} s</span>}
    <div className="bar">
      <button className="pill" onClick={() => app.useResult(item, 'refine')}><Icon.Pencil width={14} height={14} />Refine</button>
      <button className="pill" onClick={() => actions.onVariations(card)}>More like this</button>
      {!video && <button className="pill" onClick={() => app.useResult(item, 'animate')}><Icon.Film width={14} height={14} />Animate</button>}
      <MenuButton label={'More for ' + title} className="pill" placement="above" items={[
        { label: 'Use as input', onSelect: () => app.useResult(item, 'input') },
        { label: 'Reuse settings', onSelect: () => actions.onReuse(card) },
        { label: 'Open full screen', onSelect: () => app.view(item, siblings) },
        { label: 'Download', onSelect: () => { const a = document.createElement('a'); a.href = '/api/v1/assets/' + asset + '/content'; a.download = ''; a.click(); } },
      ]}><Icon.More width={14} height={14} /></MenuButton>
    </div>
  </div>;
}
