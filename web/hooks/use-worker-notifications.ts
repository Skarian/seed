import { useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast/headless';
import type { PoolSnapshot } from '../../shared/pool.js';
import { hasUndismissedLaunchFailure } from '../../shared/worker-outcome.js';

/** Opening the app establishes a baseline; later failures and readiness notify once. */
export function useWorkerNotifications(snapshot: PoolSnapshot | null) {
  const waiting = useRef(new Set<string>());
  const announced = useRef(new Set<string>());
  const initialized = useRef(false);
  const failed = useRef(new Set<string>());
  useEffect(() => {
    if (!snapshot) return;
    const ready = { image: 0, video: 0 };
    for (const worker of snapshot.workers) {
      if (hasUndismissedLaunchFailure(worker) && !failed.current.has(worker.id)) {
        failed.current.add(worker.id);
        if (initialized.current) toast.error(`${worker.worker_class === 'image' ? 'Image' : 'Video'} worker launch failed. Open GPU workers for details.`, { id: 'worker-launch-' + worker.id, duration: 6000 });
      }
      if (worker.state === 'released' || worker.quit_mode) { waiting.current.delete(worker.id); continue; }
      const usable = !!worker.ready_at || ['ready', 'generating', 'saving'].includes(worker.state);
      if (!usable && !announced.current.has(worker.id)) waiting.current.add(worker.id);
      if (usable && waiting.current.delete(worker.id) && !announced.current.has(worker.id)) {
        announced.current.add(worker.id);
        ready[worker.worker_class]++;
      }
    }
    initialized.current = true;
    const parts = (['image', 'video'] as const).filter(role => ready[role]).map(role =>
      `${ready[role] === 1 ? '' : ready[role] + ' '}${role} worker${ready[role] === 1 ? '' : 's'} ready`);
    if (parts.length) {
      const message = parts.join(' · ');
      toast.success(message[0]!.toUpperCase() + message.slice(1), { id: 'workers-ready', duration: 6000 });
    }
  }, [snapshot]);
}
