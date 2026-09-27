import React from 'react';
import type { PoolWorker } from '../shared/pool.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { useWorkerPool } from './hooks/use-worker-pool.js';

export type WorkerShutdown = {
  action: 'finish' | 'quit';
  worker?: Pick<PoolWorker, 'id' | 'gpu' | 'provider' | 'worker_class'>;
};

export function WorkerShutdownConfirm({ request, onClose }: {
  request: WorkerShutdown;
  onClose: () => void;
}) {
  const pool = useWorkerPool();
  const { action, worker } = request;
  const immediate = action === 'quit';
  const count = pool.snapshot?.workers.filter(item => item.state !== 'released').length ?? 0;
  const target = worker
    ? `this ${worker.worker_class} worker (${worker.gpu} on ${worker.provider === 'vast' ? 'Vast' : 'RunPod'})`
    : `all ${count} workers`;
  const effect = immediate
    ? worker
      ? `Cancel this worker's jobs and delete ${target} and its disk now. Unfinished outputs will be lost.`
      : `Cancel all queued and running jobs and delete ${target} and their disks now. Unfinished outputs will be lost.`
    : `Finish already accepted compatible jobs, then delete ${target} and ${worker ? 'its disk' : 'their disks'}. Later requests will not keep ${worker ? 'it' : 'them'} running.`;
  return <ConfirmDialog
    title={immediate ? (worker ? 'Quit this worker now?' : 'Quit all workers now?') : (worker ? 'Finish jobs and quit?' : 'Finish jobs and quit all?')}
    description={`${effect} Saved Library items stay. Billing continues until the provider confirms release.`}
    action={immediate ? (worker ? 'Quit now' : 'Quit all now') : (worker ? 'Finish and quit' : 'Finish and quit all')}
    onConfirm={() => pool.action(action, worker?.id)}
    onClose={onClose}
  />;
}
