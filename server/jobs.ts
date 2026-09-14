import { Media, type PreparedReference } from "./media.js";
import { videoRoute, HIGH_VIDEO_PROFILE, VIDEO_PROFILE_REVISION } from "./video.js";
import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import type { StudioPaths } from "./storage.js";
import { WorkerConnection } from "./worker.js";
import { WorkerHttpError, TransferIntegrityError, actionableTransfer } from './worker-transfer.js';
import {
  graphFor,
  imageRequest,
  seeds,
  type Capabilities,
  type ImageRequest,
  type Preset,
} from "./workflows.js";

export type Job = {
  source?: {chat_id?:string;card_id?:string;revision?:number;job_id?:string};
  input_snapshot?: Array<{id:string;name:string;kind:string;note:string;metadata:Record<string,unknown>}>;
  workflow_version?: string;
  deleted_outputs?: string[];
  metrics?: {
    version: 1;
    inputs: {
      total: number;
      image: number;
      video: number;
      audio: number;
      prepared_bytes: number;
      video_soundtracks: number;
    };
    transfer_started_at?: string;
    submitted_at?: string;
    saved_at?: string;
    terminal_at?: string;
    elapsed_to_terminal_seconds?: number;
    elapsed_to_saved_seconds?: number;
    worker?: Record<string, unknown>;
  };
  generation_percent?: number;
  prepared?: PreparedReference[];
  id: string;
  state: string;
  submission_id: string;
  submission_index: number;
  request: ImageRequest;
  seed: string;
  preset: Preset | null;
  video_profile?: typeof HIGH_VIDEO_PROFILE;
  graph: ReturnType<typeof graphFor>;
  workspace_id: string;
  engine_session_id?: string;
  outputs: string[];
  error: string | null;
  cleanup_state: string;
  output_save_state: string;
  created_at: string;
  updated_at: string;
  uncertainty_acknowledged?: boolean;
  submission_pending?: boolean;
  recovery_blocked?: boolean;
  integrity_failures?: number;
};
type Output = {
  id: string;
  path: string;
  size: number;
  sha256: string;
  mime_type: string;
};
const terminal = ["completed", "failed", "cancelled"];
const hashFile = async (file: string) => {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
};

export class Jobs {
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;
  private transfer?: {id: string; abort: AbortController};
  private attempts = new Map<string, number>();
  public capabilities: Capabilities | null = null;
  public checkedAt: number | null = null;
  public safe: boolean | null = null;
  public reason = "Checking the engine and saved outputs.";
  public media: Media;
  constructor(
    private db: Database.Database,
    private paths: StudioPaths,
    private worker: WorkerConnection,
  ) {
    this.media = new Media(db, paths);
  }
  serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => {});
    return next;
  }
  start() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 2000);
    void this.tick();
  }
  async close() {
    this.stopped = true;
    this.transfer?.abort.abort();
    clearInterval(this.timer);
    await this.chain;
  }
  interrupt(id: string) { if (this.transfer?.id === id) this.transfer.abort.abort(); }
  resumeRecovery() {
    for (const job of this.all()) if (job.recovery_blocked) {
      job.recovery_blocked = false; job.integrity_failures = 0; this.save(job);
    }
  }
  private blockRecovery(job: Job, error: unknown) {
    job.recovery_blocked = true;
    job.error = `${error instanceof Error ? error.message : 'Transfer failed.'} Files are retained. Fix the problem, then resume the queue.`;
    this.pause(true); this.save(job);
  }
  private attempt(job: Job, operation: string, offset = 0) {
    const key = job.id + ':' + operation;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    console.info(JSON.stringify({at: new Date().toISOString(), job_id: job.id, operation, attempt, offset}));
  }
  invalidate() {
    this.safe = null;
    this.checkedAt = null;
    this.capabilities = null;
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
    if(this.cancelled(job.id)) {
      if(job.state==='queued'){job.state='cancelled';job.output_save_state='not_applicable';}
      else if(['submitting','running'].includes(job.state))job.state='cancel_requested';
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
    job.updated_at = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE jobs SET state=?, snapshot_json=?, updated_at=? WHERE id=?",
      )
      .run(job.state, JSON.stringify(job), job.updated_at, job.id);
  }
  get paused() {
    return Boolean(
      (
        this.db
          .prepare("SELECT paused FROM dispatcher_state WHERE id=1")
          .get() as { paused: number }
      ).paused,
    );
  }
  pause(value: boolean) {
    this.db
      .prepare("UPDATE dispatcher_state SET paused=? WHERE id=1")
      .run(value ? 1 : 0);
    this.safe = null;
    this.checkedAt = null;
  }
  async submit(raw: unknown, key: string) {
    const prepared = await this.prepareSubmission(raw, key);
    const result = this.db.transaction(prepared.commit)();
    this.pause(false);
    return result;
  }
  async prepareSubmission(raw: unknown, key: string, source?:Job['source']) {
    if (this.all().some(job => job.recovery_blocked))
      throw new Error('Fix the reported transfer problem and resume the queue before creating another job.');
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
      return {commit: () => ({
        submission_id: previous.id,
        jobs: this.all().filter((j) => j.submission_id === previous.id),
      })};
    }
    const cap = await this.inspectCapabilities();
    if (request.capabilities_revision !== cap.revision)
      throw new Error("Pod settings changed. Refresh and try again.");
    if (
      this.all().some(
        (j) => j.state === "needs_attention" && !j.uncertainty_acknowledged,
      )
    )
      throw new Error(
        "Resolve the previous interrupted job before generating.",
      );
    const isVideo = request.workflow !== "text-to-image";
    if (isVideo && request.output.size === 'native' && cap.video?.native_export !== true)
      throw new Error('Update the worker to preserve native video output.');
    if (isVideo && request.quality === 'high' && (cap.video?.quality?.high !== true || cap.video.profile_revision !== VIDEO_PROFILE_REVISION))
      throw new Error('Update the worker to use High Quality.');
    if (isVideo && request.quality !== 'high' && cap.video?.quality?.fast === false)
      throw new Error('Fast video is not available on this worker.');
    if (isVideo && request.output.format === 'images' && !cap.video?.image_export)
      throw new Error('Update the worker to export images.');
    if (isVideo && ![5,10,15].includes(request.output.duration_seconds!) && cap.video?.duration_step !== 1)
      throw new Error('Update the worker to use this duration.');
    if (isVideo && !cap.video?.ready)
      throw new Error("This worker does not support video yet.");
    const selectedPreset =
      request.mode === "nsfw"
        ? isVideo
          ? cap.video?.nsfw[videoRoute(request)]
          : cap.nsfw
        : null;
    if (request.mode === "nsfw" && !selectedPreset)
      throw new Error(
        "The selected mode is not available for these references.",
      );
    const prepared: PreparedReference[] = [];
    for (const ref of request.references ?? [])
      prepared.push(
        await this.media.prepare(
          ref,
          request.output.aspect,
          request.output.duration_seconds!,
        ),
      );
    const submission_id = randomUUID(),
      now = new Date().toISOString();
    const jobs = seeds(request).map((seed, index): Job => {
      const id = randomUUID(),
        preset = selectedPreset ?? null;
      return {
        source,
        workflow_version: isVideo ? VIDEO_PROFILE_REVISION : 'image-v1',
        input_snapshot: (request.references??[]).map(ref=>{const asset=this.media.get(ref.asset_id)!;const note=this.db.prepare('SELECT note FROM asset_notes WHERE id=?').get(ref.asset_id) as {note:string}|undefined;return {id:ref.asset_id,name:asset.name,kind:asset.kind,note:note?.note??'',metadata:asset.metadata};}),
        metrics: {
          version: 1,
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
        preset,
        ...(isVideo && request.quality === 'high' ? {video_profile: HIGH_VIDEO_PROFILE} : {}),
        graph: graphFor(request, id, seed, preset, prepared),
        ...(prepared.length ? { prepared } : {}),
        workspace_id: cap.workspace_id,
        outputs: [],
        error: null,
        cleanup_state: "not_requested",
        output_save_state: "pending",
        created_at: now,
        updated_at: now,
      };
    });
    return {commit: () => {
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
    }};
  }
  async inspectCapabilities(requireReady = true) {
    const cap = (await this.worker.json("/comfy/capabilities")) as Capabilities;
    if (
      typeof cap.ready !== 'boolean' || (requireReady && !cap.ready) ||
      cap.workspace_id !== this.worker.identity?.workspace_id ||
      typeof cap.engine_session_id !== "string" ||
      typeof cap.revision !== "string"
    )
      throw new Error("The image engine is not ready.");
    if (
      cap.nsfw &&
      (!/^[\w.-]+\.safetensors$/.test(cap.nsfw.filename) ||
        !/^[a-f0-9]{64}$/i.test(cap.nsfw.sha256) ||
        !Number.isFinite(cap.nsfw.strength_model) ||
        cap.nsfw.strength_model < 0 ||
        cap.nsfw.strength_model > 2)
    )
      throw new Error("The pod has an invalid LoRA preset.");
    this.capabilities = cap;
    return cap;
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (!job) throw new Error("Job not found.");
    if (terminal.includes(job.state)) return job;
    if (job.state === "queued") {
      job.state = "cancelled";
      job.output_save_state = "not_applicable";
    } else if (job.state === "needs_attention")
      throw new Error(
        "The previous execution is uncertain. Reconnect the original worker if it still exists to recover it.",
      );
    else job.state = "cancel_requested";
    this.safe = null;
    this.save(job);
    return job;
  }
  /** Durable user intent is independent of remote job state and recovery. */
  stopJobs(ids: string[]) {
    this.db.transaction(()=>{
      for(const id of ids) {
        const job=this.get(id);if(!job||terminal.includes(job.state))continue;
        this.db.prepare('INSERT OR IGNORE INTO job_cancel_intents(id) VALUES (?)').run(id);
        if(this.transfer?.id===id)this.transfer.abort.abort();
        if(job.state==='queued'){job.state='cancelled';job.output_save_state='not_applicable';}
        else if(job.state!=='needs_attention')job.state='cancel_requested';
        this.save(job);
      }
    })();
  }
  private cancelled(id:string) {return Boolean(this.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(id));}
  acknowledge(id: string) {
    const job = this.get(id);
    if (!job || job.state !== "needs_attention")
      throw new Error("Only an uncertain job can be acknowledged.");
    job.uncertainty_acknowledged = true;
    this.save(job);
    this.safe = null;
    return job;
  }
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.serialize(() => this.reconcile());
    } catch (error) {
      this.invalidate();
      this.reason =
        actionableTransfer(error)
          ? `${(error as Error).message} Check the connection before resuming. Pending files are retained.`
          : "Cannot verify the pod. Pending work and files are retained.";
      if (actionableTransfer(error)) this.pause(true);
    } finally {
      this.ticking = false;
    }
  }
  async reconcile() {
    if (!this.worker.connected) {
      this.invalidate();
      this.reason = "No pod connected.";
      return;
    }
    this.safe = null;
    const cap = await this.inspectCapabilities(false);
    const queue = await this.worker.json("/comfy/queue");
    if (
      !Array.isArray(queue.queue_running) ||
      !Array.isArray(queue.queue_pending)
    )
      throw new Error("Unknown queue");
    const session = await this.worker.json("/comfy/session");
    if (
      session.engine_session_id !== cap.engine_session_id ||
      session.workspace_id !== cap.workspace_id
    )
      throw new Error("Engine changed");
    const nativeIds = [...queue.queue_running, ...queue.queue_pending].map(
      (item: unknown[]) => item[1],
    );
    const jobs = this.all();
    const foreign = nativeIds.some(
      (id: unknown) =>
        !jobs.some(
          (j) => j.id === id && j.engine_session_id === cap.engine_session_id,
        ),
    );
    let cursor: string | null = "",
      orphan = false;
    const seen = new Set<string>();
    do {
      const inventory = await this.worker.json(
        "/worker/v1/jobs" +
          (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (!Array.isArray(inventory.items))
        throw new Error("Invalid spool inventory");
      for (const item of inventory.items)
        if (
          !jobs.some((j) => j.id === item.job_id) &&
          !item.acknowledged &&
          (!item.manifest || item.manifest.state === "completed")
        )
          orphan = true;
      cursor = inventory.next_cursor;
      if (cursor) {
        if (typeof cursor !== "string" || seen.has(cursor))
          throw new Error("Invalid inventory cursor");
        seen.add(cursor);
      }
    } while (cursor);
    for (const job of jobs) {
      if (
        job.recovery_blocked || job.state === "queued" ||
        (terminal.includes(job.state) && job.cleanup_state !== "pending")
      )
        continue;
      if (job.workspace_id !== cap.workspace_id) {
        if (!terminal.includes(job.state)) {
          job.state = "needs_attention";
          job.error =
            "Reconnect the original worker if it still exists to recover this job.";
          this.save(job);
        }
        continue;
      }
      const response = await this.worker.request("/worker/v1/jobs/" + job.id);
      if (response.status === 404) {
        await response.body?.cancel();
        if (job.submission_pending && job.state !== 'cancel_requested' && !this.cancelled(job.id) &&
            job.engine_session_id === cap.engine_session_id && !this.paused &&
            !foreign && !orphan && nativeIds.length === 0) {
          await this.dispatch(job, cap.engine_session_id);
          return;
        }
        if (!terminal.includes(job.state)) {
          job.state = "needs_attention";
          job.error =
            "Submission outcome is unknown; it will not be run again automatically.";
          this.save(job);
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Cannot reconcile output");
      }
      // Use bounded JSON decoding for manifest inventory too.
      await response.body?.cancel();
      const record = await this.worker.json("/worker/v1/jobs/" + job.id);
      if (
        record.submission.job_id !== job.id ||
        record.submission.workspace_id !== job.workspace_id ||
        record.submission.engine_session_id !== job.engine_session_id
      )
        throw new Error("Job identity mismatch");
      job.submission_pending = false;
      if (
        job.metrics &&
        [1, 2].includes(record.telemetry?.version) &&
        typeof record.telemetry === "object"
      ) {
        job.metrics.worker = record.telemetry;
        this.save(job);
      }
      if (record.manifest) {
        const manifest = this.manifest(job, record);
        if (manifest.state === "completed") {
          await this.retrieve(job, manifest.outputs, record.manifest_digest);
        } else {
          job.state = manifest.state === "cancelled" ? "cancelled" : "failed";
          job.error = manifest.error;
          job.output_save_state = "not_applicable";
          job.cleanup_state = "pending";
          this.save(job);
          await this.acknowledgeOutputs(job, record.manifest_digest);
        }
      } else if (
        job.engine_session_id !== cap.engine_session_id ||
        !nativeIds.includes(job.id)
      ) {
        job.state = "needs_attention";
        job.error =
          "Generation was interrupted or its outcome is uncertain. No automatic rerun.";
        this.save(job);
      } else if (job.state === "cancel_requested" || this.cancelled(job.id)) {
        if (!foreign)
          await this.worker.json("/comfy/cancel", {
            method: "POST",
            body: { job_id: job.id },
            session: job.engine_session_id,
          });
      } else {
        job.state = "running";
        const progress = session.sampling_progress;
        const sampler = job.request.workflow.endsWith("video") ? "11" : "7";
        job.generation_percent =
          progress?.prompt_id === job.id &&
          progress.node === sampler &&
          Number.isInteger(progress.percent) &&
          progress.percent >= 0 &&
          progress.percent <= 100
            ? progress.percent
            : undefined;
        this.save(job);
      }
    }
    const current = this.all();
    const unresolved = current.some(
      (j) =>
        !terminal.includes(j.state) &&
        j.state !== "queued" &&
        !(j.state === "needs_attention" && j.uncertainty_acknowledged),
    );
    if (
      cap.ready &&
      !this.paused &&
      !foreign &&
      !orphan &&
      !unresolved &&
      nativeIds.length === 0
    ) {
      const next = current.find((j) => j.state === "queued" && !j.recovery_blocked && !this.cancelled(j.id));
      if (next) {
        if (next.metrics && !next.metrics.transfer_started_at) {
          next.metrics.transfer_started_at = new Date().toISOString();
          this.save(next);
        }
        const abort = new AbortController(); this.transfer = {id: next.id, abort};
        try {
          if (next.prepared?.length) this.attempt(next, 'upload-inputs');
          for (const ref of next.prepared ?? []) {
            await this.worker.upload(next.id, ref.file, ref.filename, abort.signal);
            if (ref.audio_file && ref.audio_filename)
              await this.worker.upload(
                next.id,
                ref.audio_file,
                ref.audio_filename,
                abort.signal,
              );
          }
        } catch (error) {
          next.error =
            "Reference transfer interrupted. It will restart automatically before generation.";
          if (actionableTransfer(error)) this.blockRecovery(next, error);
          this.save(next);
          return;
        } finally { this.transfer = undefined; }
        if (abort.signal.aborted || this.stopped) return;
        next.workspace_id = cap.workspace_id;
        next.engine_session_id = cap.engine_session_id;
        await this.dispatch(next, cap.engine_session_id);
        return;
      }
    }
    const finalQueue = await this.worker.json("/comfy/queue");
    const finalSession = await this.worker.json("/comfy/session");
    if (
      finalSession.engine_session_id !== cap.engine_session_id ||
      finalSession.workspace_id !== cap.workspace_id ||
      !Array.isArray(finalQueue.queue_running) ||
      !Array.isArray(finalQueue.queue_pending)
    )
      throw new Error("Engine changed during reconciliation");
    this.checkedAt = Date.now();
    this.safe =
      this.paused &&
      !foreign &&
      !orphan &&
      !unresolved &&
      !finalQueue.queue_running.length &&
      !finalQueue.queue_pending.length;
    this.reason = orphan
      ? "The worker has work from another seed library. Recover it before stopping or generating."
      : foreign
        ? "The pod is running work outside seed."
        : unresolved
          ? "Work or unsaved outputs remain."
          : !this.paused
            ? "Pause the queue before stopping the pod."
            : "No active work or unsaved outputs.";
  }
  private async dispatch(job: Job, session: string) {
    if(this.cancelled(job.id))return;
    this.attempt(job, 'submit');
    job.state = 'submitting'; job.submission_pending = true;
    if (job.metrics && !job.metrics.submitted_at) job.metrics.submitted_at = new Date().toISOString();
    this.save(job);
    try {
      const response = await this.worker.request('/comfy/prompt', {
        method: 'POST', session,
        body: {prompt_id: job.id, prompt: job.graph, preset: job.preset, ...(job.video_profile ? {video_profile: job.video_profile} : {})},
      });
      if (!response.ok) {
        const rejection = await response.json().catch(() => null);
        if ([409,422].includes(response.status) && rejection?.accepted === false) {
          job.submission_pending = false; job.state = 'failed';
          job.output_save_state = 'not_applicable'; job.error = rejection.error;
          this.save(job); return;
        }
        throw new WorkerHttpError(response.status);
      }
      await response.body?.cancel();
      job.submission_pending = false; job.state = 'running'; job.error = null;
    } catch (error) {
      job.state = 'needs_attention';
      if (error instanceof WorkerHttpError && error.permanent) job.submission_pending = false;
      job.error = 'Submission response unavailable. Reconciling the original job before any further work.';
    }
    this.save(job);
  }
  private manifest(job: Job, record: any) {
    if (
      typeof record.manifest_bytes !== "string" ||
      createHash("sha256").update(record.manifest_bytes).digest("hex") !==
        record.manifest_digest
    )
      throw new Error("Output manifest integrity failed");
    const manifest = JSON.parse(record.manifest_bytes);
    if (
      manifest.job_id !== job.id ||
      manifest.workspace_id !== job.workspace_id ||
      manifest.engine_session_id !== job.engine_session_id ||
      !["completed", "failed", "cancelled"].includes(manifest.state) ||
      !Array.isArray(manifest.outputs)
    )
      throw new Error("Output identity mismatch");
    const frames = job.request.output.format === 'images';
    if (frames && (new Set(manifest.outputs.map((o:Output)=>o.path)).size!==manifest.outputs.length ||
      manifest.outputs.some((o:Output)=>typeof o.path!=='string'||!o.path.startsWith('seed/'+job.id+'/')||o.path.includes('..')||o.path.includes('\\')||!o.path.endsWith('.png'))))
      throw new Error('Invalid frame paths');
    if (
      manifest.state === "completed" &&
      (manifest.outputs.length !== (job.request.output.format === 'images' ? job.request.output.duration_seconds! * 24 : 1) ||
        manifest.outputs.some(
          (x: Output, index: number) =>
            x.id !== String(index) ||
            x.mime_type !==
              ((job.request.workflow === "text-to-image" || job.request.output.format === "images")
                ? "image/png"
                : "video/mp4") ||
            !Number.isSafeInteger(x.size) ||
            x.size < 1 ||
            x.size > (frames ? 64 * 1024 * 1024 : 8 * 1024 * 1024 * 1024) ||
            !/^[a-f0-9]{64}$/.test(x.sha256),
        ))
    )
      throw new Error("Invalid image manifest");
    return manifest;
  }
  private async retrieve(job: Job, outputs: Output[], digest: string) {
    const abort = new AbortController(); this.transfer = {id: job.id, abort};
    try {
      if (job.output_save_state !== "saved") {
        job.state = "copying";
        job.output_save_state = "saving";
        job.error = null;
        this.save(job);
        for (const output of outputs) {
          const filename =
            job.id +
            "-" +
            output.id +
            (output.mime_type === "video/mp4" ? ".mp4" : ".png");
          const destination = path.join(
            this.paths.data,
            "media/outputs",
            filename,
          );
          const temporary = path.join(
            this.paths.data,
            "transfers",
            filename + ".part",
          );
          if (
            !existsSync(destination) ||
            statSync(destination).size !== output.size ||
            (await hashFile(destination)) !== output.sha256
          ) {
            let offset = existsSync(temporary) ? statSync(temporary).size : 0;
            if (offset > output.size) {
              unlinkSync(temporary);
              offset = 0;
            }
            if (offset < output.size) {
              this.attempt(job, 'download-output-' + output.id, offset);
              const response = await this.worker.request(
                `/worker/v1/jobs/${job.id}/outputs/${output.id}`,
                { range: offset, signal: abort.signal },
              );
              if (!response.ok) { await response.body?.cancel(); throw new WorkerHttpError(response.status); }
              if (!response.body) throw new TransferIntegrityError('Empty output response.');
              if (offset && response.status === 200) offset = 0;
              else if (
                offset &&
                (response.status !== 206 ||
                  response.headers.get("content-range") !==
                    `bytes ${offset}-${output.size - 1}/${output.size}`)
              ) {
                await response.body.cancel();
                throw new TransferIntegrityError("Invalid resumed transfer.");
              }
              const handle = await open(temporary, offset ? "a" : "w");
              try {
                for await (const chunk of response.body as any) {
                  offset += chunk.length;
                  if (offset > output.size)
                    throw new TransferIntegrityError("Unexpected output size.");
                  await handle.writeFile(chunk);
                }
                await handle.sync();
              } finally {
                await handle.close();
              }
            }
            if (statSync(temporary).size !== output.size)
              throw new Error("Image transfer is incomplete.");
            if ((await hashFile(temporary)) !== output.sha256) {
              unlinkSync(temporary);
              job.integrity_failures = (job.integrity_failures ?? 0) + 1;
              if (job.integrity_failures >= 2) throw new TransferIntegrityError('Output integrity verification failed twice.');
              throw new Error(
                "Image integrity check failed; retrying transfer.",
              );
            }
            renameSync(temporary, destination);
          }
        }
        this.db.transaction(() => {
          for (const output of outputs) {
            const id = job.id + "-" + output.id;
            this.db
              .prepare(
                "INSERT OR IGNORE INTO assets(id,kind,name,relative_path,metadata_json,created_at) VALUES (?,?,?,?,?,?)",
              )
              .run(
                id,
                output.mime_type === "video/mp4" ? "video" : "image",
                (output.mime_type === "video/mp4" ? "Video \u00b7 " : "Image \u00b7 ") +
                  job.request.mode.toUpperCase(),
                "media/outputs/" +
                  id +
                  (output.mime_type === "video/mp4" ? ".mp4" : ".png"),
                JSON.stringify({
                  job_id: job.id,
                  ...(job.request.output.format === "images" ? {frame_index:Number(output.id), width:job.request.output.aspect === "16:9" ? 1344 : 768, height:job.request.output.aspect === "16:9" ? 768 : 1344} : {}),
                  mode: job.request.mode,
                  mime_type: output.mime_type,
                  sha256: output.sha256,
                  size: output.size,
                }),
                new Date().toISOString(),
              );
          }
          if (job.request.output.format === 'images') {
            this.db.prepare('INSERT OR IGNORE INTO sequences(id,mode,created_at) VALUES (?,?,?)').run(job.id,job.request.mode,job.created_at);
            for(const output of outputs) this.db.prepare('INSERT OR IGNORE INTO sequence_frames VALUES (?,?,?)').run(job.id,job.id+'-'+output.id,Number(output.id));
          }
          if(job.request.note){for(const id of job.request.output.format==='images'?[job.id]:outputs.map(o=>job.id+'-'+o.id))this.db.prepare('INSERT OR IGNORE INTO asset_notes(id,note,revision) VALUES (?,?,1)').run(id,job.request.note);}
          if (job.metrics && !job.metrics.saved_at) {
            job.metrics.saved_at = new Date().toISOString();
            job.metrics.elapsed_to_saved_seconds =
              (Date.parse(job.metrics.saved_at) - Date.parse(job.created_at)) /
              1000;
          }
          job.outputs = outputs.map((o) => job.id + "-" + o.id);
          job.state = "completed";
          job.output_save_state = "saved";
          job.cleanup_state = "pending";
          job.error = null;
          this.save(job);
        })();
      }
      await this.acknowledgeOutputs(job, digest);
    } catch (error) {
      if (job.output_save_state !== "saved") {
        job.state = "copy_pending";
        job.error =
          "Image transfer interrupted. The worker copy is retained; transfer will retry when connected.";
        if (actionableTransfer(error)) this.blockRecovery(job, error);
        this.save(job);
      }
      // A lost acknowledgment never rolls back a durable local save.
    } finally { this.transfer = undefined; }
  }
  private async acknowledgeOutputs(job: Job, digest: string) {
    try {
      this.attempt(job, 'receipt');
      const receipt = await this.worker.json(
        "/worker/v1/jobs/" + job.id + "/receipt",
        { method: "POST", body: { manifest_digest: digest } },
      );
      job.cleanup_state = receipt.cleanup_complete ? "complete" : "pending";
      this.save(job);
    } catch (error) {
      if (actionableTransfer(error)) this.blockRecovery(job, error);
      /* Terminal outcome remains durable; retry cleanup independently. */
    }
  }
}
