// In-memory provider and worker boundaries for the real application test server.
// All files are local fixtures. This module cannot construct a live provider.
import { copyFile, readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from 'node:url';
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { credential } from "../dist/server/credential-store.js";

export async function offlinePool(paths) {
  const {PoolError} = await import(pathToFileURL(path.join(path.resolve(process.env.SEED_QA_SERVER_ROOT ?? 'dist'),'server/pool-errors.js')).href);
  const resources = new Map(),
    jobs = new Map(),
    preparation = new Map(),
    omitted = new Map();
  const audit = [];
  let scenario = "normal",
    offset = 0;
  let logMode = 'normal';
  const now = () => Date.now() + offset;
  await mkdir(paths.temp, { recursive: true });
  const output = path.join(paths.temp, "worker-fixture.png");
  await sharp({
    create: { width: 1280, height: 720, channels: 3, background: "#6d8063" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="1280" height="720"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#b6c5b2"/><stop offset="1" stop-color="#657f70"/></linearGradient></defs><rect width="1280" height="720" fill="url(#s)"/><path d="M0 500 290 190 580 510 860 220 1280 540V720H0" fill="#425e55"/><path d="m200 720 230-300 310 300 260-180 280 180" fill="#2c4944"/><ellipse cx="640" cy="635" rx="500" ry="65" fill="#82a59a"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(output);
  const bytes = await readFile(output),
    digest = createHash("sha256").update(bytes).digest("hex");
  const videoOutput = path.join(paths.temp, "worker-fixture.mp4");
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-loop",
      "1",
      "-i",
      output,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=32000",
      "-t",
      "5",
      "-vf",
      "scale=1344:768,format=yuv420p",
      "-r",
      "24",
      "-ac",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      videoOutput,
    ],
    { windowsHide: true },
  );
  const videoBytes = await readFile(videoOutput),
    videoDigest = createHash("sha256").update(videoBytes).digest("hex");
  const record = (kind, data = {}) => audit.push({ kind, ...data });
  const releases = Object.fromEntries(
    ["image", "video"].map((role) => [
      role,
      {
        image: "offline/seed-" + role + "@sha256:" + "a".repeat(64),
        disk_gb: 220,
        manifest: [
          {
            path: "diffusion_models/" + role + ".safetensors",
            url: "https://fixture.invalid/model",
            sha256: "b".repeat(64),
            size: role === 'video' ? 74895164688 : 16000000000,
          },
        ],
      },
    ]),
  );
  const providers = Object.fromEntries(
    ["vast", "runpod"].map((provider) => [
      provider,
      {
        async collectStartupLogs(worker, signal) {
          record('startup_log', {provider, id: worker.id});
          signal.throwIfAborted();
          if (logMode === 'unavailable') throw Error('Fixture log transport unavailable');
          return {source: provider === 'runpod' ? 'RunPod startup' : 'Vast startup',
            text: logMode === 'empty' ? '' : logMode === 'long' ? `${worker.worker_class} worker bootstrap\n` + Array.from({length:40},(_,i)=>`Layer ${i}: checksum verified · `+'long-fixture-layer-name-'.repeat(6)).join('\n')
              : 'Downloading worker container\nLayer 83a7: download complete\nLayer c192: verifying checksum',
            truncated: false};
        },
        configured: () =>
          !!credential(
            paths,
            provider === "vast" ? "vastApiKey" : "runpodApiKey",
            {},
          ),
        async offers(role, requirements) {
          record("offers", { provider, role });
          if (scenario === "provider_error" && provider === "vast")
            throw Error(
              "Vast is temporarily unavailable. RunPod results are still available.",
            );
          if (scenario === "offers_empty") return [];
          if (scenario === "offers_loading")
            await new Promise((resolve) => setTimeout(resolve, 1800));
          const rate = provider === "vast" ? 0.92 : 1.24;
          return [
            {
              offer: {
                id: provider + "-" + role,
                provider,
                worker_class: role,
                gpu: "RTX PRO 6000 Blackwell",
                vram_gb: 96,
                region: provider === "vast" ? "US · Illinois" : "US · Virginia",
                hourly: rate,
                compute_hourly: rate - 0.02,
                storage_hourly: 0.02,
                disk_gb: requirements.disk_gb,
                max_quantity: provider === "vast" ? 1 : 4,
                quoted_at: new Date(now()).toISOString(),
                expires_at: new Date(now() + 600000).toISOString(),
                cpu_cores: 24,
                ram_gb: 192,
                power_watts: 600,
                transfer_per_gb: provider === "vast" ? 0.02 : undefined,
                image: requirements.image,
                available: true,
              },
              data: { fixture: true },
            },
          ];
        },
        async create(worker) {
          record("create", { provider, id: worker.id });
          if (scenario === "launch_failure" && provider === "vast")
            throw new PoolError({code:'capacity_unavailable', message:'This offer is no longer available. Refresh to choose another GPU.', provider, retryable:true}, true);
          const resource = {
            id: "fixture-" + worker.id,
            status: "running",
            created_at: new Date(now()).toISOString(),
            hourly: worker.hourly,
            ssh: { host: "127.0.0.1", port: 1, user: "fixture" },
            image: worker.offer.image,
          };
          resources.set(worker.id, resource);
          return resource;
        },
        async find(worker) {
          record("find", { provider, id: worker.id });
          const resource = resources.get(worker.id);
          return resource ? {...resource, ...(scenario === 'acquiring' && !worker.ready_at ? {ssh: undefined} : {})} : null;
        },
        async destroy(worker) {
          record("destroy", { provider, id: worker.id });
          if (scenario === "release_failure")
            throw Error(
              "Termination is not confirmed. Seed is still checking this rental.",
            );
          resources.delete(worker.id);
        },
        async validateCredential(value) {
          if (value === "wrong-account")
            throw Error("This key belongs to another account.");
        },
      },
    ]),
  );
  const worker = {
    async preflight() {
      record("preflight");
    },
    async auth(value) {
      return {
        public_key: "ssh-ed25519 OFFLINE_FIXTURE",
        pairing_secret: "fixture-" + value.id,
      };
    },
    async prepare(value, options) {
      record("prepare", { id: value.id });
      if (scenario === "disconnected")
        throw Error(
          "The worker connection was interrupted. Reconnect to recover its jobs.",
        );
      if (options?.retry) scenario = "normal";
      if (options?.omit)
        omitted.set(
          value.id,
          new Set([...(omitted.get(value.id) ?? []), ...options.omit]),
        );
      const tick = (preparation.get(value.id) ?? 0) + 1;
      preparation.set(value.id, tick);
      const waiting = ['preparing','download_start','download_stalled','verifying','engine_start','legacy_progress'].includes(scenario) || tick < 2 && !['base_failure','lora_failure'].includes(scenario);
      const transferred = ['verifying','engine_start'].includes(scenario) ? 1 : scenario === 'download_start' ? 0 : .43;
      // The real downloader has one sequential base lane and one adapter lane.
      const lanes = [value.manifest.filter(file => !file.routes?.length), value.manifest.filter(file => file.routes?.length)];
      const remaining = lanes.map(files => Math.floor(files.reduce((bytes, file) => bytes + file.size, 0) * transferred));
      const active = [false, false];
      const files = value.manifest.map((file) => {
        const optional = !!file.routes?.length,
          isOmitted = omitted.get(value.id)?.has(file.path),
          failed =
            (scenario === "lora_failure" && optional && !isOmitted) ||
            (scenario === "base_failure" && !optional);
        const lane = optional ? 1 : 0;
        let state = failed ? 'needs_source' : 'ready', bytes = failed || isOmitted ? 0 : file.size;
        if (waiting && !isOmitted) {
          bytes = Math.min(file.size, remaining[lane]);
          remaining[lane] -= bytes;
          if (scenario === 'verifying') state = file === lanes[lane].at(-1) ? 'verifying' : 'ready';
          else if (scenario === 'engine_start' || bytes === file.size) state = 'ready';
          else if (!active[lane]) { state = 'downloading'; active[lane] = true; }
          else state = 'pending';
        }
        return {
          path: file.path,
          name: path.posix.basename(file.path),
          optional,
          omitted: isOmitted,
          ready: state === 'ready' && !failed && !isOmitted,
          state,
          bytes,
          total: file.size,
          ...(failed
            ? {
                error: optional
                  ? "Civitai did not grant access to this file. Check your key and retry."
                  : "The model host cannot be reached from this worker.",
              }
            : {}),
        };
      });
      const ready = !waiting && !files.some((file) => file.error);
      return {
        ready,
        active_job_id: value.current_job_id,
        activity: value.current_job_id ? scenario === 'model_loading' ? 'Loading image models' : 'Generating · 32%' : undefined,
        workflows: value.worker_class === 'image' ? ['text-to-image', ...(scenario === 'legacy_image' ? [] : ['image-to-image'])] : ['text-to-video', 'reference-to-video'],
        session_id: "fixture-session-" + value.id,
        revision: value.preparation_revision ?? 1,
        installed_loras: ready
          ? value.requested_loras
              .filter(
                (lora) => !omitted.get(value.id)?.has("loras/" + lora.filename),
              )
              .map((lora) => ({
                filename: lora.filename,
                sha256: lora.sha256,
                routes: [lora.route],
              }))
          : [],
        preparation: {
          stage: scenario === 'legacy_progress' ? undefined : scenario === 'engine_start' ? 'starting_engine' : scenario === 'verifying' ? 'verifying' : 'downloading',
          bytes_per_second: scenario === 'legacy_progress' ? undefined : scenario === 'preparing' ? 112000000 : 0,
          eta_seconds: scenario === 'preparing' ? Math.round(files.reduce((n, file) => n + file.total - file.bytes, 0) / 112000000) : null,
          stalled: scenario === 'download_stalled',
          last_transfer_update_at: waiting && !['legacy_progress','verifying','engine_start'].includes(scenario)
            ? new Date(now() - (scenario === 'download_stalled' ? 45000 : 2000)).toISOString() : undefined,
          phase: waiting
            ? scenario === 'engine_start' ? 'Starting generation engine' : scenario === 'verifying' ? 'Checking model files' : 'Downloading model assets'
            : ready
              ? "Ready"
              : scenario === "base_failure"
                ? "Base model download needs attention"
                : "LoRA download needs attention",
          bytes_done: files.reduce((n, file) => n + file.bytes, 0),
          bytes_total: files.reduce((n, file) => n + (file.omitted ? 0 : file.total), 0),
          files,
        },
      };
    },
    async fallbackBaseModels(value) {
      record("local_fallback", { id: value.id });
      scenario = "normal";
    },
    async upload(_worker, job, file, name) {
      record("upload", { job, name });
      await readFile(file);
    },
    async submit(value, body) {
      const id = body.prompt_id;
      record("submit", { worker: value.id, job: id });
      if (!id) throw Error("Fixture expected a prompt id.");
      if (!jobs.has(id))
        jobs.set(id, { started: now(), body, state: "running" });
    },
    async receipt(_worker, id) {
      const job = jobs.get(id);
      if (!job) return null;
      if (job.state === "cancelled")
        return {
          manifest: { state: "cancelled", outputs: [] },
          manifest_digest: digest,
        };
      if (["generating", "model_loading"].includes(scenario) || now() - job.started < 1500)
        return { submission: { graph_digest: digest } };
      if (scenario === "generation_failure")
        return {
          manifest: {
            state: "failed",
            outputs: [],
            error: "The worker could not complete this output.",
          },
          manifest_digest: digest,
        };
      const video = !['image', 'image-edit'].includes(job.body.route);
      return {
        submission: { graph_digest: digest },
        manifest: {
          state: "completed",
          outputs: [
            {
              id: "0",
              path: video ? "output.mp4" : "output.png",
              mime_type: video ? "video/mp4" : "image/png",
              size: video ? videoBytes.length : bytes.length,
              sha256: video ? videoDigest : digest,
            },
          ],
        },
        manifest_digest: digest,
      };
    },
    async cancel(_worker, id) {
      record("cancel", { job: id });
      const job = jobs.get(id);
      if (job) job.state = "cancelled";
    },
    async download(_worker, id, file, target) {
      record("download", { job: id });
      if (scenario === "save_failure")
        throw Error(
          "Cannot save output. Check local storage and retry saving.",
        );
      await copyFile(
        file.mime_type === "video/mp4" ? videoOutput : output,
        target,
      );
    },
    async acknowledge(_worker, id) {
      record("acknowledge", { job: id });
    },
    async disconnect(value) {
      record("disconnect", { id: value.id });
    },
    async close() {},
  };
  return {
    dependencies: { providers, worker, releases, now },
    controls: {
      configure(value) {
        if (typeof value.scenario === "string") scenario = value.scenario;
        if (typeof value.log_mode === 'string') logMode = value.log_mode;
        if (Number.isFinite(value.advance_seconds))
          offset += value.advance_seconds * 1000;
        return { scenario, now: now(), calls: audit.length };
      },
      status() {
        return { scenario, external_calls: 0, audit };
      },
    },
  };
}
