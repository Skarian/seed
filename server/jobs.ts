import { Media, type PreparedReference } from './media.js';
import { videoRoute } from './video.js';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { StudioPaths } from './storage.js';
import { WorkerConnection } from './worker.js';
import { graphFor, imageRequest, seeds, type Capabilities, type ImageRequest, type Preset } from './workflows.js';

type Job = { metrics?: { version: 1; inputs: { total: number; image: number; video: number; audio: number; prepared_bytes: number; video_soundtracks: number }; transfer_started_at?: string; submitted_at?: string; saved_at?: string; terminal_at?: string; elapsed_to_terminal_seconds?: number; elapsed_to_saved_seconds?: number; worker?: Record<string, unknown> }; generation_percent?: number; prepared?: PreparedReference[]; id: string; state: string; submission_id: string; submission_index: number; request: ImageRequest; seed: string; preset: Preset | null; graph: ReturnType<typeof graphFor>; workspace_id: string; engine_session_id?: string; outputs: string[]; error: string | null; cleanup_state: string; output_save_state: string; created_at: string; updated_at: string; uncertainty_acknowledged?: boolean };
type Output = { id: string; path: string; size: number; sha256: string; mime_type: string };
const terminal = ['completed', 'failed', 'cancelled'];
const hashFile = async (file: string) => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };

export class Jobs {
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;
  public capabilities: Capabilities | null = null;
  public checkedAt: number | null = null;
  public safe: boolean | null = null;
  public reason = 'Checking the engine and saved outputs.';
  public media: Media;
  constructor(private db: Database.Database, private paths: StudioPaths, private worker: WorkerConnection) { this.media = new Media(db, paths); }
  serialize<T>(fn: () => Promise<T>): Promise<T> { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next; }
  start() { this.timer = setInterval(() => { void this.tick(); }, 2000); void this.tick(); }
  async close() { this.stopped = true; clearInterval(this.timer); await this.chain; }
  invalidate() { this.safe = null; this.checkedAt = null; this.capabilities = null; }
  list(limit = 50, cursor = ''): Job[] { return (this.db.prepare('SELECT snapshot_json FROM jobs WHERE (? = \'\' OR (created_at,id) < (SELECT created_at,id FROM jobs WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?').all(cursor, cursor, limit) as { snapshot_json: string }[]).map(r => JSON.parse(r.snapshot_json)); }
  all(): Job[] { return (this.db.prepare('SELECT snapshot_json FROM jobs ORDER BY created_at, submission_index').all() as { snapshot_json: string }[]).map(r => JSON.parse(r.snapshot_json)); }
  get(id: string): Job | null { const row = this.db.prepare('SELECT snapshot_json FROM jobs WHERE id = ?').get(id) as { snapshot_json: string } | undefined; return row ? JSON.parse(row.snapshot_json) : null; }
  save(job: Job) { if (job.metrics && terminal.includes(job.state) && !job.metrics.terminal_at) { job.metrics.terminal_at = new Date().toISOString(); job.metrics.elapsed_to_terminal_seconds = (Date.parse(job.metrics.terminal_at) - Date.parse(job.created_at)) / 1000; } job.updated_at = new Date().toISOString(); this.db.prepare('UPDATE jobs SET state=?, snapshot_json=?, updated_at=? WHERE id=?').run(job.state, JSON.stringify(job), job.updated_at, job.id); }
  get paused() { return Boolean((this.db.prepare('SELECT paused FROM dispatcher_state WHERE id=1').get() as { paused: number }).paused); }
  pause(value: boolean) { this.db.prepare('UPDATE dispatcher_state SET paused=? WHERE id=1').run(value ? 1 : 0); this.safe = null; this.checkedAt = null; }
  async submit(raw: unknown, key: string) {
    const request = imageRequest(raw);
    if (!/^[\w-]{16,128}$/.test(key)) throw new Error('A submission key is required.');
    const body = JSON.stringify(request);
    const previous = this.db.prepare('SELECT id,body_json FROM submissions WHERE idempotency_key=?').get(key) as { id: string; body_json: string } | undefined;
    if (previous) { if (previous.body_json !== body) throw new Error('This submission key belongs to different settings.'); return { submission_id: previous.id, jobs: this.all().filter(j => j.submission_id === previous.id) }; }
    const cap = await this.inspectCapabilities();
    if (request.capabilities_revision !== cap.revision) throw new Error('Pod settings changed. Refresh and try again.');
    if (this.all().some(j => j.state === 'needs_attention' && !j.uncertainty_acknowledged)) throw new Error('Resolve the previous interrupted job before generating.');
    const isVideo = request.workflow !== 'text-to-image';
    if(isVideo && !cap.video?.ready) throw new Error('This worker does not support video yet.');
    const selectedPreset = request.mode === 'nsfw' ? (isVideo ? cap.video?.nsfw[videoRoute(request)] : cap.nsfw) : null;
    if(request.mode === 'nsfw' && !selectedPreset) throw new Error('The selected mode is not available for these references.');
    const prepared: PreparedReference[] = [];
    for(const ref of request.references ?? []) prepared.push(await this.media.prepare(ref,request.output.aspect,request.output.duration_seconds!));
    const submission_id = randomUUID(), now = new Date().toISOString();
    const jobs = seeds(request).map((seed, index): Job => {
      const id = randomUUID(), preset = selectedPreset ?? null;
      return { metrics: { version: 1, inputs: { total: prepared.length, image: prepared.filter(r => r.kind === 'image').length, video: prepared.filter(r => r.kind === 'video').length, audio: prepared.filter(r => r.kind === 'audio').length, video_soundtracks: prepared.filter(r => r.audio_file).length, prepared_bytes: prepared.reduce((n, r) => n + statSync(r.file).size + (r.audio_file ? statSync(r.audio_file).size : 0), 0) } }, id, state: 'queued', submission_id, submission_index: index, request, seed, preset, graph: graphFor(request, id, seed, preset, prepared), ...(prepared.length ? {prepared} : {}), workspace_id: cap.workspace_id, outputs: [], error: null, cleanup_state: 'not_requested', output_save_state: 'pending', created_at: now, updated_at: now };
    });
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO submissions VALUES (?,?,?)').run(submission_id, key, body);
      const insert = this.db.prepare('INSERT INTO jobs(id,workflow,state,snapshot_json,created_at,updated_at,submission_id,submission_index) VALUES (?,?,?,?,?,?,?,?)');
      for (const job of jobs) insert.run(job.id, request.workflow, job.state, JSON.stringify(job), now, now, submission_id, job.submission_index);
    })();
    // Explicit Create resumes new work; never a pod start operation.
    this.pause(false);
    return { submission_id, jobs };
  }
  async inspectCapabilities() {
    const cap = await this.worker.json('/comfy/capabilities') as Capabilities;
    if (!cap.ready || cap.workspace_id !== this.worker.identity?.workspace_id || typeof cap.engine_session_id !== 'string' || typeof cap.revision !== 'string') throw new Error('The image engine is not ready.');
    if (cap.nsfw && (!/^[\w.-]+\.safetensors$/.test(cap.nsfw.filename) || !/^[a-f0-9]{64}$/i.test(cap.nsfw.sha256) || !Number.isFinite(cap.nsfw.strength_model) || cap.nsfw.strength_model < 0 || cap.nsfw.strength_model > 2)) throw new Error('The pod has an invalid LoRA preset.');
    this.capabilities = cap; return cap;
  }
  async cancel(id: string) {
    const job = this.get(id); if (!job) throw new Error('Job not found.');
    if (terminal.includes(job.state)) return job;
    if (job.state === 'queued') { job.state = 'cancelled'; job.output_save_state = 'not_applicable'; }
    else if (job.state === 'needs_attention') throw new Error('The previous execution is uncertain. Reconnect its volume to recover it.');
    else job.state = 'cancel_requested';
    this.safe = null; this.save(job); return job;
  }
  acknowledge(id: string) {
    const job = this.get(id);
    if (!job || job.state !== 'needs_attention') throw new Error('Only an uncertain job can be acknowledged.');
    job.uncertainty_acknowledged = true; this.save(job); this.safe = null;
    return job;
  }
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try { await this.serialize(() => this.reconcile()); } catch { this.invalidate(); this.reason = 'Cannot verify the pod. Pending work and files are retained.'; }
    finally { this.ticking = false; }
  }
  async reconcile() {
    if (!this.worker.connected) { this.invalidate(); this.reason = 'No pod connected.'; return; }
    this.safe = null;
    const cap = await this.inspectCapabilities();
    const queue = await this.worker.json('/comfy/queue');
    if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('Unknown queue');
    const session = await this.worker.json('/comfy/session');
    if (session.engine_session_id !== cap.engine_session_id || session.workspace_id !== cap.workspace_id) throw new Error('Engine changed');
    const nativeIds = [...queue.queue_running, ...queue.queue_pending].map((item: unknown[]) => item[1]);
    const jobs = this.all();
    const foreign = nativeIds.some((id: unknown) => !jobs.some(j => j.id === id && j.engine_session_id === cap.engine_session_id));
    let cursor: string | null = '', orphan = false;
    const seen = new Set<string>();
    do {
      const inventory = await this.worker.json('/worker/v1/jobs' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(inventory.items)) throw new Error('Invalid spool inventory');
      for (const item of inventory.items) if (!jobs.some(j => j.id === item.job_id) && !item.acknowledged && (!item.manifest || item.manifest.state === 'completed')) orphan = true;
      cursor = inventory.next_cursor;
      if (cursor) { if (typeof cursor !== 'string' || seen.has(cursor)) throw new Error('Invalid inventory cursor'); seen.add(cursor); }
    } while (cursor);
    for (const job of jobs) {
      if (job.state === 'queued' || (terminal.includes(job.state) && job.cleanup_state !== 'pending')) continue;
      if (job.workspace_id !== cap.workspace_id) { if (!terminal.includes(job.state)) { job.state = 'needs_attention'; job.error = 'Reconnect the original model volume to recover this job.'; this.save(job); } continue; }
      const response = await this.worker.request('/worker/v1/jobs/' + job.id);
      if (response.status === 404) { await response.body?.cancel(); if (!terminal.includes(job.state)) { job.state = 'needs_attention'; job.error = 'Submission outcome is unknown; it will not be run again automatically.'; this.save(job); } continue; }
      if (!response.ok) { await response.body?.cancel(); throw new Error('Cannot reconcile output'); }
      // Use bounded JSON decoding for manifest inventory too.
      await response.body?.cancel();
      const record = await this.worker.json('/worker/v1/jobs/' + job.id);
      if (record.submission.job_id !== job.id || record.submission.workspace_id !== job.workspace_id || record.submission.engine_session_id !== job.engine_session_id) throw new Error('Job identity mismatch');
      if (job.metrics && record.telemetry?.version === 1 && typeof record.telemetry === 'object') { job.metrics.worker = record.telemetry; this.save(job); }
      if (record.manifest) {
        const manifest = this.manifest(job, record);
        if (manifest.state === 'completed') { await this.retrieve(job, manifest.outputs, record.manifest_digest); }
        else {
          job.state = manifest.state === 'cancelled' ? 'cancelled' : 'failed'; job.error = manifest.error;
          job.output_save_state = 'not_applicable'; job.cleanup_state = 'pending'; this.save(job);
          await this.acknowledgeOutputs(job, record.manifest_digest);
        }
      } else if (job.engine_session_id !== cap.engine_session_id || !nativeIds.includes(job.id)) { job.state = 'needs_attention'; job.error = 'Generation was interrupted or its outcome is uncertain. No automatic rerun.'; this.save(job); }
      else if (job.state === 'cancel_requested') { if (!foreign) await this.worker.json('/comfy/cancel', { method: 'POST', body: { job_id: job.id }, session: job.engine_session_id }); }
      else {
        job.state = 'running';
        const progress = session.sampling_progress;
        const sampler = job.request.workflow.endsWith('video') ? '11' : '7';
        job.generation_percent = progress?.prompt_id === job.id && progress.node === sampler && Number.isInteger(progress.percent) && progress.percent >= 0 && progress.percent <= 100 ? progress.percent : undefined;
        this.save(job);
      }
    }
    const current = this.all();
    const unresolved = current.some(j => !terminal.includes(j.state) && j.state !== 'queued' && !(j.state === 'needs_attention' && j.uncertainty_acknowledged));
    if (!this.paused && !foreign && !orphan && !unresolved && nativeIds.length === 0) {
      const next = current.find(j => j.state === 'queued');
      if (next) {
        if (next.metrics && !next.metrics.transfer_started_at) { next.metrics.transfer_started_at = new Date().toISOString(); this.save(next); }
        try {
          for(const ref of next.prepared ?? []) { await this.worker.upload(next.id,ref.file,ref.filename); if(ref.audio_file && ref.audio_filename) await this.worker.upload(next.id,ref.audio_file,ref.audio_filename); }
        } catch { next.error='Reference transfer interrupted. It will retry before generation.';this.save(next);return; }
        next.workspace_id = cap.workspace_id; next.engine_session_id = cap.engine_session_id; next.state = 'submitting'; if(next.metrics) next.metrics.submitted_at = new Date().toISOString(); this.save(next);
        try {
          const result = await this.worker.request('/comfy/prompt', { method: 'POST', session: cap.engine_session_id, body: { prompt_id: next.id, prompt: next.graph, preset: next.preset } });
          if (!result.ok) {
            const rejection = await result.json().catch(() => null);
            if ([409, 422].includes(result.status) && rejection?.accepted === false) { next.state = 'failed'; next.output_save_state = 'not_applicable'; next.error = rejection.error; this.save(next); return; }
            throw new Error('Uncertain submission');
          }
          await result.body?.cancel(); next.state = 'running'; this.save(next);
        }
        catch { next.state = 'needs_attention'; next.error = 'Submission response was lost or rejected. Reconciling before any further work.'; this.save(next); }
        return;
      }
    }
    const finalQueue = await this.worker.json('/comfy/queue');
    const finalSession = await this.worker.json('/comfy/session');
    if (finalSession.engine_session_id !== cap.engine_session_id || finalSession.workspace_id !== cap.workspace_id || !Array.isArray(finalQueue.queue_running) || !Array.isArray(finalQueue.queue_pending)) throw new Error('Engine changed during reconciliation');
    this.checkedAt = Date.now();
    this.safe = this.paused && !foreign && !orphan && !unresolved && !finalQueue.queue_running.length && !finalQueue.queue_pending.length;
    this.reason = orphan ? 'The volume has work from another seed library. Recover it before stopping or generating.' : foreign ? 'The pod is running work outside seed.' : unresolved ? 'Work or unsaved outputs remain.' : !this.paused ? 'Pause the queue before stopping the pod.' : 'No active work or unsaved outputs.';
  }
  private manifest(job: Job, record: any) {
    if (typeof record.manifest_bytes !== 'string' || createHash('sha256').update(record.manifest_bytes).digest('hex') !== record.manifest_digest) throw new Error('Output manifest integrity failed');
    const manifest = JSON.parse(record.manifest_bytes);
    if (manifest.job_id !== job.id || manifest.workspace_id !== job.workspace_id || manifest.engine_session_id !== job.engine_session_id || !['completed', 'failed', 'cancelled'].includes(manifest.state) || !Array.isArray(manifest.outputs)) throw new Error('Output identity mismatch');
    if (manifest.state === 'completed' && (manifest.outputs.length !== 1 || manifest.outputs.some((x: Output) => x.id !== '0' || x.mime_type !== (job.request.workflow === 'text-to-image' ? 'image/png' : 'video/mp4') || !Number.isSafeInteger(x.size) || x.size < 1 || x.size > 8 * 1024 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(x.sha256)))) throw new Error('Invalid image manifest');
    return manifest;
  }
  private async retrieve(job: Job, outputs: Output[], digest: string) {
    try {
      if (job.output_save_state !== 'saved') {
        job.state = 'copying'; job.output_save_state = 'saving'; job.error = null; this.save(job);
        for (const output of outputs) {
          const filename = job.id + '-' + output.id + (output.mime_type === 'video/mp4' ? '.mp4' : '.png');
          const destination = path.join(this.paths.data, 'media/outputs', filename);
          const temporary = path.join(this.paths.data, 'transfers', filename + '.part');
          if (!existsSync(destination) || statSync(destination).size !== output.size || await hashFile(destination) !== output.sha256) {
            let offset = existsSync(temporary) ? statSync(temporary).size : 0;
            if (offset > output.size) { unlinkSync(temporary); offset = 0; }
            if (offset < output.size) {
              const response = await this.worker.request(`/worker/v1/jobs/${job.id}/outputs/${output.id}`, { range: offset });
              if (!response.ok || !response.body) throw new Error('Output transfer interrupted.');
              if (offset && response.status === 200) offset = 0;
              else if (offset && (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${output.size - 1}/${output.size}`)) { await response.body.cancel(); throw new Error('Invalid resumed transfer.'); }
              const handle = await open(temporary, offset ? 'a' : 'w');
              try { for await (const chunk of response.body as any) { offset += chunk.length; if (offset > output.size) throw new Error('Unexpected image size'); await handle.writeFile(chunk); } await handle.sync(); }
              finally { await handle.close(); }
            }
            if (statSync(temporary).size !== output.size) throw new Error('Image transfer is incomplete.');
            if (await hashFile(temporary) !== output.sha256) { unlinkSync(temporary); throw new Error('Image integrity check failed; retrying transfer.'); }
            renameSync(temporary, destination);
          }
        }
        this.db.transaction(() => {
          for (const output of outputs) {
            const id = job.id + '-' + output.id;
            this.db.prepare('INSERT OR IGNORE INTO assets(id,kind,name,relative_path,metadata_json,created_at) VALUES (?,?,?,?,?,?)').run(id, output.mime_type === 'video/mp4' ? 'video' : 'image', (output.mime_type === 'video/mp4' ? 'Video · ' : 'Image · ') + job.request.mode.toUpperCase(), 'media/outputs/' + id + (output.mime_type === 'video/mp4' ? '.mp4' : '.png'), JSON.stringify({ job_id: job.id, mode: job.request.mode, mime_type:output.mime_type, sha256: output.sha256, size: output.size }), new Date().toISOString());
          }
          if (job.metrics && !job.metrics.saved_at) { job.metrics.saved_at = new Date().toISOString(); job.metrics.elapsed_to_saved_seconds = (Date.parse(job.metrics.saved_at) - Date.parse(job.created_at)) / 1000; }
          job.outputs = outputs.map(o => job.id + '-' + o.id); job.state = 'completed'; job.output_save_state = 'saved'; job.cleanup_state = 'pending'; job.error = null; this.save(job);
        })();
      }
      await this.acknowledgeOutputs(job, digest);
    } catch {
      if (job.output_save_state !== 'saved') { job.state = 'copy_pending'; job.error = 'Image transfer interrupted. The worker copy is retained; transfer will retry when connected.'; this.save(job); }
      // A lost acknowledgment never rolls back a durable local save.
    }
  }
  private async acknowledgeOutputs(job: Job, digest: string) {
    try {
      const receipt = await this.worker.json('/worker/v1/jobs/' + job.id + '/receipt', { method: 'POST', body: { manifest_digest: digest } });
      job.cleanup_state = receipt.cleanup_complete ? 'complete' : 'pending'; this.save(job);
    } catch { /* Terminal outcome remains durable; retry cleanup independently. */ }
  }
}
