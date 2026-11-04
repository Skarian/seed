import React, { useEffect, useState } from 'react';
import { pool as poolApi, type LocalSetupStatus, type WorkerClass } from '../api.js';
import { useApp } from '../data.js';
import { Icon } from '../icons.js';
import { Confirm, Dialog } from '../ui.js';
import { money, rate, duration } from '../format.js';
import { StatusControl } from '../App.js';
import { ComputeSheet, capChoices, idleChoices } from '../project/ComputeSheet.js';
import type { PoolWorker } from '../../../shared/pool.js';
import type { LocalWorkerView } from '../../../shared/local-worker.js';

const workerLabel: Record<string, string> = { starting: 'Starting', preparing: 'Loading models', ready: 'Ready · idle', generating: 'Making', saving: 'Saving', reconnecting: 'Reconnecting', finishing: 'Finishing current work, then releasing', releasing: 'Releasing', released: 'Released', needs_attention: 'Needs attention' };

function idleNote(w: PoolWorker) {
  const cap = w.max_minutes && w.allocated_at ? ` · stops by ${new Date(Date.parse(w.allocated_at) + w.max_minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  if (!w.idle_release_minutes) return ' · no idle release' + cap;
  if (!w.idle_since) return ` · releases after ${w.idle_release_minutes} idle min` + cap;
  const left = Math.max(0, Math.ceil(w.idle_release_minutes - (Date.now() - Date.parse(w.idle_since)) / 60000));
  return ` · idle, releases in ${left} min unless used` + cap;
}
function startupNote(w: PoolWorker) {
  const p = w.preparation; if (!p || !p.bytes_total || !['starting', 'preparing'].includes(w.state)) return '';
  return ` · models ${Math.round(p.bytes_done / p.bytes_total * 100)}%${p.eta_seconds ? ' · about ' + Math.max(1, Math.round(p.eta_seconds / 60)) + ' min left' : ''}`;
}

/** Change when a running rental releases itself. */
function LimitsDialog({ worker, onClose }: { worker: PoolWorker; onClose: () => void }) {
  const { refreshPool } = useApp();
  const [idle, setIdle] = useState(worker.idle_release_minutes ?? 0), [cap, setCap] = useState(worker.max_minutes ?? 0), [error, setError] = useState('');
  const start = worker.allocated_at ? Date.parse(worker.allocated_at) : Date.now();
  const at = (minutes: number) => new Date(start + minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const caps = [...capChoices.map(([v]) => v as number), ...(worker.max_minutes && !capChoices.some(([v]) => v === worker.max_minutes) ? [worker.max_minutes] : [])].sort((a, b) => (a || 1e9) - (b || 1e9));
  const past = cap > 0 && start + cap * 60000 <= Date.now();
  async function save() { try { await poolApi.limits(worker.id, { idle_release_minutes: idle, max_minutes: cap }); refreshPool(); onClose(); } catch (e) { setError((e as Error).message); } }
  return <Dialog title={'Limits for the ' + worker.gpu} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => void save()}>Save limits</button></>}>
    <label className="field"><span>Release when idle for</span><select className="select" value={idle} onChange={e => setIdle(Number(e.target.value))}>{idleChoices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <label className="field"><span>Stop the rental</span><select className="select" value={cap} onChange={e => setCap(Number(e.target.value))}>{caps.map(v => <option key={v} value={v}>{v ? `At ${at(v)} (${v / 60} ${v === 60 ? 'hour' : 'hours'} after it started)` : 'No time limit'}</option>)}</select></label>
    {past && <p className="notice" style={{ margin: 0 }}>That time has passed. The GPU finishes its current work, then releases.</p>}
    {error && <p className="notice error" style={{ margin: 0 }}>{error}</p>}
  </Dialog>;
}

export function GpusPage() {
  return <>
    <header className="head"><h1 className="serif">GPUs</h1><span className="spacer" /><StatusControl /></header>
    <div className="scroll"><div className="col"><div className="page"><GpuOverview /></div></div></div>
  </>;
}

/** Seed PC, rented cloud GPUs, starting one, and what it all cost. Used on the GPUs page and in the status panel. */
export function GpuOverview({ compact = false }: { compact?: boolean }) {
  const { pool, refreshPool } = useApp();
  const [start, setStart] = useState<WorkerClass | null>(null);
  const [release, setRelease] = useState<PoolWorker | null>(null), [limits, setLimits] = useState<PoolWorker | null>(null);
  const active = (pool?.workers ?? []).filter(w => w.state !== 'released');
  const recent = (pool?.workers ?? []).filter(w => w.state === 'released' && w.released_at && Date.now() - Date.parse(w.released_at) < 86_400_000 && w.estimated_spend > 0).slice(0, compact ? 3 : 10);
  const hourly = pool?.summary.hourly ?? 0;
  return <>
    {!compact && <LocalCard />}
    <h2 className="subhead">Cloud GPUs</h2>
    <div className="box">
      <div className="row"><span className="grow"><b>{active.length ? `${active.length} running · ${rate(hourly)}` : 'Nothing rented'}</b><br /><span className="muted" style={{ fontSize: 13.5 }}>Last 24 hours · estimated {money(pool?.summary.spend_24h ?? pool?.summary.estimated_spend ?? 0)}, including released GPUs</span></span></div>
      <div className="row"><button className="btn" onClick={() => setStart('image')}><Icon.Plus />Start an image GPU</button><button className="btn" onClick={() => setStart('video')}><Icon.Plus />Start a video GPU</button></div>
    </div>
    {active.map(w => <div className="box" key={w.id}>
      <div className="row">
        <span className={'dot ' + (w.state === 'needs_attention' ? 'amber' : ['generating', 'saving', 'preparing', 'starting'].includes(w.state) ? 'live' : '')} />
        <span className="grow"><b>{w.worker_class === 'video' ? 'Video' : 'Image'} GPU · {w.gpu}</b><br /><span className="muted" style={{ fontSize: 13.5 }}>{w.provider === 'vast' ? 'Vast' : 'RunPod'} · {rate(w.hourly)} · up {duration(w.elapsed_seconds)} · {money(w.estimated_spend)} so far</span></span>
        {w.actions.includes('finish') && !w.quit_mode && <button className="btn quiet" onClick={() => setLimits(w)}>Limits…</button>}
        {w.actions.includes('finish') && <button className="btn" onClick={() => setRelease(w)}>Release…</button>}
      </div>
      <div className="muted" style={{ fontSize: 13.5 }}>{w.current_activity ?? workerLabel[w.state] ?? w.state}{startupNote(w)}{w.state === 'ready' ? idleNote(w) : ''}</div>
      {w.preparation && !w.preparation.error && w.state === 'preparing' && w.preparation.bytes_total > 0 && <div className="meter" aria-label="Model download progress"><i style={{ width: Math.round(w.preparation.bytes_done / w.preparation.bytes_total * 100) + '%' }} /></div>}
      {(w.issue || w.preparation?.error) && <div className="notice error">{w.issue?.message ?? w.preparation?.error}
        <div className="actions">{w.actions.filter(a => ['reconnect', 'retry_preparation', 'omit_loras', 'local_fallback', 'dismiss_launch_failure'].includes(a)).map(a => <button key={a} className="btn small" onClick={() => void poolApi.act(w.id, a).then(refreshPool)}>{{ reconnect: 'Reconnect', retry_preparation: 'Retry setup', omit_loras: 'Continue without styles', local_fallback: 'Use fallback models', dismiss_launch_failure: 'Dismiss' }[a as string]}</button>)}</div></div>}
    </div>)}
    {recent.length > 0 && <><h2 className="subhead">Released recently</h2>{recent.map(w => <div className="box" key={w.id}><div className="row"><span className="grow">{w.worker_class === 'video' ? 'Video' : 'Image'} GPU · {w.gpu}<br /><span className="muted" style={{ fontSize: 13.5 }}>{duration(w.elapsed_seconds)} · {money(w.estimated_spend)} estimated{w.released_reason === 'idle' ? ' · released when idle' : w.released_reason === 'limit' ? ' · released at its time limit' : ''}</span></span></div></div>)}</>}
    {start && <ComputeSheet role={start} action="keep it ready" onClose={() => setStart(null)} onStarted={() => setStart(null)} />}
    {limits && <LimitsDialog worker={limits} onClose={() => setLimits(null)} />}
    {release && (release.state === 'ready' && !release.current_job_id ? <Confirm title={`Release the ${release.gpu}?`} action="Release" onClose={() => setRelease(null)}
      body={<p style={{ margin: 0 }}>It is idle, so nothing is cancelled. Results stay in your Library. Billing stops when the provider confirms the release.</p>}
      onConfirm={() => { void poolApi.act(release.id, 'finish').then(refreshPool); setRelease(null); }} />
      : <Confirm title={`Release the ${release.gpu}?`} action="Finish current work, then release" onClose={() => setRelease(null)}
      body={<><p style={{ margin: 0 }}>Work already running on it finishes and saves first, then the rental ends. Results stay in your Library. Billing stops when the provider confirms the release.</p>
        <p style={{ margin: '10px 0 0' }}><button className="link" style={{ color: 'var(--red)' }} onClick={() => { void poolApi.act(release.id, 'quit').then(refreshPool); setRelease(null); }}>Release now and cancel its running work</button></p></>}
      onConfirm={() => { void poolApi.act(release.id, 'finish').then(refreshPool); setRelease(null); }} />)}
  </>;
}

function LocalCard() {
  const { refreshPool } = useApp();
  const [status, setStatus] = useState<{ setup: LocalSetupStatus & { installed?: boolean; state?: string; phase?: string; error?: string; bytes_done?: number; bytes_total?: number; required_additional_bytes?: number; disk_free_bytes?: number }; worker: LocalWorkerView | null } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => { let live = true; const load = () => void poolApi.local().then(v => live && setStatus(v as never)).catch(e => live && setError(e.message)); load(); const t = setInterval(load, 2500); return () => { live = false; clearInterval(t); }; }, []);
  async function act(action: string) { setBusy(true); setError(''); try { if (action === 'setup') await poolApi.localSetup(); else await poolApi.localAction(action); setStatus(await poolApi.local() as never); refreshPool(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const s = status?.setup, w = status?.worker, gb = (n?: number) => ((n ?? 0) / 1024 ** 3).toFixed(0) + ' GB';
  return <>
    <h2 className="subhead">Seed PC</h2>
    <div className="box">
      <div className="row"><span className={'dot ' + (w?.enabled && !w.paused ? (w.current_job_id ? 'live' : '') : 'off')} /><span className="grow"><b>{w?.gpu ?? 'This computer'}</b><br /><span className="muted" style={{ fontSize: 13.5 }}>{!s ? 'Checking…' : s.supported === false ? 'Local GPU work needs Windows.' : !s.installed ? 'Not set up' : !w?.enabled ? 'Off' : w.paused ? 'Paused' : w.current_activity ?? (w.state === 'sleeping' ? 'Ready · loads models when needed' : workerLabel[w.state] ?? w.state)} · no rental fee</span></span>
        {s?.supported !== false && s && (!s.installed ? <button className="btn primary" disabled={busy || s.state === 'running'} onClick={() => setConfirm(true)}>{s.state === 'running' ? 'Setting up…' : s.state === 'failed' ? 'Resume setup' : 'Set up'}</button>
          : !w?.enabled || w.paused ? <button className="btn primary" disabled={busy} onClick={() => void act('enable')}>{w?.paused ? 'Resume' : 'Turn on'}</button>
            : <button className="btn" disabled={busy} onClick={() => void act('disable')}>Turn off after current work</button>)}
      </div>
      {s?.state === 'running' && <><div className="meter"><i style={{ width: Math.round((s.bytes_done ?? 0) / Math.max(1, s.bytes_total ?? 1) * 100) + '%' }} /></div><span className="muted" style={{ fontSize: 13.5 }}>{s.phase} · {gb(s.bytes_done)} of {gb(s.bytes_total)}</span></>}
      {w?.enabled && <span className="muted" style={{ fontSize: 13.5 }}>{w.workflows.some(x => x.endsWith('video')) ? 'Makes images and video.' : 'Makes images. Video needs a cloud GPU.'}</span>}
      {(error || s?.error || w?.issue) && <div className="notice error" role="alert">{error || s?.error || w?.issue?.message}{w?.issue && <div className="actions"><button className="btn small" onClick={() => void act('recover')}>Try again</button></div>}</div>}
    </div>
    {confirm && s && <Confirm title="Set up Seed PC?" action={`Download ${gb(s.bytes_total)}`} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void act('setup'); }}
      body={<p style={{ margin: 0 }}>Seed downloads about {gb(s.bytes_total)} of models and a runtime. Keep about {gb(s.required_additional_bytes)} free{s.disk_free_bytes ? ` (you have ${gb(s.disk_free_bytes)})` : ''}. You can keep working while it downloads, and resume if it stops.</p>} />}
  </>;
}
