import React, { useEffect, useMemo, useState } from 'react';
import { pool as poolApi, randomKey, type OffersResponse, type WorkerClass } from '../api.js';
import { Dialog, Spinner } from '../ui.js';
import { rate, money, estimateText } from '../format.js';
import { useApp, useStoredState } from '../data.js';
import type { WorkerOffer } from '../../../shared/pool.js';

export const capChoices = [[60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [0, 'No limit']] as const;
export const idleChoices = [[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never (I release it myself)']] as const;
const gb = (bytes?: number) => bytes ? (bytes / 1024 ** 3).toFixed(0) + ' GB' : '';

/** Explicit consent for a new rental, bound to one quote. Closing it starts nothing. */
export function ComputeSheet({ role, action, seconds, onClose, onStarted }: { role: WorkerClass; action: string; seconds?: number | null; onClose: () => void; onStarted: () => void }) {
  const { refreshPool, go, pool } = useApp();
  const [offers, setOffers] = useState<OffersResponse | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<string>(''), [more, setMore] = useState(false), [busy, setBusy] = useState(false);
  const [idle, setIdle] = useStoredState('seed.idleRelease', 15);
  const [cap, setCap] = useStoredState('seed.rentalCap', 120);
  const [releaseIdle, setReleaseIdle] = useState(true);
  const voluntary = action === 'keep it ready';
  const [key] = useState(randomKey);
  async function load() {
    setLoading(true); setError('');
    try { const r = await poolApi.offers(role); setOffers(r); setChoice(c => c && r.items.some(o => o.id === c) ? c : r.items.find(o => o.available)?.id ?? ''); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [role]);
  const items = (offers?.items ?? []).filter(o => o.available);
  const picks = useMemo(() => {
    if (more) return items;
    const cheapest = items[0], reliable = [...items].sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0) || a.hourly - b.hourly)[0];
    return [cheapest, reliable].filter((o, i, all): o is WorkerOffer => Boolean(o) && all.findIndex(x => x?.id === o!.id) === i);
  }, [items, more]);
  const selected = items.find(o => o.id === choice);
  const expired = selected && Date.parse(selected.expires_at) <= Date.now();
  const local = pool?.local;
  const others = (pool?.workers ?? []).filter(w => w.state !== 'released' && !w.quit_mode);
  const idleOthers = others.filter(w => w.worker_class !== role && w.state === 'ready' && !w.current_job_id);
  const othersRate = others.reduce((n, w) => n + w.hourly, 0);
  async function start() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await poolApi.launch({ selections: [{ offer_id: selected.id, quantity: 1 }], max_hourly: selected.hourly, idle_release_minutes: idle, max_minutes: cap }, key);
      if (releaseIdle) for (const w of idleOthers) void poolApi.act(w.id, 'finish');
      refreshPool(); onStarted();
    } catch (e) { setError((e as Error).message + ' Nothing was rented.'); void load(); }
    finally { setBusy(false); }
  }
  const noun = role === 'video' ? 'a video GPU' : 'an image GPU';
  return <Dialog title={voluntary ? `Start ${noun}` : `This needs ${noun}`} onClose={onClose} footer={<>
    <button className="btn" onClick={onClose}>{voluntary ? 'Cancel' : 'Back to plan'}</button>
    <button className="btn primary" disabled={!selected || busy || expired} onClick={() => void start()}>{busy ? 'Starting…' : voluntary ? `Start ${noun.replace(/^an? /, '')}` : `Start GPU and ${action}`}</button>
  </>}>
    <p className="muted" style={{ margin: 0 }}>Nothing is rented until you press Start. Prices are the provider's current quote.</p>
    {loading && <Spinner label="Finding available machines…" />}
    {error && <div className="notice error" role="alert">{error}</div>}
    {!loading && !items.length && !error && <div className="notice">No machines are available right now{offers?.issues.length ? ': ' + offers.issues.map(i => i.message).join(' ') : '.'} <div className="actions"><button className="btn small" onClick={() => void load()}>Check again</button><button className="btn small" onClick={() => go({ name: 'settings', section: 'keys' })}>Check API keys</button></div></div>}
    <div role="radiogroup" aria-label="Machine" style={{ display: 'grid', gap: 8 }}>
      {picks.map((o, i) => <button key={o.id} role="radio" aria-checked={o.id === choice} className="option" onClick={() => setChoice(o.id)}>
        <span className="radio" />
        <span><b>{o.gpu} · {o.provider === 'vast' ? 'Vast' : 'RunPod'}</b> — {rate(o.hourly)}
          <small>compute {rate(o.compute_hourly)} + storage {rate(o.storage_hourly)}{!more && i === 0 ? ' · lowest hourly rate' : ''}{o.reliability ? ` · reliability ${Math.round(o.reliability * 100)}%` : ''} · {o.vram_gb} GB VRAM · {o.region}</small>
          <small>Startup time not known{o.model_download_bytes ? ` · downloads ${gb(o.model_download_bytes)} of models first` : ''}{o.download_per_gb ? ` · transfer ${rate(o.download_per_gb).replace('/h', '/GB')}` : ' · transfer charges not quoted'}</small>
        </span>
      </button>)}
      {!local?.enabled && <button className="option" role="radio" aria-checked={false} onClick={() => go({ name: 'gpus' })}><span className="radio" /><span><b>Seed PC</b> — no rental fee<small>{local ? 'Turned off. Turn it on in GPUs.' : 'Not set up yet (large one-time download). Set it up in GPUs.'}</small></span></button>}
    </div>
    {items.length > 2 && <button className="link" style={{ justifySelf: 'start' }} onClick={() => setMore(m => !m)}>{more ? 'Show recommended only' : `More machines (${items.length})`}</button>}
    {others.length > 0 && selected && <div className="notice" style={{ fontSize: 13.5 }}>This adds a second rental: you already rent {others.map(w => (w.worker_class === 'video' ? 'a video' : 'an image') + ' GPU at ' + rate(w.hourly) + (w.state === 'ready' && !w.current_job_id ? ' (idle)' : '')).join(' and ')}. Image and video need different GPUs. Total while both run: <b>{rate(othersRate + selected.hourly)}</b>.
      {idleOthers.length > 0 && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><input type="checkbox" checked={releaseIdle} onChange={e => setReleaseIdle(e.target.checked)} /> Release the idle {idleOthers[0]!.worker_class} GPU when this starts</label>}</div>}
    <label className="field"><span>Stop renting after (even if busy, it finishes the current output first)</span>
      <select className="select" value={cap} onChange={e => setCap(Number(e.target.value))}>{capChoices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {selected && !voluntary && <p style={{ margin: 0, fontSize: 13.5 }}><b>This task:</b> {seconds == null ? 'no estimate yet, because nothing like it has finished in this project. The first result sets one.' : <>{estimateText(seconds)} of making once the GPU is ready, about <b>{money(selected.hourly * seconds / 3600)}</b> at this rate.</>} Start-up and model download come first and are billed too.</p>}
    {selected && cap > 0 && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>The most this rental can cost is about <b>{money(selected.hourly * cap / 60)}</b> ({rate(selected.hourly)} for {cap / 60} {cap === 60 ? 'hour' : 'hours'}), plus any transfer charges the provider adds.</p>}
    <label className="field"><span>Release it automatically when idle for</span>
      <select className="select" value={idle} onChange={e => setIdle(Number(e.target.value))}>{idleChoices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {selected && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Billing starts when the provider accepts the rental. {idle ? `If it then sits idle until release, that idle time costs about ${money(selected.hourly * idle / 60)}` : 'With no idle release it bills until you release it'}, plus the time to start, download models and make.</p>}
    <p className="faint" style={{ margin: 0, fontSize: 13 }}>Closing this browser doesn't stop the GPU. Seed's server releases it when idle. If the Seed server itself is off, release it from the provider's console.</p>
    {expired && <div className="notice" role="alert">This quote expired. <button className="link" onClick={() => void load()}>Get a fresh quote</button></div>}
  </Dialog>;
}
