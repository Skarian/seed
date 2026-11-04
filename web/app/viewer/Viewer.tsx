import React, { useEffect, useRef, useState } from 'react';
import { assets as assetsApi, collections as collectionsApi, jobs as jobsApi, projects as projectsApi, media, kindOf, isVideoKind, type AssetDetail, type JobRecord, type AssetCollection } from '../api.js';
import { useApp, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media, MenuButton, Thumb, Confirm, Dialog, downloadAsset } from '../ui.js';
import { titleOf, settingChips, duration, targetLabel, promptChanges } from '../format.js';
import { roleLabels } from '../project/requests.js';
import { StatusControl } from '../App.js';
import { useStyles } from '../project/styles.js';

/** Everything known about one result: its job, organization and family. */
function useDetail(item: ViewerItem) {
  const [detail, setDetail] = useState<AssetDetail | null>(null), [job, setJob] = useState<JobRecord | undefined>(item.job);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void assetsApi.get(item.asset).then(d => { if (!live) return; setDetail(d); if (!item.job && d.job_id) void jobsApi.get(d.job_id).then(j => live && setJob(j)).catch(() => {}); }).catch(() => {});
    return () => { live = false; };
  }, [item.asset, tick]);
  useEffect(() => setJob(item.job), [item.job?.id]);
  return { detail, job, refresh: () => setTick(t => t + 1) };
}

function useFamily(item: ViewerItem, job?: JobRecord) {
  const { tasks } = useApp();
  const parents = (job?.request.references ?? []).map(r => { const made = tasks.find(j => j.outputs.includes(r.asset_id)); return { asset: r.asset_id, kind: r.kind, role: r.role, title: made ? titleOf(made.request) : 'Uploaded ' + r.kind, job: made }; });
  const children = tasks.filter(j => j.state === 'completed' && j.request.references?.some(r => r.asset_id === item.asset)).flatMap(j => j.outputs.map(o => ({ asset: o, job: j })));
  return { parents, children };
}

export function AssetPanel({ item, compact = false, onClosed }: { item: ViewerItem; compact?: boolean; onClosed?: () => void }) {
  const app = useApp();
  const { detail, job, refresh } = useDetail(item);
  const { parents, children } = useFamily(item, job);
  const styles = useStyles(app.mode);
  const [cols, setCols] = useState<AssetCollection[] | null>(null), [colDialog, setColDialog] = useState(false), [del, setDel] = useState(false), [note, setNote] = useState<{ note: string; revision: number } | null>(null);
  useEffect(() => { void assetsApi.note(item.asset).then(setNote).catch(() => setNote({ note: '', revision: 0 })); }, [item.asset]);
  const r = job?.request, video = item.kind === 'video';
  const fav = Boolean(detail?.favorite);
  const source = job?.source;
  async function variations() {
    if (!source?.chat_id || !source.card_id || !source.revision) return;
    try { await projectsApi.repeat(source.chat_id, source.card_id, source.revision, { fresh: true }); onClosed?.(); app.go({ name: 'project', id: source.chat_id, view: 'conversation' }); }
    catch (e) { app.toast((e as Error).message); }
  }
  const more = [
    { label: 'Use as input', hint: 'Attach it to the composer.', onSelect: () => app.useResult({ ...item, job }, 'input') },
    ...(source?.card_id ? [{ label: 'Reuse settings', hint: 'Load its prompt and settings into Make.', onSelect: () => { onClosed?.(); app.useResult({ ...item, job }, 'reuse'); } }] : []),
    { label: fav ? 'Remove from favorites' : 'Add to favorites', onSelect: () => void assetsApi.favorite(item.asset, !fav).then(refresh) },
    { label: 'Add to collection…', onSelect: () => { setColDialog(true); void collectionsApi.list(app.mode).then(setCols); } },
    { label: 'Download', onSelect: () => void downloadAsset(item.asset, job ? titleOf(job.request) + (job.request.count > 1 ? ' ' + (job.submission_index + 1) : '') : item.title) },
    ...(source?.chat_id ? [{ label: 'Show in conversation', onSelect: () => { onClosed?.(); app.go({ name: 'project', id: source.chat_id!, view: 'conversation', focus: source.card_id }); } }] : []),
    'divider' as const,
    { label: 'Delete…', danger: true, onSelect: () => setDel(true) },
  ];
  return <>
    <div className="acts">
      <button className="btn primary" onClick={() => app.useResult({ ...item, job }, 'refine')}><Icon.Pencil />Refine</button>
      {source?.card_id && <button className="btn" onClick={() => { onClosed?.(); app.useResult({ ...item, job }, 'more'); }}>More like this</button>}
      {!video && <button className="btn" onClick={() => app.useResult({ ...item, job }, 'animate')}><Icon.Film />Animate</button>}
      <button className="btn" aria-pressed={fav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={() => void assetsApi.favorite(item.asset, !fav).then(refresh)}>{fav ? <Icon.HeartFill style={{ color: 'var(--accent)' }} /> : <Icon.Heart />}</button>
      <MenuButton label="More actions" className="btn" items={more}><Icon.More /></MenuButton>
    </div>
    <div className="kv">
      <span>Made from</span><div>{parents.length ? <span className="lineage">{parents.map(p => <button key={p.asset} onClick={() => app.inspect({ asset: p.asset, kind: p.kind, title: p.title, job: p.job, project: p.job?.source?.chat_id })}><Thumb id={p.asset} kind={p.kind} alt="" /><span><b style={{ fontWeight: 500 }}>{p.title}</b> · {roleLabels[p.role] ?? p.role}</span></button>)}</span> : <span className="faint">{job ? 'Words only' : detail && !detail.job_id ? 'Uploaded' : '—'}</span>}</div>
      {children.length > 0 && <><span>Made from this</span><div className="lineage">{children.slice(0, 8).map(c => <button key={c.asset} onClick={() => app.inspect({ asset: c.asset, kind: isVideoKind(kindOf[c.job.request.workflow]) ? 'video' : 'image', title: titleOf(c.job.request), job: c.job, project: c.job.source?.chat_id })}><Thumb id={c.asset} kind={isVideoKind(kindOf[c.job.request.workflow]) ? 'video' : 'image'} alt="" />{titleOf(c.job.request)}</button>)}</div></>}
      {r && <><span>Settings</span><div>{settingChips(r, id => id).filter(([k]) => !k.startsWith('style') && k !== 'target').map(([, v]) => v).join(' · ')}{detail?.width ? ` · saved at ${detail.width}×${detail.height}` : ''}</div></>}
      {r?.loras?.length ? <><span>Style</span><div>{r.loras.map(l => `${styles.find(s => s.id === l.id)?.name ?? 'Style'} · strength ${l.scale}`).join(', ')}</div></> : null}
      {job && <><span>Seed</span><div>{job.seed}</div></>}
      {job && <><span>Ran on</span><div>{job.worker?.executor === 'local' ? 'Seed PC' : job.worker?.executor === 'cloud' ? 'Cloud GPU' : targetLabel(r?.target)}{job.metrics?.elapsed_to_saved_seconds ? ' · ' + duration(job.metrics.elapsed_to_saved_seconds) : ''}</div></>}
      {source?.chat_id && <><span>Project</span><div><button className="link" onClick={() => { onClosed?.(); app.go({ name: 'project', id: source.chat_id!, view: 'conversation', focus: source.card_id }); }}>{app.projectList.find(p => p.id === source.chat_id)?.title ?? 'Open project'} · show in conversation</button></div></>}
      {r && <><span>Prompt</span><div><details open={!app.narrow && r.prompt.length < 600}><summary className="link" style={{ cursor: 'pointer' }}>{r.prompt.length < 600 && !app.narrow ? 'Prompt' : `Show prompt (${r.prompt.split(/\s+/).length} words)`}</summary><div className="prompt">{r.prompt}</div></details></div></>}
      {<><span>Note</span><div><NoteField asset={item.asset} note={note} onSaved={setNote} /></div></>}
    </div>
    {colDialog && <Dialog title="Add to collection" onClose={() => setColDialog(false)} footer={<button className="btn primary" onClick={() => setColDialog(false)}>Done</button>}>
      {!cols ? <p className="muted">Loading…</p> : <CollectionChoices asset={item.asset} cols={cols} detail={detail} onChanged={refresh} />}
    </Dialog>}
    {del && <Confirm title="Delete this result?" danger action="Delete permanently" onClose={() => setDel(false)} body={<p style={{ margin: 0 }}>“{item.title}” is removed from the Library and from its project. This can't be undone.</p>}
      onConfirm={() => void assetsApi.remove(item.asset).then(() => { setDel(false); app.toast('Deleted'); onClosed?.(); }).catch(e => { setDel(false); app.toast((e as Error).message); })} />}
  </>;
}

function NoteField({ asset, note, onSaved }: { asset: string; note: { note: string; revision: number } | null; onSaved: (n: { note: string; revision: number }) => void }) {
  const [value, setValue] = useState(note?.note ?? ''), [saved, setSaved] = useState('');
  useEffect(() => setValue(note?.note ?? ''), [note?.revision, asset]);
  if (!note) return <span className="faint">…</span>;
  return <textarea className="textarea" style={{ minHeight: 56 }} value={value} placeholder="Add a note (searchable in the Library)" aria-label="Note"
    onChange={e => { setValue(e.target.value); setSaved(''); }}
    onBlur={() => { if (value !== note.note) void assetsApi.saveNote(asset, value, note.revision).then(n => { onSaved(n); setSaved('Saved'); }).catch(e => setSaved((e as Error).message)); }} />;
}

function CollectionChoices({ asset, cols, detail, onChanged }: { asset: string; cols: AssetCollection[]; detail: AssetDetail | null; onChanged: () => void }) {
  const app = useApp();
  const [list, setList] = useState(cols), [name, setName] = useState(''), [inside, setInside] = useState<string[]>(detail?.collection_ids ?? []);
  return <>
    {list.map(c => { const on = inside.includes(c.id); return <button key={c.id} className="option" role="checkbox" aria-checked={on} onClick={() => void assetsApi.inCollection(asset, c.id, !on).then(() => { setInside(s => on ? s.filter(x => x !== c.id) : [...s, c.id]); onChanged(); })}><span className="check" aria-checked={on}>{on && <Icon.Check />}</span><span>{c.name}<small>{c.count} items</small></span></button>; })}
    <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); if (!name.trim()) return; void collectionsApi.create(app.mode, name.trim()).then(c => assetsApi.inCollection(asset, c.id, true).then(() => { setList(l => [...l, { ...c, count: 1 }]); setInside(s => [...s, c.id]); setName(''); onChanged(); })); }}>
      <input className="input" placeholder="New collection" aria-label="New collection name" value={name} onChange={e => setName(e.target.value)} /><button className="btn" disabled={!name.trim()}>Create</button>
    </form>
  </>;
}

/** Side panel for a selected result (desktop). */
export function Inspector({ item, siblings, onClose, onPick }: { item: ViewerItem; siblings: ViewerItem[]; onClose: () => void; onPick: (i: ViewerItem) => void }) {
  const app = useApp();
  const i = siblings.findIndex(s => s.asset === item.asset);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('input,textarea,select')) return; if (e.key === 'Escape') onClose(); if (e.key === 'Enter') app.view(item, siblings); };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [item.asset]);
  return <aside className="inspector" aria-label={'Details: ' + item.title}>
    <div className="vtop"><button className="btn small close" onClick={onClose} aria-label="Close details"><Icon.Close />Close</button><b>{item.title}</b>
      {siblings.length > 1 && <span className="history"><button aria-label="Previous result" disabled={i <= 0} onClick={() => onPick(siblings[i - 1]!)}><Icon.Back /></button>{i + 1}/{siblings.length}<button aria-label="Next result" disabled={i >= siblings.length - 1} onClick={() => onPick(siblings[i + 1]!)}><Icon.Next /></button></span>}</div>
    <div className="body">
      <button className="hero" onClick={() => app.view(item, siblings)} aria-label={'Open ' + item.title + ' full screen'} style={{ display: 'block' }}><Media id={item.asset} kind={item.kind} alt={item.title} large /></button>
      <AssetPanel item={item} onClosed={onClose} />
    </div>
  </aside>;
}

/** Full-screen viewer with zoom, sibling navigation, before/after for edits, and frame picking for video. */
export function Viewer({ item, siblings, onClose, onPick }: { item: ViewerItem; siblings: ViewerItem[]; onClose: () => void; onPick: (i: ViewerItem) => void }) {
  const app = useApp();
  const i = siblings.findIndex(s => s.asset === item.asset);
  const { job, detail, refresh } = useDetail(item);
  const fav = Boolean(detail?.favorite);
  const source = job?.request.workflow === 'image-to-image' ? job.request.references?.find(r => r.role === 'source')?.asset_id : undefined;
  const [before, setBefore] = useState(false), [zoom, setZoom] = useState(1), [info, setInfo] = useState(!app.narrow);
  const videoRef = useRef<HTMLVideoElement>(null), touch = useRef<number | null>(null);
  const step = (d: number) => { const next = siblings[i + d]; if (next) { onPick(next); setZoom(1); setBefore(false); } };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('input,textarea,select')) return; if (e.key === 'Escape') onClose(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [i]);
  async function pickFrame() {
    const t = videoRef.current?.currentTime ?? 0;
    try { const frame = await assetsApi.pickFrame(item.asset, t); app.toast('Frame saved to Library', { label: 'Animate it', run: () => app.useResult({ asset: frame.id, kind: 'image', title: item.title + ' · frame', project: item.project }, 'animate') }); }
    catch (e) { app.toast((e as Error).message); }
  }
  const shown = before && source ? source : item.asset;
  return <div className="viewer" role="dialog" aria-modal="true" aria-label={item.title}>
    <div className="vtop">
      <button className="btn small close" onClick={onClose} autoFocus><Icon.Close />Close</button>
      <b>{item.title}{siblings.length > 1 ? ` · ${i + 1} of ${siblings.length}` : ''}</b>
      {source && <div className="seg" role="group" aria-label="Before or after"><button aria-pressed={before} onClick={() => setBefore(true)}>Before</button><button aria-pressed={!before} onClick={() => setBefore(false)}>After</button></div>}
      {item.kind === 'image' && <button className="btn small no-phone" onClick={() => setZoom(z => z === 1 ? 2 : 1)}>{zoom === 1 ? 'Zoom' : 'Fit'}</button>}
      <button className="btn small" aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav} onClick={() => void assetsApi.favorite(item.asset, !fav).then(refresh)}>{fav ? <Icon.HeartFill style={{ color: 'var(--accent)' }} /> : <Icon.Heart />}</button>
      <button className="btn small" aria-pressed={info} onClick={() => setInfo(v => !v)}>Details</button>
      <span className="no-phone"><StatusControl /></span>
    </div>
    <div className="stage" onTouchStart={e => { touch.current = e.touches[0]!.clientX; }} onTouchEnd={e => { if (touch.current === null || zoom > 1) return; const dx = e.changedTouches[0]!.clientX - touch.current; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); touch.current = null; }}>
      {item.kind === 'video' && !before ? <video ref={videoRef} src={media.content(shown)} controls playsInline autoPlay aria-label={item.title} />
        : <img src={item.kind === 'image' || before ? media.preview(shown, true) : media.content(shown)} alt={before ? 'Before: the source image' : item.title} style={{ transform: `scale(${zoom})`, transition: 'transform .15s', cursor: zoom > 1 ? 'zoom-out' : 'zoom-in' }} onClick={() => setZoom(z => z === 1 ? 2 : 1)} onError={e => { (e.currentTarget as HTMLImageElement).src = media.content(shown); }} />}
      {i > 0 && <button className="nav-arrow prev" aria-label="Previous" onClick={() => step(-1)}><Icon.Back /></button>}
      {i >= 0 && i < siblings.length - 1 && <button className="nav-arrow next" aria-label="Next" onClick={() => step(1)}><Icon.Next /></button>}
    </div>
    {item.kind === 'video' && <div className="bottom" style={{ borderTop: 'none', paddingBottom: 0 }}><button className="btn small" onClick={() => void pickFrame()}><Icon.Frame />Save this frame as an image</button></div>}
    {info ? <div className="bottom" style={{ display: 'block', maxHeight: '40vh', overflow: 'auto' }}><div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}><AssetPanel item={item} compact onClosed={onClose} /></div></div>
      : <div className="bottom"><button className="btn primary" onClick={() => app.useResult({ ...item, job }, 'refine')}><Icon.Pencil />Refine</button>{item.kind === 'image' && <button className="btn" onClick={() => app.useResult({ ...item, job }, 'animate')}><Icon.Film />Animate</button>}<button className="btn" onClick={() => setInfo(true)}>More…</button></div>}
  </div>;
}

/** Two results, A and B, at matched size. Phones show one at a time with an A | B switch. */
export function Compare({ a, b, onClose }: { a: ViewerItem; b: ViewerItem; onClose: () => void }) {
  const app = useApp();
  const [side, setSide] = useState<'A' | 'B'>('A'), [zoom, setZoom] = useState(1), [diff, setDiff] = useState(!app.narrow);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  useEffect(() => { for (const x of [a, b]) void assetsApi.get(x.asset).then(d => setFavs(f => ({ ...f, [x.asset]: Boolean(d.favorite) }))).catch(() => {}); }, [a.asset, b.asset]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'a' || e.key === 'ArrowLeft') setSide('A'); if (e.key === 'b' || e.key === 'ArrowRight') setSide('B'); }; addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, []);
  const fig = (x: ViewerItem, letter: 'A' | 'B') => <figure key={letter} className={app.narrow && side !== letter ? 'hidden-phone' : ''} aria-label={letter + ': ' + x.title}>
    <div className="frame" onClick={() => setZoom(z => z === 1 ? 2 : 1)}>
      <span className="pill letter">{letter} · {x.title}</span>
      {x.kind === 'video' ? <video src={media.content(x.asset)} controls playsInline muted loop /> : <img src={media.preview(x.asset, true)} alt={x.title} style={{ transform: `scale(${zoom})`, transition: 'transform .15s' }} />}
    </div>
    <figcaption>
      <button className="btn" aria-pressed={favs[x.asset]} aria-label={(favs[x.asset] ? 'Remove ' : 'Add ') + letter + ' to favorites'} onClick={() => void assetsApi.favorite(x.asset, !favs[x.asset]).then(() => setFavs(f => ({ ...f, [x.asset]: !f[x.asset] })))}>{favs[x.asset] ? <Icon.HeartFill style={{ color: 'var(--accent)' }} /> : <Icon.Heart />}</button>
      <button className="btn primary" onClick={() => { onClose(); app.useResult(x, 'refine'); }}>Continue from {letter}</button>
    </figcaption>
  </figure>;
  return <div className="viewer" role="dialog" aria-modal="true" aria-label="Compare two results">
    <div className="vtop">
      <button className="btn small close" onClick={onClose} autoFocus><Icon.Close />Close</button><b>Compare</b>
      <div className="seg phone-only" role="group" aria-label="Show A or B"><button aria-pressed={side === 'A'} onClick={() => setSide('A')}>A</button><button aria-pressed={side === 'B'} onClick={() => setSide('B')}>B</button></div>
      <span className="faint no-phone" style={{ fontSize: 13 }}>Click to zoom both · A/B keys</span>
      <span style={{ flex: 1 }} />
      <button className="btn small" aria-pressed={diff} onClick={() => setDiff(d => !d)}>Differences</button>
    </div>
    {diff && <Differences a={a} b={b} />}
    <div className="compare-grid">{fig(a, 'A')}{fig(b, 'B')}</div>
  </div>;
}

/** What separates A from B: settings, seed, prompt words, and whether one was made from the other. */
function Differences({ a, b }: { a: ViewerItem; b: ViewerItem }) {
  const ja = useDetail(a).job, jb = useDetail(b).job;
  if (!ja || !jb) return <div className="diffbar faint">Reading how each was made…</div>;
  const ca = new Map(settingChips(ja.request, id => id)), cb = new Map(settingChips(jb.request, id => id));
  const keys = [...new Set([...ca.keys(), ...cb.keys()])].filter(k => ca.get(k) !== cb.get(k));
  const rows: Array<[string, string]> = keys.map(k => [k.startsWith('style') ? 'Style' : k[0]!.toUpperCase() + k.slice(1), `${ca.get(k) ?? '—'} → ${cb.get(k) ?? '—'}`]);
  if (ja.seed !== jb.seed) rows.push(['Seed', `${ja.seed} → ${jb.seed}`]);
  if (ja.request.prompt !== jb.request.prompt) rows.push(['Prompt', promptChanges(ja.request.prompt, jb.request.prompt).join(' ')]);
  const lineage = jb.request.references?.some(r => r.asset_id === a.asset) ? 'B was made from A' : ja.request.references?.some(r => r.asset_id === b.asset) ? 'A was made from B' : '';
  return <div className="diffbar" aria-label="Differences between A and B">
    {lineage && <span className="chip on">{lineage}</span>}
    {!rows.length && !lineage && <span className="faint">Same prompt and settings{ja.seed === jb.seed ? ' and seed' : ''}.</span>}
    {rows.map(([k, v]) => <span key={k} className="chip"><b style={{ fontWeight: 600 }}>{k}</b>&nbsp;{v}</span>)}
  </div>;
}
