import React, {useEffect, useRef, useState} from 'react';
import type {PoolWorker} from '../shared/pool.js';
import {useWorkerStartupLogs} from './hooks/use-worker-startup-logs.js';

const time = (value?: string) => value ? new Date(value).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '';
export function WorkerStartupLogs({worker, selected = false}: {worker: PoolWorker; selected?: boolean}) {
  const [open, setOpen] = useState(selected);
  const root = useRef<HTMLDetailsElement>(null);
  const preview = !worker.preparation && !worker.ready_at && !worker.quit_mode && !['released', 'releasing', 'generating', 'saving'].includes(worker.state);
  const {record, error, loading, refresh} = useWorkerStartupLogs(worker.id, open || preview, worker.state);
  useEffect(() => { if (selected) { setOpen(true); root.current?.scrollIntoView({block: 'nearest'}); } }, [selected]);
  const saved = record?.collection === 'sealed';
  const provider = record?.sections.find(s => s.source !== 'Worker setup');
  const latest = provider?.text.split('\n').filter(Boolean).at(-1);
  const status = !record ? error || 'Loading startup logs…' : record.sealed_reason === 'legacy' ? 'Startup logs unavailable'
    : saved ? record.sealed_reason === 'ready' ? 'Startup complete · saved logs' : 'Saved startup logs'
    : record.availability === 'unavailable' ? 'Log updates delayed'
    : record.phase !== 'acquire' ? 'Recording setup progress'
    : provider?.text ? 'Receiving provider startup logs' : 'Waiting for provider output';
  return <details className="worker-startup-logs" ref={root} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>{open ? 'Startup logs' : 'View startup logs'}</span>{saved && <span className="startup-saved">Saved</span>}
      {!open && preview && latest && <span className="startup-preview">{latest}</span>}
    </summary>
    {open && <div className="startup-log-content">
      <div className="startup-log-status"><span role="status">{status}</span>
        <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh startup logs">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {record && <p className="startup-log-time">{record.sealed_at ? `Saved at ${time(record.sealed_at)}` : record.checked_at ? `Last checked ${time(record.checked_at)}` : record.attempted_at ? `Last attempt ${time(record.attempted_at)}` : 'Waiting for the first check'}</p>}
      {record?.reason && <p className="startup-log-reason">{record.reason}</p>}
      {error && record && <p className="startup-log-reason" role="alert">{error} Previous logs are still shown.</p>}
      {record?.sections.map(section => <section key={section.source} aria-label={section.source}>
        <div className="startup-log-source"><strong>{section.source}</strong><span>{time(section.captured_at)}</span></div>
        <pre tabIndex={0} aria-label={`${section.source} log text`}>{section.text}</pre>
      </section>)}
      {record?.truncated && <p className="startup-log-time">Showing the latest captured lines. Older lines were trimmed.</p>}
      {record && record.sealed_reason !== 'legacy' && <p className="startup-log-time">Startup and setup only. Generation logs are not included.</p>}
    </div>}
  </details>;
}
