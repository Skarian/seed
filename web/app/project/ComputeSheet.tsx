import React, { useEffect, useMemo, useState } from 'react';
import { pool as poolApi, randomKey, type OffersResponse, type WorkerClass } from '../api.js';
import { Dialog, Spinner } from '../ui.js';
import { rate, money, estimateText } from '../format.js';
import { useApp, useStoredState } from '../data.js';
import type { WorkerOffer } from '../../../shared/pool.js';

export const capChoices = [
  [15, '15 minutes'],
  [30, '30 minutes'],
  [60, '1 hour'],
  [120, '2 hours'],
  [240, '4 hours'],
  [480, '8 hours'],
  [0, 'No limit'],
] as const;
export const idleChoices = [
  [5, '5 minutes'],
  [15, '15 minutes'],
  [30, '30 minutes'],
  [60, '1 hour'],
  [0, 'Never (I release it myself)'],
] as const;
const gb = (bytes?: number) => (bytes ? (bytes / 1024 ** 3).toFixed(0) + ' GB' : '');

/** Explicit consent for a new rental, bound to one quote. Closing it starts nothing. */
export function ComputeSheet({
  role,
  action,
  seconds,
  onClose,
  onStarted,
}: {
  role: WorkerClass;
  action: string;
  seconds?: number | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { refreshPool, go, pool } = useApp();
  const [offers, setOffers] = useState<OffersResponse | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<string>(''),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false);
  const voluntary = action === 'keep it ready';
  // A rental for one task defaults to a short lease; keeping a GPU ready is a deliberate choice with its own defaults.
  const [storedIdle, setIdle] = useStoredState('seed.idleRelease.all', 15);
  // A remembered value that is no longer offered falls back to the default, so menu and summary always agree.
  const idle = idleChoices.some(([v]) => v === storedIdle) ? storedIdle : 15;
  const [cap, setCap] = useStoredState('seed.rentalCap.all', 60);
  const [releaseIdle, setReleaseIdle] = useState(false);
  const [key] = useState(randomKey);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await poolApi.offers(role);
      setOffers(r);
      setChoice(c => (c && r.items.some(o => o.id === c) ? c : (r.items.find(o => o.available)?.id ?? '')));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [role]);
  const items = (offers?.items ?? []).filter(o => o.available);
  const picks = useMemo(() => {
    if (more) return items;
    const cheapest = items[0],
      reliable = [...items].sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0) || a.hourly - b.hourly)[0];
    return [cheapest, reliable].filter(
      (o, i, all): o is WorkerOffer => Boolean(o) && all.findIndex(x => x?.id === o!.id) === i,
    );
  }, [items, more]);
  const selected = items.find(o => o.id === choice);
  const expired = selected && Date.parse(selected.expires_at) <= Date.now();
  const local = pool?.local;
  const others = (pool?.workers ?? []).filter(w => w.state !== 'released' && !w.quit_mode);
  // Any idle GPU can be released when this one starts, including one of the same kind it replaces (for example one
  // started before a new style was added).
  const idleOthers = others.filter(w => w.state === 'ready' && !w.current_job_id);
  const othersRate = others.reduce((n, w) => n + w.hourly, 0);
  async function start() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await poolApi.launch(
        {
          selections: [{ offer_id: selected.id, quantity: 1 }],
          max_hourly: selected.hourly,
          idle_release_minutes: idle,
          max_minutes: cap,
        },
        key,
      );
      if (releaseIdle) for (const w of idleOthers) void poolApi.act(w.id, 'finish');
      refreshPool();
      onStarted();
    } catch (e) {
      setError((e as Error).message + ' Nothing was rented.');
      void load();
    } finally {
      setBusy(false);
    }
  }
  const noun = role === 'video' ? 'a video GPU' : 'an image GPU';
  // The two limits in one sentence: whichever comes first ends the rental.
  const latest = cap
    ? new Date(Date.now() + cap * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  const stopsBy =
    cap && idle
      ? `By ${latest} at the latest, or after ${idle} idle minutes if that comes first`
      : cap
        ? `By ${latest} at the latest`
        : idle
          ? `After ${idle} idle minutes, or when you release it`
          : 'Only when you release it';
  return (
    <Dialog
      title={voluntary ? `Start ${noun}` : `This needs ${noun}`}
      onClose={onClose}
      footer={
        <>
          {/* A failed start is said beside the button that failed, never only above the fold. */}
          {error && (
            <span className="ready bad" role="alert" style={{ marginRight: 'auto', fontSize: '0.875rem' }}>
              {error}
            </span>
          )}
          <button className="btn" onClick={onClose}>
            {voluntary ? 'Cancel' : 'Back'}
          </button>
          <button className="btn primary" disabled={!selected || busy || expired} onClick={() => void start()}>
            {busy ? 'Starting…' : voluntary ? `Start ${noun.replace(/^an? /, '')}` : `Start GPU and ${action}`}
          </button>
        </>
      }
    >
      {/* One decision: what it costs, what this task needs, and when it stops. Details are underneath. */}
      {selected && (
        <div className="receipt">
          <p className="receipt-head">
            <b>
              {voluntary ? 'Starts' : 'To ' + action + ', Seed starts'} {noun} at {rate(selected.hourly)}.
            </b>
          </p>
          <div className="kv">
            {!voluntary && (
              <>
                <span>This task</span>
                <div>
                  {seconds == null ? (
                    'No estimate yet for this kind of work.'
                  ) : (
                    <>
                      {estimateText(seconds)} once it is ready ·{' '}
                      <b>
                        {(selected.hourly * seconds) / 3600 < 0.01
                          ? 'under $0.01'
                          : 'about ' + money((selected.hourly * seconds) / 3600)}
                      </b>
                    </>
                  )}
                </div>
              </>
            )}
            <span>Start-up</span>
            <div>
              {selected.model_download_bytes
                ? `Downloads ${gb(selected.model_download_bytes)} of models first.`
                : 'Starts the machine first.'}{' '}
              You pay from the moment it starts, downloads included.
            </div>
            <span>Release after</span>
            <div>
              <select
                className="select"
                aria-label="Release after"
                value={cap}
                onChange={e => setCap(Number(e.target.value))}
              >
                {capChoices.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                    {v ? ` · about ${money((selected.hourly * v) / 60)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <span>When idle</span>
            <div>
              <select
                className="select"
                aria-label="Release when idle for"
                value={idle}
                onChange={e => setIdle(Number(e.target.value))}
              >
                {idleChoices.map(([v, l]) => (
                  <option key={v} value={v}>
                    {v ? 'Release after ' + l : l}
                  </option>
                ))}
              </select>
            </div>
            <span>Stops</span>
            <div>{stopsBy}</div>
            {others.length > 0 && (
              <>
                <span>{others.length === 1 ? 'Both running' : `All ${others.length + 1} running`}</span>
                <div>
                  <b>{rate(othersRate + selected.hourly)}</b> in total. You already rent{' '}
                  {others
                    .map(
                      w =>
                        (w.worker_class === 'video' ? 'a video' : 'an image') +
                        ' GPU' +
                        (w.state === 'ready' && !w.current_job_id ? ' (idle)' : ''),
                    )
                    .join(' and ')}
                  {others.some(w => w.worker_class !== role)
                    ? '; image and video need different GPUs.'
                    : '; the running one cannot take this work (for example a style added after it started).'}
                  {idleOthers.length > 0 && (
                    <label className="release-row">
                      <input type="checkbox" checked={releaseIdle} onChange={e => setReleaseIdle(e.target.checked)} />
                      <span>
                        {idleOthers.length === 1
                          ? `Release the idle ${idleOthers[0]!.worker_class} GPU when this starts`
                          : `Release the ${idleOthers.length} idle GPUs when this starts`}{' '}
                        <span className="faint">(using them again means downloading their models again)</span>
                      </span>
                    </label>
                  )}
                </div>
              </>
            )}
          </div>
          <p className="receipt-note">
            Nothing is rented until you press Start. Costs are estimates, not a cap. Billing continues if you close the
            browser, and automatic release only happens while the Seed PC is on.
          </p>
        </div>
      )}
      {loading && <Spinner label="Finding available machines…" />}

      {!loading && !items.length && !error && (
        <div className="notice">
          No machines are available right now
          {offers?.issues.length ? ': ' + offers.issues.map(i => i.message).join(' ') : '.'}{' '}
          <div className="actions">
            <button className="btn small" onClick={() => void load()}>
              Check again
            </button>
            <button className="btn small" onClick={() => go({ name: 'settings', section: 'keys' })}>
              Check API keys
            </button>
          </div>
        </div>
      )}
      {/* A real radio group: one tab stop, arrow keys move and choose. */}
      <div
        role="radiogroup"
        aria-label="Machine"
        style={{ display: 'grid', gap: 8 }}
        onKeyDown={e => {
          const step =
            e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
          if (!step || !picks.length) return;
          e.preventDefault();
          const at = Math.max(
            0,
            picks.findIndex(o => o.id === choice),
          );
          const next = picks[(at + step + picks.length) % picks.length]!;
          setChoice(next.id);
          const group = e.currentTarget;
          requestAnimationFrame(() =>
            group.querySelector<HTMLElement>(`[data-offer="${CSS.escape(next.id)}"]`)?.focus(),
          );
        }}
      >
        {picks.map((o, i) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={o.id === choice}
            tabIndex={o.id === choice || (!picks.some(p => p.id === choice) && i === 0) ? 0 : -1}
            data-offer={o.id}
            className="option"
            onClick={() => setChoice(o.id)}
          >
            <span className="radio" />
            <span>
              <b>{!more && i === 0 ? 'Lowest price' : !more ? 'Most reliable' : o.gpu}</b> — {rate(o.hourly)}
              <small>
                {o.gpu} · {o.provider === 'vast' ? 'Vast' : 'RunPod'}
                {o.reliability ? ` · ${Math.round(o.reliability * 100)}% reliable` : ''}
              </small>
            </span>
          </button>
        ))}
        {!local?.enabled && (
          <button className="option" onClick={() => go({ name: 'gpus' })}>
            <span className="radio" />
            <span>
              <b>Seed PC</b> — no rental fee
              <small>
                {local
                  ? 'Turned off. Turn it on in GPUs.'
                  : 'Not set up yet (large one-time download). Set it up in GPUs.'}
              </small>
            </span>
          </button>
        )}
      </div>
      {items.length > 2 && (
        <button className="link" style={{ justifySelf: 'start' }} onClick={() => setMore(m => !m)}>
          {more ? 'Show recommended only' : `More machines (${items.length})`}
        </button>
      )}
      {selected && (
        <details className="receipt-more">
          <summary className="link">Machine and billing details</summary>
          <p>
            Compute {rate(selected.compute_hourly)} + storage {rate(selected.storage_hourly)} · {selected.vram_gb} GB
            VRAM · {selected.region}
            {selected.download_per_gb
              ? ` · transfer ${rate(selected.download_per_gb).replace('/h', '/GB')}`
              : ' · transfer charges not quoted'}
            .
          </p>
          <p>
            Prices are the provider’s current quote. Billing starts when the provider accepts the rental.{' '}
            {idle
              ? `If the GPU then sits idle until it is released, that idle time costs about ${money((selected.hourly * idle) / 60)}.`
              : 'With no idle release it bills until you release it.'}{' '}
            Seed releases it while the Seed server is running; if the server is off, release it from the provider’s
            console.
          </p>
        </details>
      )}
      {expired && (
        <div className="notice" role="alert">
          This quote expired.{' '}
          <button className="link" onClick={() => void load()}>
            Get a fresh quote
          </button>
        </div>
      )}
    </Dialog>
  );
}
