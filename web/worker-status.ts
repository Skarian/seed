import type { PoolWorker } from '../shared/pool.js';

export function poolStatusText(workers: PoolWorker[]) {
  const groups = { preparing: 0, ready: 0, busy: 0, attention: 0, quitting: 0 };
  for (const worker of workers) {
    if (worker.state === 'released') continue;
    if (worker.quit_mode || worker.state === 'releasing') groups.quitting++;
    else if (worker.issue || worker.state === 'needs_attention' || worker.state === 'reconnecting') groups.attention++;
    else if (worker.state === 'ready') groups.ready++;
    else if (worker.state === 'generating' || worker.state === 'saving') groups.busy++;
    else groups.preparing++;
  }
  return [groups.preparing && `${groups.preparing} preparing`, groups.ready && `${groups.ready} ready`,
    groups.busy && `${groups.busy} busy`, groups.attention && `${groups.attention} need attention`,
    groups.quitting && `${groups.quitting} finishing`].filter(Boolean).join(' · ') || 'No workers running';
}

export function downloadTime(seconds: number) {
  if (seconds < 60) return 'Less than a minute of downloads left';
  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`} of downloads left`;
}
