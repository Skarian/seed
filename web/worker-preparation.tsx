import React from 'react';
import type { PoolWorker } from '../shared/pool.js';
import { formatBytes } from './format.js';
import { downloadTime } from './worker-status.js';

export function WorkerPreparation({ worker, serverTime }: { worker: PoolWorker; serverTime?: string }) {
  if (worker.ready_at || ['ready', 'generating', 'saving', 'released', 'releasing'].includes(worker.state)) return null;
  const prep = worker.preparation;
  const engine = prep?.stage === 'starting_engine';
  const checking = prep?.stage === 'verifying';
  const failed = worker.state === 'needs_attention' || worker.state === 'reconnecting';
  const step = !prep ? 0 : engine ? 2 : 1;
  const total = prep?.bytes_total ?? 0;
  const done = Math.max(0, Math.min(total, prep?.bytes_done ?? 0));
  const percent = total > 0 ? Math.floor(done / total * 100) : null;
  const rate = !failed && !prep?.stalled ? prep?.bytes_per_second ?? 0 : 0;
  const eta = rate > 0 && !checking && !engine ? prep?.eta_seconds : null;
  const startupTitle = worker.startup_stage && {
    downloading_container: 'Downloading worker container',
    verifying_container: 'Verifying worker container',
    retrying_container: 'Provider retrying container startup',
    waiting_for_ssh: 'Connecting to your worker',
  }[worker.startup_stage];
  const title = worker.quit_mode ? 'Finishing accepted requests' : failed ? 'Setup paused' : !prep ? startupTitle ?? 'Starting your worker' : engine ? 'Starting generation engine' : checking ? 'Checking model files' : 'Downloading models';
  const reportTime = Date.parse(prep?.last_transfer_update_at ?? ''), now = Date.parse(serverTime ?? '');
  const age = Number.isFinite(reportTime) && Number.isFinite(now) ? Math.max(0, Math.floor((now - reportTime) / 1000)) : null;
  const freshness = age === null ? null : age < 5 ? 'just now' : age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ${Math.floor(age % 3600 / 60)}m ago`;
  const rateLabel = rate > 0 ? `${formatBytes(rate)}/s` : !failed && !prep?.stalled && prep?.bytes_per_second === 0 ? 'Measuring rate' : 'Rate unavailable';
  return <section className={'worker-preparation' + (failed ? ' paused' : '')} aria-label="Worker setup">
    <ol className="worker-setup-steps" aria-label="Setup stages">
      {['Acquire', 'Models', 'Engine'].map((label, index) => <li key={label} className={index < step ? 'complete' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}>
        <span>{index < step ? '✓' : index + 1}</span>{label}
      </li>)}
    </ol>
    <div className="worker-setup-heading"><strong>{title}</strong>{step === 1 && percent !== null && <span>{percent}%</span>}</div>
    {step === 1 && <progress aria-label="Model download progress" value={total ? done : undefined} max={total || undefined} />}
    {step === 1 && <div className="worker-transfer-stats"><span>{total ? `${formatBytes(done)} of ${formatBytes(total)}` : 'Connecting to model storage'}</span>{!checking && <span>{rateLabel}</span>}</div>}
    {step === 1 && !checking && freshness && <small className="worker-transfer-freshness">Last transfer update {freshness}</small>}
    <p className="worker-setup-hint">{failed ? 'Use the recovery options below, or quit at any time.' : worker.quit_mode ? 'This worker will quit after its accepted requests are saved.' : !prep ? 'Waiting for the provider to start the container and connect.' : engine ? 'Models are downloaded. Loading the runtime and checking the GPU.' : checking ? 'Verifying downloaded files before starting the engine.' : prep.stalled ? 'Waiting for transfer updates. The worker may still be downloading.' : eta != null ? `${downloadTime(eta)}. Engine startup follows.` : total && done === total ? 'Downloads finished. Checking files before engine startup.' : prep.bytes_per_second == null ? 'Files download directly to this worker. Transfer speed is not reported.' : 'Measuring download speed. Files download directly to this worker.'}</p>
    {step === 1 && prep && <details className="worker-download-files"><summary>Model files · {prep.files.filter(file => file.ready).length} of {prep.files.filter(file => !file.omitted).length} verified</summary>
      <ul>{prep.files.map((file, index) => <li key={file.path}><span>{file.optional ? `Adapter ${prep.files.slice(0, index + 1).filter(f => f.optional).length}` : file.path.startsWith('text_encoders/') ? 'Text encoder' : file.path.includes('audio') ? 'Audio model' : file.path.startsWith('vae/') ? worker.worker_class === 'image' ? 'Image decoder' : 'Video decoder' : file.path.includes('ref2va') ? 'Reference video model' : worker.worker_class === 'image' ? 'Image model' : 'Video model'}</span><small>{file.omitted ? 'Skipped' : file.error ? 'Needs attention' : file.ready ? 'Verified' : file.state === 'verifying' || file.state === 'checking' ? 'Checking' : file.state === 'downloading' ? `${formatBytes(file.bytes ?? 0)} / ${formatBytes(file.total ?? 0)}` : 'Waiting'}</small></li>)}</ul>
    </details>}
  </section>;
}
