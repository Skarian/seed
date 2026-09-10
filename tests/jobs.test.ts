import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Jobs } from '../server/jobs.js';
import { openDatabase } from '../server/db.js';
import { resolvePaths, prepareStorage } from '../server/storage.js';
import type { WorkerConnection } from '../server/worker.js';

async function fixture(run: (f: any) => Promise<void>) {
  mkdirSync('.local/tests', { recursive: true }); const root = mkdtempSync(path.resolve('.local/tests/jobs-'));
  const paths = resolvePaths(root); prepareStorage(paths); const db = openDatabase(paths.data);
  const image = Buffer.from('test-image-bytes'); const sha = createHash('sha256').update(image).digest('hex');
  const state = { session: 'engine-one', running: [] as any[], records: {} as Record<string, any>, submits: 0, acknowledgments: 0, failReceipt: false, failTransfer: false, orphan: false };
  const cap = () => ({ revision: 'test-v1', ready: true, workspace_id: 'volume-one', engine_session_id: state.session, nsfw: { filename: 'seed-' + 'a'.repeat(64) + '.safetensors', sha256: 'a'.repeat(64), strength_model: 1, revision: 'test' } });
  const fake = {
    connected: true, identity: { workspace_id: 'volume-one', worker_instance_id: 'worker-one' },
    async json(route: string, options: any = {}) {
      if (route === '/comfy/capabilities' || route === '/comfy/session') return cap();
      if (route === '/comfy/queue') return { queue_running: state.running, queue_pending: [] };
      if (route === '/worker/v1/jobs') return { items: state.orphan ? [{ job_id: 'foreign', acknowledged: false }] : [], next_cursor: null };
      if (route.endsWith('/receipt')) { if (state.failReceipt) throw new Error('lost receipt'); state.acknowledgments++; return { cleanup_complete: true }; }
      return state.records[route.split('/')[4]!];
    },
    async request(route: string, options: any = {}) {
      if (route === '/comfy/prompt') {
        state.submits++; const id = options.body.prompt_id; state.running = [[0, id]];
        state.records[id] = { submission: { job_id: id, workspace_id: 'volume-one', engine_session_id: state.session } };
        return Response.json({ prompt_id: id });
      }
      if (route.includes('/outputs/')) {
        if (state.failTransfer) throw new Error('disconnected');
        const offset = options.range ?? 0;
        return new Response(image.subarray(offset), { status: offset ? 206 : 200, headers: offset ? { 'Content-Range': `bytes ${offset}-${image.length - 1}/${image.length}` } : {} });
      }
      return state.records[route.split('/')[4]!] ? Response.json({}) : new Response(null, { status: 404 });
    },
  };
  const jobs = new Jobs(db, paths, fake as unknown as WorkerConnection);
  const request = { workflow: 'text-to-image', capabilities_revision: 'test-v1', prompt: 'A mountain', mode: 'sfw', seed: '42', count: 1, output: { aspect: '16:9', size: '1mp' } };
  function finish(id: string) {
    state.running = [];
    const manifest = { job_id: id, workspace_id: 'volume-one', engine_session_id: 'engine-one', state: 'completed', outputs: [{ id: '0', size: image.length, sha256: sha, mime_type: 'image/png' }], error: null };
    const raw = JSON.stringify(manifest);
    state.records[id] = { ...state.records[id], manifest, manifest_bytes: raw, manifest_digest: createHash('sha256').update(raw).digest('hex') };
  }
  try { await run({ jobs, state, request, finish, paths, db, image }); }
  finally { await jobs.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
}

it.each(['failed', 'cancelled'])('retries cleanup after terminal %s without regenerating', async terminalState => fixture(async ({ jobs, state, request }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'terminal-cleanup-key');
  await jobs.reconcile();
  state.running = [];
  const manifest = { job_id: job.id, workspace_id: 'volume-one', engine_session_id: 'engine-one', state: terminalState, outputs: [], error: 'Stopped' };
  const raw = JSON.stringify(manifest);
  state.records[job.id] = { ...state.records[job.id], manifest, manifest_bytes: raw, manifest_digest: createHash('sha256').update(raw).digest('hex') };
  state.failReceipt = true;
  await jobs.reconcile();
  expect(jobs.get(job.id).state).toBe(terminalState);
  expect(jobs.get(job.id).output_save_state).toBe('not_applicable');
  expect(jobs.get(job.id).cleanup_state).toBe('pending');
  state.failReceipt = false;
  await jobs.reconcile();
  expect(jobs.get(job.id).cleanup_state).toBe('complete');
  expect(state.submits).toBe(1);
}));

it('freezes both modes, expands seeds atomically, and replays one submission without duplicates', async () => fixture(async ({ jobs, request, state }: any) => {
  const first = await jobs.submit({ ...request, count: 2 }, 'submission-key-0001');
  const again = await jobs.submit({ ...request, count: 2 }, 'submission-key-0001');
  expect(again.jobs.map((j: any) => j.id)).toEqual(first.jobs.map((j: any) => j.id));
  expect(first.jobs.map((j: any) => j.seed)).toEqual(['42', '43']);
  expect(first.jobs[0].graph['10']).toBeUndefined();
  const nsfw = await jobs.submit({ ...request, mode: 'nsfw' }, 'submission-key-0002');
  expect(nsfw.jobs[0].graph['10'].inputs.lora_name).toBe(nsfw.jobs[0].preset.filename);
  await expect(jobs.submit({ ...request, prompt: 'Changed' }, 'submission-key-0001')).rejects.toThrow('different settings');
  expect(state.submits).toBe(0);
}));

it('accepts random-seed batches and preserves their concrete seeds on retry', async () => fixture(async ({ jobs, request }: any) => {
  const randomRequest = { ...request, seed: 'random', count: 16 };
  const first = await jobs.submit(randomRequest, 'random-seed-regression');
  const generated = first.jobs.map((job: any) => job.seed);
  expect(new Set(generated).size).toBe(16);
  for (const job of first.jobs) {
    expect(Number.isSafeInteger(Number(job.seed))).toBe(true);
    expect(Number(job.seed)).toBeGreaterThanOrEqual(0);
    expect(Number(job.seed)).toBeLessThan(2 ** 48);
    expect(job.graph['7'].inputs.seed).toBe(Number(job.seed));
  }
  const retry = await jobs.submit(randomRequest, 'random-seed-regression');
  expect(retry.jobs.map((job: any) => job.seed)).toEqual(generated);
  expect(retry.jobs.map((job: any) => job.id)).toEqual(first.jobs.map((job: any) => job.id));
}));

it('recovers transfer and acknowledgment independently without regeneration or duplicate Library rows', async () => fixture(async ({ jobs, request, state, finish, paths, db, image }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'submission-key-0001');
  await jobs.reconcile(); expect(state.submits).toBe(1);
  finish(job.id); state.failTransfer = true;
  await jobs.reconcile(); expect(jobs.get(job.id).state).toBe('copy_pending'); expect(state.acknowledgments).toBe(0);
  state.failTransfer = false; state.failReceipt = true;
  await jobs.reconcile(); expect(jobs.get(job.id).state).toBe('completed'); expect(jobs.get(job.id).cleanup_state).toBe('pending');
  const file = path.join(paths.data, 'media/outputs', job.id + '-0.png');
  expect(readFileSync(file)).toEqual(image);
  state.failReceipt = false; await jobs.reconcile();
  expect(jobs.get(job.id).cleanup_state).toBe('complete'); expect(state.submits).toBe(1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 });
  expect(existsSync(file)).toBe(true);
}));

it('blocks unknown spool work and never repeats an interrupted execution in a new session', async () => fixture(async ({ jobs, request, state }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'submission-key-0001');
  state.orphan = true; await jobs.reconcile(); expect(state.submits).toBe(0); expect(jobs.safe).toBe(false);
  state.orphan = false; await jobs.reconcile(); expect(state.submits).toBe(1);
  state.session = 'engine-two'; state.running = [];
  await jobs.reconcile(); expect(jobs.get(job.id).state).toBe('needs_attention');
  await jobs.reconcile(); expect(state.submits).toBe(1);
  jobs.acknowledge(job.id);
  expect(jobs.get(job.id).uncertainty_acknowledged).toBe(true);
  const next = await jobs.submit(request, 'submission-key-0002');
  await jobs.reconcile(); expect(state.submits).toBe(2);
  expect(next.jobs[0].id).not.toBe(job.id);
}));


it('retains worker measurements and freezes saved time across cleanup retries', async () => fixture(async ({ jobs, request, state, finish }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'metrics-retention-0001');
  expect(job.metrics.inputs).toMatchObject({ total: 0, image: 0, video: 0, audio: 0 });
  await jobs.reconcile();
  finish(job.id);
  state.records[job.id].telemetry = { version: 2, complete: true, execution_seconds: 12.5, sample_count: 6, gpus: [{ name: 'Test GPU', peak_used_mib: 30000 }] };
  state.failReceipt = true;
  await jobs.reconcile();
  const saved = jobs.get(job.id);
  expect(saved.metrics.worker.execution_seconds).toBe(12.5);
  expect(saved.metrics.submitted_at).toBeTruthy();
  expect(saved.metrics.elapsed_to_saved_seconds).toBeGreaterThanOrEqual(0);
  state.failReceipt = false;
  await jobs.reconcile();
  expect(jobs.get(job.id).metrics.saved_at).toBe(saved.metrics.saved_at);
  expect(jobs.get(job.id).cleanup_state).toBe('complete');
}));
