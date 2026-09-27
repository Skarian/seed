import { workerStateLabels, type PoolWorker } from './pool.js';

/** A rejected purchase is terminal, but is not a successfully released rental. */
export function isRejectedLaunch(worker: Pick<PoolWorker, 'state' | 'create_rejected' | 'provider_id'>) {
  return worker.state === 'released' && worker.create_rejected === true && !worker.provider_id;
}

export function hasUndismissedLaunchFailure(worker: PoolWorker) {
  return isRejectedLaunch(worker) && !worker.launch_failure_dismissed_at;
}

export function workerStatusLabel(worker: PoolWorker) {
  if (isRejectedLaunch(worker)) return 'Launch failed';
  return worker.quit_mode === 'finish' && !['releasing', 'released'].includes(worker.state)
    ? 'Finishing' : workerStateLabels[worker.state];
}
