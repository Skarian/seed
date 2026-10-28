import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { StudioPaths } from './storage.js';
import type { Jobs } from './jobs.js';
import type { LoraImports } from './lora-imports.js';
import type { WorkerPool } from './pool.js';
import { emptyClearedActivity, finishedActivityJob, finishedActivityImport, workerActivityRevision, type ClearedActivity } from '../shared/activity.js';

export class Activity {
  private file: string;
  private cleared: ClearedActivity;
  constructor(paths: StudioPaths) {
    this.file = path.join(paths.config, 'activity-cleared.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!saved || !['jobs', 'imports', 'workers'].every(key =>
        saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key]) &&
        Object.values(saved[key]).every(value => typeof value === 'string'))) throw Error();
      this.cleared = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('Cannot read activity-cleared.json.');
      this.cleared = emptyClearedActivity();
    }
  }
  snapshot() { return this.cleared; }
  clear(mode: 'sfw' | 'nsfw', jobs: Pick<Jobs,'all'>, imports: Pick<LoraImports,'list'>, pool: Pick<WorkerPool,'snapshot'>) {
    const next: ClearedActivity = {
      jobs: { ...this.cleared.jobs }, imports: { ...this.cleared.imports }, workers: { ...this.cleared.workers },
    };
    for (const job of jobs.all())
      if (job.request.mode === mode && finishedActivityJob(job)) next.jobs[job.id] = job.updated_at;
    for (const job of imports.list(mode))
      if (finishedActivityImport(job)) next.imports[job.id] = job.updated_at;
    for (const worker of pool.snapshot().workers)
      if (worker.state === 'released') next.workers[worker.id] = workerActivityRevision(worker);
    // Synchronous commit keeps simultaneous clears from losing one another's entries.
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.file);
    } finally { rmSync(temporary, { force: true }); }
    this.cleared = next;
    return next;
  }
}

export function registerActivity(app: FastifyInstance, activity: Activity, jobs: Jobs, imports: LoraImports, pool: WorkerPool) {
  app.get('/api/v1/activity/cleared', async () => activity.snapshot());
  app.post('/api/v1/activity/clear', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { enum: ['sfw', 'nsfw'] } } } },
  }, async (request, reply) => {
    try { return activity.clear((request.body as {mode:'sfw'|'nsfw'}).mode, jobs, imports, pool); }
    catch { return reply.code(503).send({ error: { code: 'activity_clear_failed', message: 'Could not clear activity. Try again.', retryable: true } }); }
  });
}
