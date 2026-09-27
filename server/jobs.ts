import { Media, type PreparedReference, probe } from "./media.js";
import { loraRoute, executionRoute, isVideoWorkflow, supportsWorkflow, QWEN_PROFILE, QWEN_SETTINGS } from "../shared/workflows.js";
import { workerClassFor } from "../shared/pool.js";
import { Loras, digest, sourceReady, type LoraSelection } from "./loras.js";
import { WorkerPool } from "./pool.js";
import type { RentalRecord, WorkerReceipt } from "./pool-contracts.js";
import { graphFor, type GraphLora } from "./worker-graphs.js";
import {
  WorkerHttpError,
  TransferIntegrityError,
  actionableTransfer,
} from "./worker-transfer.js";
import sharp from "sharp";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import type { StudioPaths } from "./storage.js";
import { imageRequest, seeds, type ImageRequest } from "./workflows.js";
type SubmissionMetadata = { route: string; loras: GraphLora[]; video_profile?: string };
export type Job = import("../shared/jobs.js").JobRecord & {
  worker?: {
    id?: string;
    loras: LoraSelection[];
    graph?: Record<string, unknown>;
    submission?: SubmissionMetadata;
    interruption?: 'engine_interrupted';
    submitted?: boolean;
    receipt?: WorkerReceipt;
    acknowledged?: boolean;
    quit_now?: boolean;
  };
  prepared?: PreparedReference[];
};
const terminal = ["completed", "failed", "cancelled"];
export class Jobs {
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private inFlight = new Map<string, { task: Promise<void>; recovery: boolean }>();
  public media: Media;
  public loras: Loras;
  constructor(
    private db: Database.Database,
    private paths: StudioPaths,
    readonly pool: WorkerPool,
  ) {
    this.media = new Media(db, paths);
    this.loras = new Loras(paths);
    pool.bindJobs({
      pending: (w) =>
        this.all().some(
          (j) =>
            j.state === "queued" &&
            j.worker &&
            workerClassFor(j.request.workflow) === w.worker_class &&
            (supportsWorkflow(w,j.request.workflow) || (!w.ready_at && !w.workflows)) &&
            (!w.finish_before || j.created_at <= w.finish_before) &&
            j.worker.loras.every((l) =>
              (w.adapters_frozen ? w.installed_loras : w.requested_loras).some(
                (i) => i.id === l.id && i.revision === l.revision,
              ),
            ),
        ),
      cancel: (id) => this.quitJobs(id),
      assigned: (id) => ({ unknown: this.get(id)?.state === 'needs_attention', recovering: this.inFlight.get(id)?.recovery ?? false }),
    });
    // Historical fal receipts remain readable; never submit them to a new executor.
    for (const job of this.all().filter(
      (j) => !j.worker && !terminal.includes(j.state),
    )) {
      job.state = "needs_attention";
      job.error =
        "This request belongs to the retired API provider. Its saved history has been preserved; create a new request to use a GPU worker.";
      this.save(job);
    }
  }
  serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => {});
    return next;
  }
  isInFlight(id: string) { return this.inFlight.has(id); }
  publicJob(job: Job): Job {
    const pending = this.inFlight.get(job.id)?.recovery ?? false;
    if (!job.worker || (job.state !== 'needs_attention' && !pending)) return job;
    const worker = job.worker.id ? this.pool.get(job.worker.id) : null;
    let reason: NonNullable<Job['recovery']>['reason'] = 'submission_unknown';
    if (this.cancelled(job.id) || job.worker.quit_now) reason = 'cancelled';
    else if (!worker || ['released', 'releasing', 'reconnecting', 'starting', 'preparing'].includes(worker.state) || worker.quit_mode === 'now' || worker.current_job_id !== job.id || !this.pool.dependencies.worker.probe) reason = 'worker_unavailable';
    else if (job.worker.interruption) reason = 'engine_interrupted';
    else {
      try { this.submission(job, worker); }
      catch { reason = 'submission_unavailable'; }
    }
    return { ...job, recovery: { pending, reason, worker_id: job.worker.id,
      ...(reason === 'submission_unknown' && !pending ? { action: 'retry' as const } : {}) } };
  }
  recover(id: string): Job {
    const job = this.get(id);
    if (!job) throw Error('Job not found.');
    const previous = this.inFlight.get(id);
    if (previous?.recovery || terminal.includes(job.state) || ['running', 'copying'].includes(job.state)) return this.publicJob(job);
    if (this.stopped || this.publicJob(job).recovery?.action !== 'retry')
      throw Error('This request cannot be retried safely. View its worker for recovery options.');
    this.track(id, async () => {
      await previous?.task;
      try { await this.recoverOriginal(id); }
      catch (error) {
        this.recoveryEvent(id, 'failed', error);
        const current = this.recoveryWorker(id);
        if (current) {
          if (current.job.worker?.receipt?.manifest?.state === 'completed') {
            current.job.recovery_blocked = actionableTransfer(error);
            current.job.error = 'The output is retained on the worker. Retry saving after checking local storage or reconnecting.';
          } else {
            current.job.state = 'needs_attention';
            current.job.error = 'The worker could not confirm recovery. The original request is still reserved; check its worker before trying again.';
          }
          this.save(current.job);
        }
      } finally {
        // A fast check can finish between polls; timestamp also retires client pending state.
        const current = this.get(id);
        if (current) this.save(current);
      }
    }, true);
    return this.publicJob(job);
  }
  private recoveryWorker(id: string) {
    const job = this.get(id), worker = job?.worker?.id ? this.pool.get(job.worker.id) : null;
    if (this.stopped || !job?.worker || !worker || terminal.includes(job.state) ||
      this.cancelled(id) || job.worker.quit_now || worker.quit_mode === 'now' ||
      ['released', 'releasing', 'reconnecting', 'starting', 'preparing'].includes(worker.state) || worker.current_job_id !== id) return null;
    return { job, worker };
  }
  private recoveryEvent(id: string, outcome: string, error?: unknown) {
    this.pool.diagnostics?.event({ category: 'job', operation: 'recovery', worker_id: this.get(id)?.worker?.id,
      level: error ? 'warn' : 'info', data: { job_id: id, outcome,
        ...(error ? { failure: error instanceof WorkerHttpError ? 'http' : error instanceof TransferIntegrityError ? 'integrity' : 'transport',
          ...(error instanceof WorkerHttpError ? { status: error.status } : {}) } : {}) } });
  }
  private async recoverOriginal(id: string) {
    let current = this.recoveryWorker(id);
    if (!current || current.job.state !== 'needs_attention') return;
    const driver = this.pool.dependencies.worker;
    this.recoveryEvent(id, 'checking');
    const probe = await driver.probe!(current.worker);
    current = this.recoveryWorker(id);
    if (!current) return;
    const receipt = await driver.receipt(current.worker, id);
    current = this.recoveryWorker(id);
    if (!current) return;
    if (receipt) {
      this.recoveryEvent(id, 'receipt_found');
      await this.advance(current.job, current.worker, receipt, probe.session_id);
      return;
    }
    if (probe.state !== 'ready' || probe.active_job_id || !probe.session_id) {
      current.job.error = 'The worker is not idle and ready. The original request is still reserved; view its worker before retrying.';
      this.save(current.job);
      this.recoveryEvent(id, 'worker_not_ready');
      return;
    }
    const body = this.submission(current.job, current.worker);
    // Persist only the previously missing envelope, never rebuild graph, inputs, or seeds.
    current.job.worker!.submission ??= { route: body.route, loras: body.loras,
      ...(body.video_profile ? { video_profile: body.video_profile } : {}) };
    current.job.submission_pending = true;
    this.save(current.job);
    current = this.recoveryWorker(id);
    if (!current) return;
    this.recoveryEvent(id, 'replaying_original');
    const workerId = current.worker.id;
    await driver.submit({ ...current.worker, session_id: probe.session_id }, body, { beforePost: () => {
      if (this.recoveryWorker(id)?.worker.id !== workerId)
        throw Error('Recovery was stopped before submission.');
    } });
    current = this.recoveryWorker(id);
    if (!current) return;
    current.job.worker!.submitted = true;
    current.job.submission_pending = false;
    current.job.error = null;
    this.save(current.job);
    await this.advance(current.job, current.worker);
  }
  private submission(job: Job, worker: RentalRecord) {
    if (!job.worker?.graph) throw Error('The original submission is unavailable.');
    let metadata = job.worker.submission;
    if (!metadata) {
      // Compatibility for known saved graphs from before envelope persistence. No catalog lookups.
      const route = executionRoute(job.request), graph = job.worker.graph as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
      const video = isVideoWorkflow(job.request.workflow), output = graph[video ? '14' : '9'];
      const model = route === 'image' ? 'krea2_turbo_int8_convrot.safetensors' : route === 'image-edit' ? 'qwen_image_2.1_int8_convrot.safetensors' : `minimax_h3_${route}2va_pruned_int8_convrot.safetensors`;
      if (graph['1']?.class_type !== 'UNETLoader' || graph['1']?.inputs?.unet_name !== model ||
        output?.class_type !== (video ? 'SeedVideoSave' : 'SaveImage') || output.inputs?.filename_prefix !== `seed/${job.id}/${video ? 'video' : 'image'}`)
        throw Error('The saved submission format is not supported.');
      const loras = this.selections(job, worker);
      if (Object.values(graph).filter(node => node.class_type === 'LoraLoaderModelOnly').length !== loras.length ||
        loras.some((lora, i) => graph[String(30 + i)]?.class_type !== 'LoraLoaderModelOnly' ||
          graph[String(30 + i)]?.inputs?.lora_name !== lora.filename || graph[String(30 + i)]?.inputs?.strength_model !== lora.strength_model))
        throw Error('The saved adapter mapping is unavailable.');
      metadata = { route, loras, ...(video ? { video_profile: 'h3-high-v1' } : {}) };
    }
    return { prompt_id: job.id, prompt: job.worker.graph, ...metadata };
  }
  usesAsset(id: string) {
    return this.all().some(job => (!terminal.includes(job.state) || this.isInFlight(job.id)) &&
      [...(job.request.references ?? []), ...(job.prepared ?? [])].some(ref => ref.asset_id === id));
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 1500);
    void this.tick();
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.chain;
    await Promise.allSettled([...this.inFlight.values()].map(entry => entry.task));
  }
  interrupt(id: string) {
    this.stopJobs([id]);
  }
  retrySave(id: string) {
    const job = this.get(id);
    if (!job?.recovery_blocked || !job.worker?.receipt)
      throw Error("This output does not need saving again.");
    job.recovery_blocked = false;
    job.error = null;
    this.save(job);
    return job;
  }
  continueRequest(id: string) {
    const job = this.get(id);
    if (!job || job.state !== "blocked")
      throw Error("This request is not waiting for action.");
    for (const item of this.all().filter(
      (j) => j.submission_id === job.submission_id && j.state === "blocked",
    )) {
      item.state = "queued";
      item.error = null;
      this.save(item);
    }
    return {
      jobs: this.all().filter((j) => j.submission_id === job.submission_id),
    };
  }
  list(limit = 50, cursor = ""): Job[] {
    return (
      this.db
        .prepare(
          "SELECT snapshot_json FROM jobs WHERE (? = '' OR (created_at,id) < (SELECT created_at,id FROM jobs WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?",
        )
        .all(cursor, cursor, limit) as { snapshot_json: string }[]
    ).map((r) => JSON.parse(r.snapshot_json));
  }
  all(): Job[] {
    return (
      this.db
        .prepare(
          "SELECT snapshot_json FROM jobs ORDER BY created_at, submission_index",
        )
        .all() as { snapshot_json: string }[]
    ).map((r) => JSON.parse(r.snapshot_json));
  }
  get(id: string): Job | null {
    const row = this.db
      .prepare("SELECT snapshot_json FROM jobs WHERE id = ?")
      .get(id) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) : null;
  }
  save(job: Job) {
    const latest = this.get(job.id);
    if (latest?.worker?.quit_now) {
      job.state = "cancelled";
      if (job.worker) job.worker.quit_now = true;
    }
    if (this.cancelled(job.id)) {
      if (["queued", "blocked"].includes(job.state)) {
        job.state = "cancelled";
      } else if (["uploading", "submitting", "running", "needs_attention"].includes(job.state))
        job.state = "cancel_requested";
    }
    if (
      job.metrics &&
      terminal.includes(job.state) &&
      !job.metrics.terminal_at
    ) {
      job.metrics.terminal_at = new Date().toISOString();
      job.metrics.elapsed_to_terminal_seconds =
        (Date.parse(job.metrics.terminal_at) - Date.parse(job.created_at)) /
        1000;
    }
    delete job.recovery; // Recovery activity belongs to the current process, never restart intent.
    job.updated_at = new Date(Math.max(Date.now(), Date.parse(latest?.updated_at ?? '') + 1 || 0)).toISOString();
    if(latest?.state!==job.state||latest?.error!==job.error) this.pool.diagnostics?.event({
      category:'job',operation:'state_changed',worker_id:job.worker?.id,level:job.error?'warn':'info',
      data:{job_id:job.id,workflow:job.request.workflow,state:job.state,error:job.error,metrics:job.metrics,outputs:job.outputs}
    });
    this.db
      .prepare(
        "UPDATE jobs SET state=?, snapshot_json=?, updated_at=? WHERE id=?",
      )
      .run(job.state, JSON.stringify(job), job.updated_at, job.id);
  }
  async submit(raw: unknown, key: string) {
    const prepared = await this.prepareSubmission(raw, key);
    const result = this.db.transaction(prepared.commit)();
    return result;
  }
  async prepareSubmission(raw: unknown, key: string, source?: Job["source"]) {
    const request = imageRequest(raw);
    if (!/^[\w-]{16,128}$/.test(key))
      throw new Error("A submission key is required.");
    const body = JSON.stringify(request);
    const previous = this.db
      .prepare("SELECT id,body_json FROM submissions WHERE idempotency_key=?")
      .get(key) as { id: string; body_json: string } | undefined;
    if (previous) {
      if (previous.body_json !== body)
        throw new Error("This submission key belongs to different settings.");
      return {
        commit: () => ({
          submission_id: previous.id,
          jobs: this.all().filter((j) => j.submission_id === previous.id),
        }),
      };
    }
    const selected = request.workflow==='image-to-image' ? [] : this.loras.resolve(
      request.loras,
      loraRoute(request),
      request.mode,
    );
    if (selected.some((l) => !sourceReady(l.source)))
      throw Error(
        "Reimport this LoRA in Admin so new workers can download its pinned source.",
      );
    const prepared: PreparedReference[] = [];
    for (const ref of request.references ?? []) {
      const asset=this.media.get(ref.asset_id);
      if(!asset || (request.mode==='sfw' && asset.metadata.mode==='nsfw')) throw Error('This input is unavailable. Choose another image.');
      prepared.push(
        await this.media.prepare(
          ref,
          request.output.aspect,
          request.output.duration_seconds!,
        ),
      );
    }
    const submission_id = randomUUID(),
      now = new Date().toISOString();
    const jobs = seeds(request).map((seed, index): Job => {
      const id = randomUUID();
      return {
        source,
        input_snapshot: (request.references ?? []).map((ref) => {
          const asset = this.media.get(ref.asset_id)!;
          const note = this.db
            .prepare("SELECT note FROM asset_notes WHERE id=?")
            .get(ref.asset_id) as { note: string } | undefined;
          return {
            id: ref.asset_id,
            name: asset.name,
            kind: asset.kind,
            note: note?.note ?? "",
            metadata: asset.metadata,
          };
        }),
        metrics: {
          inputs: {
            total: prepared.length,
            image: prepared.filter((r) => r.kind === "image").length,
            video: prepared.filter((r) => r.kind === "video").length,
            audio: prepared.filter((r) => r.kind === "audio").length,
            video_soundtracks: prepared.filter((r) => r.audio_file).length,
            prepared_bytes: prepared.reduce(
              (n, r) =>
                n +
                statSync(r.file).size +
                (r.audio_file ? statSync(r.audio_file).size : 0),
              0,
            ),
          },
        },
        id,
        state: "queued",
        submission_id,
        submission_index: index,
        request,
        seed,
        worker: {
          loras: selected.map(({ id, revision, scale }) => ({
            id,
            revision,
            scale,
          })),
        },
        ...(prepared.length ? { prepared } : {}),
        outputs: [],
        error: null,
        created_at: now,
        updated_at: now,
      };
    });
    return {
      commit: () => {
        this.db
          .prepare("INSERT INTO submissions VALUES (?,?,?)")
          .run(submission_id, key, body);
        const insert = this.db.prepare(
          "INSERT INTO jobs(id,workflow,state,snapshot_json,created_at,updated_at,submission_id,submission_index) VALUES (?,?,?,?,?,?,?,?)",
        );
        for (const job of jobs)
          insert.run(
            job.id,
            request.workflow,
            job.state,
            JSON.stringify(job),
            now,
            now,
            submission_id,
            job.submission_index,
          );
        return { submission_id, jobs };
      },
    };
  }
  private cancelled(id: string) {
    return Boolean(
      this.db.prepare("SELECT id FROM job_cancel_intents WHERE id=?").get(id),
    );
  }
  stopJobs(ids: string[]) {
    this.db.transaction(() => {
      for (const id of ids) {
        const job = this.get(id);
        if (!job || terminal.includes(job.state)) continue;
        this.db
          .prepare("INSERT OR IGNORE INTO job_cancel_intents VALUES (?)")
          .run(id);
        job.state = ["queued", "blocked"].includes(job.state)
          ? "cancelled"
          : "cancel_requested";
        job.recovery_blocked = false;
        this.save(job);
      }
    })();
  }
  async cancel(id: string) {
    if (!this.get(id)) throw Error("Job not found.");
    this.stopJobs([id]);
    void this.tick();
    return this.get(id)!;
  }
  private quitJobs(workerId?: string) {
    for (const job of this.all().filter(
      (j) =>
        !terminal.includes(j.state) && (!workerId || j.worker?.id === workerId),
    )) {
      if (job.worker) job.worker.quit_now = true;
      job.state = "cancelled";
      job.error =
        "Cancelled when the worker was terminated. Unsaved output may be unavailable.";
      this.save(job);
      this.pool.complete(job.id);
    }
  }
  acknowledge(id: string) {
    const job = this.get(id);
    if (!job || job.state !== "needs_attention")
      throw Error("Only a request needing attention can be acknowledged.");
    job.uncertainty_acknowledged = true;
    this.save(job);
    return job;
  }
  async tick() {
    if (this.stopped) return;
    await this.reconcile(true);
  }
  async reconcile(background = false) {
    for (const job of this.all()) {
      if (
        !job.worker ||
        this.inFlight.has(job.id) ||
        job.recovery_blocked ||
        job.worker.quit_now
      )
        continue;
      if (
        terminal.includes(job.state) &&
        (!job.worker.receipt || job.worker.acknowledged)
      )
        continue;
      if (job.state === "queued") {
        const w =
          this.pool.assigned(job.id) ??
          this.pool.claim(
            job.id,
            workerClassFor(job.request.workflow),
            job.worker.loras,
            job.created_at,
            job.request.workflow,
          );
        if (!w) {
          job.waiting_reason = job.worker.loras.length
            ? "Waiting for a ready worker with the selected LoRAs. Start a new worker to include recently added adapters."
            : job.request.workflow==='image-to-image' ? 'Waiting for an Image worker with image editing support. Start a new Image worker if your current worker uses an older image.' : `Waiting for a ready ${workerClassFor(job.request.workflow)} worker.`;
          this.save(job);
          continue;
        }
        job.worker.id = w.id;
        job.state = "uploading";
        delete job.waiting_reason;
        this.save(job);
      }
      const worker = job.worker.id ? this.pool.get(job.worker.id) : null;
      if (!worker) {
        if (job.state !== "queued") {
          job.state = "needs_attention";
          job.error =
            "The assigned worker record is missing. This request will not be submitted again automatically.";
          this.save(job);
        }
        continue;
      }
      if (worker.state === "released") {
        if (terminal.includes(job.state)) {
          this.pool.complete(job.id);
          continue;
        }
        job.state = "failed";
        job.error =
          "The worker rental ended before this output was saved. Submit a new request to try again.";
        this.save(job);
        this.pool.complete(job.id);
        continue;
      }
      if (
        ["releasing", "reconnecting", "starting", "preparing"].includes(
          worker.state,
        )
      )
        continue;
      const task = this.track(job.id, async () => {
        try {
          if (
            job.state === "uploading" &&
            !job.worker!.submitted &&
            !job.submission_pending
          )
            await this.dispatch(job, worker);
          else await this.advance(job, worker);
        } catch (error) {
          this.pool.diagnostics?.error('job.execute',error,{worker_id:worker.id,job_id:job.id});
          if (this.stopped) return;
          if (job.worker?.receipt?.manifest && this.finishCancellation(job)) return;
          if (job.worker?.receipt?.manifest?.state === "completed") {
            job.recovery_blocked = actionableTransfer(error);
            job.error =
              "The output is retained on the worker. Retry saving after checking local storage or reconnecting.";
          } else if (job.submission_pending) {
            job.state = "needs_attention";
            job.error =
              "The worker has not confirmed this submission. Seed will check its receipt without generating it twice.";
          } else {
            job.error =
              "Cannot reach the assigned worker. Reconnect it or quit the rental; no replacement worker will be rented automatically.";
          }
          this.save(job);
        }
      });
      if (!background) await task;
    }
    if (!background) await Promise.allSettled([...this.inFlight.values()].map(entry => entry.task));
  }
  private track(id: string, action: () => Promise<void>, recovery = false) {
    // Reserve before action's first await; an older task cannot delete its successor.
    const task = Promise.resolve().then(action)
      .catch((error) => {this.pool.diagnostics?.error('job.background',error,{worker_id:this.get(id)?.worker?.id});})
      .finally(() => { if (this.inFlight.get(id)?.task === task) this.inFlight.delete(id); });
    this.inFlight.set(id, { task, recovery });
    return task;
  }
  private selections(job: Job, w: RentalRecord): GraphLora[] {
    return job.worker!.loras.map((l) => {
      const installed = w.installed_loras.find(
        (i) =>
          i.id === l.id &&
          i.revision === l.revision &&
          i.route === loraRoute(job.request),
      );
      if (!installed)
        throw Error("The assigned worker is missing a selected adapter.");
      return {
        filename: installed.filename,
        sha256: installed.sha256,
        strength_model: l.scale,
      };
    });
  }
  private async dispatch(job: Job, w: RentalRecord) {
    const driver = this.pool.dependencies.worker;
    if (this.cancelled(job.id)) {
      job.state = "cancelled";
      this.save(job);
      this.pool.complete(job.id);
      return;
    }
    for (const ref of job.prepared ?? []) {
      await driver.upload(w, job.id, ref.file, ref.filename);
      if (ref.audio_file)
        await driver.upload(w, job.id, ref.audio_file, ref.audio_filename!);
    }
    if (this.stopped || this.get(job.id)?.worker?.quit_now) return;
    if (this.cancelled(job.id)) {
      job.state = "cancelled";
      this.save(job);
      this.pool.complete(job.id);
      return;
    }
    const loras = this.selections(job, w);
    job.worker!.graph = graphFor(
      job.request,
      job.id,
      job.seed,
      loras,
      job.prepared ?? [],
    );
    job.worker!.submission = { route: executionRoute(job.request), loras,
      ...(isVideoWorkflow(job.request.workflow) ? { video_profile: 'h3-high-v1' } : {}) };
    job.state = "submitting";
    job.submission_pending = true;
    job.metrics!.submitted_at = new Date().toISOString();
    this.save(job);
    try {
      await driver.submit(w, {
        prompt_id: job.id,
        prompt: job.worker!.graph,
        ...job.worker!.submission,
      });
    } catch (error) {
      if (
        error instanceof WorkerHttpError &&
        [400, 401, 403, 409, 422].includes(error.status)
      ) {
        // A rejection is safe only after the durable receipt lookup confirms absence.
        const receipt = await driver.receipt(w, job.id);
        if (!receipt) {
          job.submission_pending = false;
          job.state = "failed";
          job.error =
            "The worker rejected these settings before generation. Review the request and worker version.";
          this.save(job);
          this.pool.complete(job.id);
          return;
        }
      }
      throw error;
    }
    job.worker!.submitted = true;
    job.submission_pending = false;
    job.state = "running";
    this.save(job);
    await this.advance(job, w);
  }
  private async advance(job: Job, w: RentalRecord, found?: WorkerReceipt, engineSession?: string | null) {
    const driver = this.pool.dependencies.worker;
    if (job.worker?.quit_now || this.get(job.id)?.worker?.quit_now) return;
    if (this.cancelled(job.id) && !terminal.includes(job.state))
      await driver.cancel(w, job.id);
    const record = found ?? job.worker!.receipt ?? (await driver.receipt(w, job.id));
    if (!record) {
      job.state = "needs_attention";
      job.error =
        "The worker has no receipt for this request. Retry checks the worker and safely resubmits the original request if needed.";
      this.save(job);
      return;
    }
    job.worker!.submitted = true;
    job.submission_pending = false;
    if (!record.manifest) {
      // A recorded acceptance from a dead engine is not an executing request.
      // Never infer a crash merely from an idle observation of the same engine.
      if (record.submission?.engine_session_id && driver.probe && engineSession === undefined)
        engineSession = (await driver.probe(w)).session_id;
      if (record.submission?.engine_session_id && engineSession === null && !job.worker!.interruption) {
        job.state = 'needs_attention';
        job.error = 'The worker has a receipt, but its engine is not ready. View the worker while Seed continues checking for a result.';
        this.save(job);
        return;
      }
      if (job.worker!.interruption || (engineSession && record.submission?.engine_session_id && engineSession !== record.submission.engine_session_id)) {
        job.worker!.interruption = 'engine_interrupted';
        job.state = 'needs_attention';
        job.error = 'The worker restarted after accepting this request, before saving a result. Automatic replay is unsafe; view the worker to reconnect or quit.';
        this.save(job);
        return;
      }
      job.state = this.cancelled(job.id) ? "cancel_requested" : "running";
      job.activity = job.request.workflow==='image-to-image' ? w.current_activity?.replace('Loading image models','Loading image editor').replace('Generating','Editing') : undefined;
      job.error = null;
      this.save(job);
      return;
    }
    delete job.worker!.interruption;
    job.worker!.receipt = record;
    if (this.finishCancellation(job)) {
      // The remote terminal receipt still needs acknowledgement below. Do not
      // publish an output after the app has accepted cancellation.
    } else if (record.manifest.state === "completed") {
      if (!job.outputs.length) await this.retrieve(job, w, record);
    } else {
      job.state = record.manifest.state;
      if(record.manifest.state==='failed') {
        this.pool.diagnostics?.event({category:'worker',operation:'generation.failed',worker_id:w.id,level:'error',data:{job_id:job.id,error:record.manifest.error}});
      }
      job.error =
        record.manifest.state === "failed"
          ? "The worker could not generate this output. Review the request or reconnect the worker."
          : null;
      this.save(job);
    }
    if (this.get(job.id)?.worker?.quit_now) return;
    this.finishCancellation(job);
    await driver.acknowledge(w, job.id, record.manifest_digest!);
    job.worker!.acknowledged = true;
    this.save(job);
    this.pool.complete(job.id);
  }
  private finishCancellation(job: Job) {
    if (!this.cancelled(job.id) || job.outputs.length) return false;
    job.state = "cancelled";
    job.error = null;
    job.recovery_blocked = false;
    const file = path.join(this.paths.data, "media/outputs", job.id + "-0" +
      (isVideoWorkflow(job.request.workflow) ? ".mp4" : ".png"));
    for (const target of [file, file + ".part"]) {
      try { rmSync(target, { force: true }); }
      catch (error) { this.pool.diagnostics?.error('job.cancel_cleanup', error, { job_id: job.id, worker_id: job.worker?.id }); }
    }
    this.save(job);
    return true;
  }
  private async retrieve(job: Job, w: RentalRecord, record: WorkerReceipt) {
    const image = !isVideoWorkflow(job.request.workflow),
      outputs = record.manifest!.outputs;
    if (
      outputs.length !== 1 ||
      outputs[0]!.id !== "0" ||
      outputs[0]!.mime_type !== (image ? "image/png" : "video/mp4") ||
      !record.manifest_digest
    )
      throw new TransferIntegrityError("Unexpected worker output.");
    const output = outputs[0]!,
      id = job.id + "-0",
      file = path.join(
        this.paths.data,
        "media/outputs",
        id + (image ? ".png" : ".mp4"),
      );
    job.state = "copying";
    this.save(job);
    this.pool.saving(job.id);
    if (
      !existsSync(file) ||
      statSync(file).size !== output.size ||
      (await digest(file)) !== output.sha256
    )
      await this.pool.dependencies.worker.download(w, job.id, output, file);
    if (this.finishCancellation(job)) return;
    if (
      statSync(file).size !== output.size ||
      (await digest(file)) !== output.sha256
    )
      throw new TransferIntegrityError("Saved output checksum failed.");
    let metadata: Record<string, unknown>;
    if (image) {
      const m = await sharp(file).metadata();
      if (!m.width || !m.height || m.format !== "png")
        throw new TransferIntegrityError("Invalid image output.");
      await sharp(file).stats();
      metadata = { width: m.width, height: m.height };
    } else {
      const m = await probe(file);
      if (!m.has_video || !m.duration)
        throw new TransferIntegrityError("Invalid video output.");
      metadata = m;
    }
    if (this.get(job.id)?.worker?.quit_now) return;
    if (this.finishCancellation(job)) return;
    Object.assign(metadata, {
      ...(job.request.workflow==='image-to-image'?{runtime_profile:QWEN_PROFILE,runtime_settings:QWEN_SETTINGS,source_asset_id:job.request.references?.find(r=>r.role==='source')?.asset_id,input_asset_ids:job.request.references?.map(r=>r.asset_id),resolved_width:job.prepared?.[0]?.width,resolved_height:job.prepared?.[0]?.height}:{}),
      job_id: job.id,
      mode: job.request.mode,
      mime_type: output.mime_type,
      size: output.size,
      sha256: output.sha256,
      worker_id: w.id,
    });
    this.db.transaction(() => {
      this.db
        .prepare("INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?,?)")
        .run(
          id,
          image ? "image" : "video",
          image ? "Generated image" : "Generated video",
          path.relative(this.paths.data, file).split(path.sep).join("/"),
          JSON.stringify(metadata),
          job.created_at,
        );
      if (job.request.note)
        this.db
          .prepare("INSERT OR IGNORE INTO asset_notes VALUES (?,?,0)")
          .run(id, job.request.note);
      job.outputs = [id];
      job.state = "completed";
      job.error = null;
      job.recovery_blocked = false;
      job.metrics!.saved_at = new Date().toISOString();
      job.metrics!.elapsed_to_saved_seconds =
        (Date.now() - Date.parse(job.created_at)) / 1000;
      this.save(job);
    })();
    try {
      this.loras.markVerified(
        job.worker!.loras,
        job.id,
        "worker:" + w.worker_class,
      );
    } catch {
      /* Compatibility bookkeeping cannot invalidate a saved result. */
    }
  }
}
