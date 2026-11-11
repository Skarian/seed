import { isTerminal, type JobRecord } from './jobs.js';
import type { LoraImportActivity } from './loras.js';
import type { PoolWorker } from './pool.js';

export type ClearedActivity = {
  jobs: Record<string, string>;
  imports: Record<string, string>;
  workers: Record<string, string>;
};
export const emptyClearedActivity = (): ClearedActivity => ({ jobs: {}, imports: {}, workers: {} });
export const finishedActivityJob = (job: JobRecord) =>
  isTerminal(job.state) && !job.recovery_blocked && !job.recovery?.pending;
export const finishedActivityImport = (job: LoraImportActivity) => ['ready', 'failed'].includes(job.state);
export const workerActivityRevision = (worker: PoolWorker) => worker.released_at ?? worker.created_at;
export const visibleActivityJob = (job: JobRecord, cleared: ClearedActivity) =>
  !finishedActivityJob(job) || cleared.jobs[job.id] !== job.updated_at;
export const visibleActivityImport = (job: LoraImportActivity, cleared: ClearedActivity) =>
  !finishedActivityImport(job) || cleared.imports[job.id] !== job.updated_at;
export const visibleActivityWorker = (worker: PoolWorker, cleared: ClearedActivity) =>
  worker.state !== 'released' || cleared.workers[worker.id] !== workerActivityRevision(worker);
