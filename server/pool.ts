import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StudioPaths } from "./storage.js";
import type { Loras, LoraSelection } from "./loras.js";
import type { CredentialField } from "../shared/credentials.js";
import type {
  InstalledLora,
  LaunchRequest,
  OffersResponse,
  PoolAction,
  PoolSnapshot,
  PoolWorker,
  WorkerClass,
  Provider,
} from "../shared/pool.js";
import type {
  PoolDependencies,
  RentalRecord,
  ModelSource,
} from "./pool-contracts.js";
import { PoolError, poolIssue, WorkerStarting } from "./pool-errors.js";
import {Diagnostics} from './diagnostics.js';
import {StartupLogs} from './startup-logs.js';
import { isRejectedLaunch } from '../shared/worker-outcome.js';

const stopped = (w: RentalRecord) => w.state === "released";
export class WorkerPool {
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private inFlight = new Map<string, Promise<void>>();
  private quitting = new Map<string, Promise<void>>();
  private releaseChecks = new Map<string, number>();
  private changingCredentials = new Set<Provider>();
  private providerChecks = new Map<string, number>();
  private providerBackoff = new Map<Provider, number>();
  private accessChecks = new Map<string, number>();
  private pending: (w: RentalRecord) => boolean = () => false;
  private cancelJobs: (id?: string) => void = () => {};
  private assignedJob: (id: string) => { unknown: boolean; recovering: boolean } = () => ({ unknown: false, recovering: false });
  readonly now: () => number;
  readonly startupLogs: StartupLogs;
  constructor(
    private db: Database.Database,
    private paths: StudioPaths,
    private loras: Loras,
    readonly dependencies: PoolDependencies,
    readonly diagnostics?: Diagnostics,
  ) {
    this.now = dependencies.now ?? Date.now;
    this.startupLogs = new StartupLogs(db, diagnostics, this.now);
    if(diagnostics) for(const w of this.all()) {
      const known=this.db.prepare('SELECT worker_id FROM acquisition_history WHERE worker_id=?').get(w.id);
      if(!known)diagnostics.acquisition(w,null,true);
    }
  }
  bindJobs(hooks: {
    pending: (w: RentalRecord) => boolean;
    cancel: (id?: string) => void;
    assigned?: (id: string) => { unknown: boolean; recovering: boolean };
  }) {
    this.pending = hooks.pending;
    this.cancelJobs = hooks.cancel;
    if (hooks.assigned) this.assignedJob = hooks.assigned;
  }
  private date() {
    return new Date(this.now()).toISOString();
  }
  all(): RentalRecord[] {
    return (
      this.db
        .prepare("SELECT snapshot_json FROM pool_workers ORDER BY rowid")
        .all() as { snapshot_json: string }[]
    ).map((r) => JSON.parse(r.snapshot_json));
  }
  get(id: string): RentalRecord | null {
    const r = this.db
      .prepare("SELECT snapshot_json FROM pool_workers WHERE id=?")
      .get(id) as { snapshot_json: string } | undefined;
    return r ? JSON.parse(r.snapshot_json) : null;
  }
  private save(w: RentalRecord) {
    const previous=this.get(w.id);
    this.db
      .prepare(
        "INSERT INTO pool_workers(id,snapshot_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json",
      )
      .run(w.id, JSON.stringify(w));
    this.diagnostics?.acquisition(w,previous);
    this.startupLogs.observe(w,previous);
  }
  private update(id: string, fn: (w: RentalRecord) => void) {
    const w = this.get(id);
    if (!w) return;
    fn(w);
    this.save(w);
    return w;
  }
  snapshot(): PoolSnapshot {
    const workers = this.all().map((w) => this.publicWorker(w)),
      active = workers.filter((w) => w.state !== "released");
    return {
      server_time: this.date(),
      workers,
      summary: {
        active: active.length,
        ready: active.filter((w) => w.state === "ready").length,
        busy: active.filter((w) =>
          ["generating", "saving", "finishing"].includes(w.state),
        ).length,
        preparing: active.filter((w) =>
          ["starting", "preparing", "reconnecting"].includes(w.state),
        ).length,
        needs_attention: active.filter((w) => w.state === "needs_attention")
          .length,
        hourly: active.reduce(
          (n, w) => n + (this.get(w.id)?.create_sent ? w.hourly : 0),
          0,
        ),
        estimated_spend: active.reduce((n, w) => n + w.estimated_spend, 0),
        image: active.filter((w) => w.worker_class === "image").length,
        video: active.filter((w) => w.worker_class === "video").length,
      },
    };
  }
  private publicWorker(w: RentalRecord): PoolWorker {
    const assigned = w.current_job_id ? this.assignedJob(w.current_job_id) : null;
    if (assigned && (assigned.unknown || assigned.recovering) && !w.quit_mode && !w.issue && ['generating', 'saving'].includes(w.state))
      w = { ...w, state: 'needs_attention', current_activity: assigned.recovering ? 'Checking request…' : 'Request status unknown' };
    const elapsed = w.create_sent
      ? Math.max(
          0,
          (Date.parse(w.released_at ?? this.date()) -
            Date.parse(w.allocated_at ?? w.created_at)) /
            1000,
        )
      : 0;
    const actions: PoolAction[] = stopped(w)
      ? isRejectedLaunch(w) && !w.resource && !w.launch_failure_dismissed_at ? ['dismiss_launch_failure'] : []
      : w.quit_mode || w.state === "releasing" ? ["quit"] : ["finish", "quit"];
    if (!w.quit_mode && ((w.state === "needs_attention" && w.issue?.code !== "preparation_failed") || w.state === "reconnecting"))
      actions.unshift("reconnect");
    if (
      !w.quit_mode && !stopped(w) && (w.preparation?.error ||
        w.preparation?.files.some((f) => f.error && !f.omitted)) &&
      !(w.adapters_frozen ?? w.ready)
    ) {
      actions.unshift(
        "retry_preparation",
        ...(w.preparation.files.some((f) => f.optional && f.error && !f.omitted)
          ? ["omit_loras" as const]
          : []),
      );
      if (
        this.dependencies.worker.fallbackBaseModels &&
        w.preparation.files.some(
          (f) =>
            !f.optional &&
            !f.ready &&
            !f.omitted &&
            (f.error || w.preparation?.error),
        )
      )
        actions.unshift("local_fallback");
    }
    return {
      id: w.id,
      launch_id: w.launch_id,
      provider: w.provider,
      worker_class: w.worker_class,
      gpu: w.gpu,
      vram_gb: w.vram_gb,
      region: w.region,
      state: w.state,
      hourly: w.hourly,
      compute_hourly: w.compute_hourly,
      storage_hourly: w.storage_hourly,
      estimated_spend: (elapsed * w.hourly) / 3600,
      elapsed_seconds: elapsed,
      created_at: w.created_at,
      allocated_at: w.allocated_at,
      ready_at: w.ready_at,
      released_at: w.released_at,
      create_rejected: w.create_rejected,
      launch_failure_dismissed_at: w.launch_failure_dismissed_at,
      startup_stage: w.resource?.startup_stage,
      provider_id: w.provider_id,
      current_job_id: w.current_job_id,
      current_activity: w.current_activity,
      quit_mode: w.quit_mode,
      issue: w.issue,
      preparation: w.preparation,
      installed_loras: w.installed_loras,
      workflows: w.workflows,
      actions,
      console_url: w.console_url,
    };
  }
  release(role: WorkerClass) {
    const injected = this.dependencies.releases?.[role];
    if (injected) return injected;
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../worker",
    );
    let entry: { image?: string; disk_gb: number };
    try {
      entry = JSON.parse(
        readFileSync(path.join(root, "releases.json"), "utf8"),
      )[role];
    } catch {
      throw new PoolError({
        code: "release_unavailable",
        message:
          "Worker images have not been published. Build and publish the image and video releases before renting a GPU.",
        retryable: false,
      });
    }
    if (!entry?.image || !/@sha256:[a-f0-9]{64}$/.test(entry.image))
      throw new PoolError({
        code: "release_unavailable",
        message:
          "Worker images must have a published, pinned release before renting a GPU.",
        retryable: false,
      });
    const extraBytes = [
      ...new Map(
        this.loras.manifestSources(role).map((s) => [s.sha256, s.size_bytes]),
      ).values(),
    ].reduce((a, b) => a + b, 0);
    return {
      image: entry.image,
      disk_gb: entry.disk_gb + Math.ceil((extraBytes * 1.2) / 1e9),
      manifest: JSON.parse(
        readFileSync(path.join(root, `models-${role}.json`), "utf8"),
      ) as ModelSource[],
    };
  }
  async offers(role: WorkerClass): Promise<OffersResponse> {
    if (!["image", "video"].includes(role))
      throw Error("Choose an image or video worker.");
    let release;
    try {
      release = this.release(role);
    } catch (error) {
      return {
        items: [],
        issues: [poolIssue(error)],
        searched_at: this.date(),
      };
    }
    const replies = await Promise.allSettled(
      (["vast", "runpod"] as const).map(async (provider) => {
        const driver = this.dependencies.providers[provider];
        if (!driver.configured())
          throw new PoolError({
            code: "missing_credentials",
            message: `Add your ${provider === "vast" ? "Vast" : "RunPod"} key in Admin to see available GPUs.`,
            provider,
            retryable: false,
          });
        try { return await driver.offers(role, release); }
        catch (error) {
          this.diagnostics?.error('offers',error,{provider});
          if (error instanceof PoolError) throw error;
          throw new PoolError({
            code: "availability_unavailable",
            message: `${provider === "vast" ? "Vast" : "RunPod"} availability could not be loaded. Results from other providers remain available.`,
            provider,
            retryable: true,
            action: "Refresh offers",
          });
        }
      }),
    );
    const items: OffersResponse["items"] = [],
      issues: OffersResponse["issues"] = [];
    for (const reply of replies) {
      if (reply.status === "rejected") {
        issues.push(poolIssue(reply.reason));
        continue;
      }
      for (const result of reply.value) {
        // Base files only: adapters, container layers and retries are additional.
        result.offer.model_download_bytes = release.manifest.reduce((sum, file) => sum + file.size, 0);
        this.db
          .prepare("INSERT OR REPLACE INTO pool_offers VALUES (?,?)")
          .run(result.offer.id, JSON.stringify(result));
        items.push(result.offer);
      }
    }
    return {
      items: items.sort((a, b) => a.hourly - b.hourly),
      issues,
      searched_at: this.date(),
    };
  }
  async launch(input: LaunchRequest, key: string) {
    if (!/^[\w-]{16,128}$/.test(key)) throw Error("A launch key is required.");
    if (
      !input ||
      !Array.isArray(input.selections) ||
      !input.selections.length ||
      input.selections.length > 16 ||
      !Number.isFinite(input.max_hourly) ||
      input.max_hourly < 0
    )
      throw Error("Choose workers and review the total hourly rate.");
    const body = JSON.stringify(input),
      prior = this.db
        .prepare("SELECT body_json FROM pool_launches WHERE idempotency_key=?")
        .get(key) as { body_json: string } | undefined;
    if (prior) {
      if (prior.body_json !== body)
        throw Error("This launch key belongs to another selection.");
      return this.snapshot();
    }
    let total = 0,
      count = 0;
    const records: RentalRecord[] = [],
      seen = new Set<string>(),
      launch_id = randomUUID();
    for (const selection of input.selections) {
      if (seen.has(selection.offer_id))
        throw Error("Choose each offer only once.");
      seen.add(selection.offer_id);
      const row = this.db
        .prepare("SELECT snapshot_json FROM pool_offers WHERE id=?")
        .get(selection.offer_id) as { snapshot_json: string } | undefined;
      if (!row) throw Error("Refresh available GPUs before starting workers.");
      const { offer, data } = JSON.parse(row.snapshot_json);
      if (!offer.available || Date.parse(offer.expires_at) <= this.now())
        throw Error("This quote expired. Refresh available GPUs.");
      if (
        !Number.isInteger(selection.quantity) ||
        selection.quantity < 1 ||
        selection.quantity > offer.max_quantity
      )
        throw Error("Choose an available quantity.");
      count += selection.quantity;
      if (count > 16) throw Error("Start at most 16 workers at a time.");
      total += selection.quantity * offer.hourly;
      const release = this.release(offer.worker_class);
      if (release.image !== offer.image || release.disk_gb > offer.disk_gb)
        throw Error(
          "Worker release or adapter storage changed. Refresh available GPUs.",
        );
      await this.dependencies.worker.preflight(offer.worker_class);
      const sources = this.loras.manifestSources(offer.worker_class),
        manifest = structuredClone(release.manifest);
      for (const s of sources) {
        const existing = manifest.find((m) => m.path === s.path);
        if (existing) {
          existing.routes = [...new Set([...(existing.routes ?? []), s.route])];
        } else
          manifest.push({
            path: s.path,
            url: s.url,
            sha256: s.sha256,
            size: s.size_bytes,
            routes: [s.route],
          });
      }
      const requested: InstalledLora[] = sources.map((s) => ({
        id: s.id,
        name: s.name,
        revision: s.revision,
        route: s.route,
        filename: path.posix.basename(s.path),
        sha256: s.sha256,
      }));
      for (let i = 0; i < selection.quantity; i++)
        records.push({
          id: randomUUID(),
          launch_id,
          provider: offer.provider,
          worker_class: offer.worker_class,
          gpu: offer.gpu,
          vram_gb: offer.vram_gb,
          region: offer.region,
          state: "starting",
          hourly: offer.hourly,
          compute_hourly: offer.compute_hourly,
          storage_hourly: offer.storage_hourly,
          created_at: this.date(),
          console_url:
            offer.provider === "vast"
              ? "https://cloud.vast.ai/instances/"
              : "https://console.runpod.io/pods",
          installed_loras: [],
          requested_loras: requested,
          offer,
          provider_data: data,
          manifest,
          submit_key: key,
          preparation_revision: 0,
        });
    }
    if (total > input.max_hourly + 0.000001)
      throw Error(
        "The hourly quote exceeds the approved amount. Refresh available GPUs.",
      );
    this.db.transaction(() => {
      const duplicate = this.db
        .prepare("SELECT body_json FROM pool_launches WHERE idempotency_key=?")
        .get(key) as { body_json: string } | undefined;
      if (duplicate) {
        if (duplicate.body_json !== body) throw Error("Launch key conflict.");
        return;
      }
      this.db
        .prepare("INSERT INTO pool_launches VALUES (?,?,?,?)")
        .run(launch_id, key, body, JSON.stringify(records.map((w) => w.id)));
      records.forEach((w) => this.save(w));
    })();
    void this.tick();
    return this.snapshot();
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 2000);
    void this.tick();
  }
  async close() {
    this.closing = true;
    this.startupLogs.close();
    clearInterval(this.timer);
    await this.dependencies.worker.close();
    await Promise.allSettled([
      ...this.inFlight.values(),
      ...this.quitting.values(),
    ]);
  }
  async tick() {
    if (this.closing) return;
    for (const w of this.all().filter((w) => !stopped(w))) {
      void this.startupLogs.collect(w, this.dependencies.providers[w.provider]).catch(() =>
        this.diagnostics?.event({category:'startup',operation:'startup.collection_unavailable',worker_id:w.id,data:{message:'Startup logs are temporarily unavailable.'}}));
      if (w.quit_mode === "now") {
        this.releaseNow(w.id);
        continue;
      }
      if (this.inFlight.has(w.id) || this.quitting.has(w.id)) continue;
      const task = this.advance(w.id)
        .catch((error) => {
          if (error instanceof WorkerStarting) {
            this.diagnostics?.event({category:'worker',operation:'transport.starting',worker_id:w.id,provider:w.provider,data:{error}});
            return;
          }
          this.diagnostics?.error('worker.advance',error,{worker_id:w.id,provider:w.provider});
          this.update(w.id, (current) => {
            if (!stopped(current) && current.quit_mode !== "now") {
              current.state = "needs_attention";
              current.issue = poolIssue(error, current.id);
            }
          });
        })
        .finally(() => this.inFlight.delete(w.id));
      this.inFlight.set(w.id, task);
    }
    await Promise.allSettled(this.inFlight.values());
  }
  private async advance(id: string) {
    let w = this.get(id)!;
    if (stopped(w)) return;
    const provider = this.dependencies.providers[w.provider];
    if (!w.create_sent) {
      if (this.changingCredentials.has(w.provider)) return;
      const auth = await this.dependencies.worker.auth(w);
      w = this.get(id)!;
      if (w.quit_mode === "now") return;
      if (this.changingCredentials.has(w.provider)) return;
      w.create_sent = true;
      w.allocated_at = this.date();
      this.save(w);
      try {
        const resource = await provider.create(w, auth);
        this.update(id, (current) => {
          current.resource = resource;
          current.provider_id = resource.id;
          current.allocated_at = resource.created_at ?? current.allocated_at;
        });
      } catch (error) {
        if (error instanceof PoolError && error.definitive)
          this.update(id, (current) => {
            current.create_rejected = true;
            current.create_sent = false;
            current.state = "released";
            current.released_at = this.date();
            current.issue = poolIssue(error, id);
          });
        throw error;
      }
      w = this.get(id)!;
      if (w.quit_mode === "now") {
        this.releaseNow(id);
        return;
      }
    }
    // Provider control-plane reads are independent of the two-second worker
    // health loop. Quit/release deliberately bypasses this cache and backoff.
    let resource = w.last_verified_at ? w.resource : undefined;
    if (this.now() >= Math.max(this.providerChecks.get(id) ?? 0,
      this.providerBackoff.get(w.provider) ?? 0)) {
      this.providerChecks.set(id, this.now() + 15_000);
      try {
        resource = await provider.find(w) ?? undefined;
      } catch (error) {
        if (error instanceof PoolError && error.issue.code === 'rate_limited')
          this.providerBackoff.set(w.provider, this.now() + 60_000);
        throw error;
      }
      const verified = resource;
      if (verified) this.update(id, current => {
        current.resource = verified;
        current.provider_id = verified.id;
        current.last_verified_at = this.date();
        if (current.issue?.code === 'rate_limited') current.issue = undefined;
      });
    } else if (!resource) return;
    w = this.get(id)!;
    if (!resource) {
      if (w.resource) {
        this.markReleased(
          id,
          "The provider reports that this rental no longer exists.",
        );
        return;
      }
      throw new PoolError({
        code: "launch_uncertain",
        message:
          "The provider has not confirmed this launch. Seed will keep checking without creating another rental. You can still choose Quit now.",
        retryable: true,
      });
    }
    w = this.get(id)!;
    if (w.quit_mode === "now") {
      this.releaseNow(id);
      return;
    }
    if (w.quit_mode === "finish" && !w.current_job_id && !this.pending(w)) {
      this.releaseNow(id);
      return;
    }
    if (!resource.ssh) {
      this.update(id, (current) => {
        current.state = current.quit_mode === 'finish' ? 'finishing' : 'starting';
      });
      return;
    }
    // Register instance access only after the provider has started the container.
    // Registering while it is pulling an image can be overwritten at startup.
    if (provider.prepareAccess && !w.access_prepared) {
      if (this.now() < (this.accessChecks.get(id) ?? 0)) return;
      this.accessChecks.set(id, this.now() + 60_000);
      const auth = await this.dependencies.worker.auth(w);
      if (this.get(id)?.quit_mode === 'now') return;
      await provider.prepareAccess(w, auth.public_key);
      this.update(id, current => { current.access_prepared = true; });
      w = this.get(id)!;
      if (stopped(w) || w.quit_mode === 'now') return;
    }
    const health = await this.dependencies.worker.prepare(w);
    w = this.get(id)!;
    if (stopped(w) || w.quit_mode === "now") return;
    this.update(id, (current) => {
      current.preparation = health.preparation;
      if(current.current_job_id && health.active_job_id===current.current_job_id)current.current_activity=health.activity;
      else if(current.current_activity!=='Downloading base models through this PC')delete current.current_activity;
      current.workflows = health.workflows;
      current.session_id = health.session_id;
      current.preparation_revision =
        health.revision ?? current.preparation_revision;
      if (health.ready) {
        const installed = current.requested_loras.filter((l) =>
          health.installed_loras.some(
            (actual) =>
              actual.filename === l.filename &&
              actual.sha256 === l.sha256 &&
              actual.routes.includes(l.route),
          ),
        );
        if (
          (current.adapters_frozen ?? current.ready) &&
          JSON.stringify(installed) !== JSON.stringify(current.installed_loras)
        )
          throw Error(
            "The worker adapter inventory changed. Reconnect to the original worker.",
          );
        current.installed_loras = installed;
        current.adapters_frozen = true;
      }
      const failed =
        Boolean(health.preparation.error) ||
        health.preparation.files.some((f) => f.error && !f.omitted);
      const foreignBusy =
        Boolean(health.busy) &&
        (!health.active_job_id ||
          health.active_job_id !== current.current_job_id);
      current.ready = health.ready && !failed && !foreignBusy;
      if (current.ready && !current.ready_at) current.ready_at = this.date();
      current.state =
        foreignBusy || failed
          ? "needs_attention"
          : current.current_job_id
            ? current.state === "saving"
              ? "saving"
              : "generating"
            : current.quit_mode === "finish"
              ? "finishing"
              : current.ready
                ? "ready"
                : "preparing";
      current.issue = foreignBusy
        ? {
            code: "worker_busy",
            message:
              "This worker is executing a request outside its recorded assignment. Reconnect or quit it before using it again.",
            retryable: true,
          }
        : failed
          ? {
              code: "preparation_failed",
              message:
                health.preparation.error ??
                "Worker preparation needs attention. Check the file details below and choose a recovery action.",
              retryable: true,
            }
          : undefined;
    });
  }
  async action(id: string, action: PoolAction, paths?: string[]) {
    const w = this.get(id);
    if (!w) throw Error("Worker not found.");
    if (action === 'dismiss_launch_failure') {
      if (!isRejectedLaunch(w) || w.resource)
        throw Error('Only a confirmed rejected launch can be dismissed.');
      if (!w.launch_failure_dismissed_at) {
        this.update(id, current => { current.launch_failure_dismissed_at = this.date(); });
        this.diagnostics?.action(id, action);
      }
      return this.snapshot();
    }
    if (stopped(w)) return this.snapshot();
    this.diagnostics?.action(id,action);
    this.startupLogs.action(id,action);
    if (action === "finish") {
      this.update(id, (current) => {
        if (current.quit_mode !== "now") {
          current.quit_mode = "finish";
          current.finish_before ??= this.date();
          current.state = "finishing";
        }
      });
      void this.tick();
    } else if (action === "quit") {
      this.update(id, (current) => {
        current.quit_mode = "now";
        current.state = "releasing";
      });
      this.cancelJobs(id);
      this.releaseNow(id);
    } else if (action === "reconnect") {
      await this.dependencies.worker.reconnect(w);
      this.update(id, (current) => {
        current.issue = undefined;
        current.state = "reconnecting";
      });
      void this.tick();
    } else if (action === "local_fallback") {
      const fallback = this.dependencies.worker.fallbackBaseModels;
      if (
        !fallback ||
        (w.adapters_frozen ?? w.ready) ||
        w.current_job_id ||
        !w.preparation?.files.some(
          (f) =>
            !f.optional &&
            !f.ready &&
            !f.omitted &&
            (f.error || w.preparation?.error),
        )
      )
        throw Error(
          "Local fallback is available only for failed base models before a worker becomes ready.",
        );
      if (this.inFlight.has(id))
        throw Error("Wait for the current worker check to finish.");
      this.update(id, (current) => {
        current.state = "preparing";
        current.current_activity = "Downloading base models through this PC";
        current.issue = undefined;
      });
      const task = Promise.resolve()
        .then(() => fallback.call(this.dependencies.worker, this.get(id)!))
        .then(() => {
          this.update(id, (current) => {
            delete current.current_activity;
            if (!stopped(current) && current.quit_mode !== "now")
              current.state = "preparing";
          });
        })
        .catch((error) => {
          this.diagnostics?.error('worker.local_fallback',error,{worker_id:id,provider:w.provider});
          this.update(id, (current) => {
            delete current.current_activity;
            if (!stopped(current) && current.quit_mode !== "now") {
              current.state = "needs_attention";
              current.issue =
                error instanceof PoolError
                  ? error.issue
                  : {
                      code: "preparation_failed",
                      message:
                        "The base model transfer failed. Retry preparation or the local fallback after checking your connection and storage.",
                      retryable: true,
                    };
            }
          });
        })
        .finally(() => {
          this.inFlight.delete(id);
          void this.tick();
        });
      this.inFlight.set(id, task);
    } else if (action === "retry_preparation" || action === "omit_loras") {
      if ((w.adapters_frozen ?? w.ready) || w.current_job_id)
        throw Error(
          "Adapter preparation is frozen after the worker becomes ready. Start a new worker for new LoRAs.",
        );
      if (
        action === "omit_loras" &&
        (!paths?.length ||
          paths.some(
            (p) =>
              !w.preparation?.files.some(
                (f) => f.path === p && f.optional && f.error && !f.omitted,
              ),
          ))
      )
        throw Error("Choose failed optional LoRAs to omit.");
      if (this.inFlight.has(id))
        throw Error("Wait for the current worker check to finish.");
      const task = (async () => {
        const health = await this.dependencies.worker.prepare(
          w,
          action === "retry_preparation" ? { retry: true } : { omit: paths },
        );
        this.update(id, (current) => {
          if (stopped(current) || current.quit_mode === "now") return;
          current.preparation = health.preparation;
      if(current.current_job_id && health.active_job_id===current.current_job_id)current.current_activity=health.activity;
      else if(current.current_activity!=='Downloading base models through this PC')delete current.current_activity;
          current.preparation_revision = health.revision ?? current.preparation_revision;
          current.state = "preparing";
          current.issue = undefined;
        });
      })().finally(() => this.inFlight.delete(id));
      this.inFlight.set(id, task);
      await task;
      void this.tick();
    } else throw Error("Unknown worker action.");
    return this.snapshot();
  }
  async actionAll(action: "finish" | "quit") {
    if (!["finish", "quit"].includes(action))
      throw Error("Choose a quit action.");
    const workers = this.all().filter((w) => !stopped(w)),
      cutoff = this.date();
    if (action === "finish") {
      this.db.transaction(() => {
        for (const w of workers)
          this.update(w.id, (current) => {
            if (current.quit_mode !== "now") {
              current.quit_mode = "finish";
              current.finish_before ??= cutoff;
              current.state = "finishing";
            }
          });
      })();
      void this.tick();
    } else {
      this.cancelJobs();
      for (const w of workers) await this.action(w.id, action);
    }
    return this.snapshot();
  }
  private releaseNow(id: string) {
    if (this.quitting.has(id) || this.now() < (this.releaseChecks.get(id) ?? 0)) return;
    const task = (async () => {
      let w = this.get(id)!;
      if (stopped(w)) return;
      this.update(id, (current) => {
        current.state = "releasing";
      });
      // Stop local transfers immediately; provider termination does not depend
      // on SSH health, a model download, or an output-save operation finishing.
      void this.dependencies.worker.disconnect(w).catch(error => this.diagnostics?.error('worker.disconnect',error,{worker_id:w.id,provider:w.provider}));
      if (!w.create_sent && !w.resource) {
        this.markReleased(id);
        return;
      }
      const driver = this.dependencies.providers[w.provider];
      const found = await driver.find(w);
      w = this.get(id)!;
      if (!found) {
        if (w.resource) {
          this.markReleased(id);
          return;
        }
        throw new PoolError({
          code: "launch_uncertain",
          message:
            "Waiting for the provider to resolve this launch. Any rental that appears will be terminated automatically.",
          retryable: true,
        });
      }
      this.update(id, (current) => {
        current.resource = found;
        current.provider_id = found.id;
        current.delete_sent = true;
      });
      w = this.get(id)!;
      await driver.destroy(w);
      const remaining = await driver.find(w);
      if (remaining)
        throw new PoolError({
          code: "release_pending",
          message:
            "The provider is still terminating this rental. Charges remain estimated until termination is confirmed.",
          retryable: true,
        });
      this.markReleased(id);
    })()
      .catch((error) => {
        if(error instanceof PoolError && error.issue.code==='rate_limited')
          this.releaseChecks.set(id,this.now()+(error.retryAfterMs??5000));
        this.diagnostics?.error('worker.release',error,{worker_id:id});
        this.update(id, (w) => {
          if (!stopped(w)) {
            w.state = "releasing";
            const issue = poolIssue(error, id);
            w.issue = {
              ...issue,
              code: "termination_unconfirmed",
              message: `Termination is not confirmed. ${error instanceof PoolError ? issue.message + " " : ""}This rental may still be billed; Seed will keep checking.`,
              action: "Open provider console",
            };
          }
        });
      })
      .finally(() => this.quitting.delete(id));
    this.quitting.set(id, task);
  }
  private markReleased(id: string, message?: string) {
    const worker = this.update(id, (w) => {
      w.state = "released";
      w.released_at = this.date();
      w.ready = false;
      delete w.current_activity;
      w.issue = message
        ? { code: "rental_gone", message, retryable: false }
        : undefined;
    });
    if (worker)
      void this.dependencies.worker.disconnect(worker).catch(error => this.diagnostics?.error('worker.disconnect',error,{worker_id:worker.id,provider:worker.provider}));
  }
  compatible(
    w: RentalRecord,
    role: WorkerClass,
    loras: LoraSelection[],
    created_at: string,
  ) {
    return (
      w.worker_class === role &&
      w.ready &&
      ["ready", "finishing", "generating", "saving"].includes(w.state) &&
      w.quit_mode !== "now" &&
      (!w.finish_before || created_at <= w.finish_before) &&
      loras.every((l) =>
        w.installed_loras.some(
          (i) => i.id === l.id && i.revision === l.revision,
        ),
      )
    );
  }
  claim(
    job: string,
    role: WorkerClass,
    loras: LoraSelection[],
    created_at: string,
    workflow?: string,
  ) {
    return this.db.transaction(() => {
      const w = this.all().find(
        (w) => !w.current_job_id && this.compatible(w, role, loras, created_at) && (workflow!=='image-to-image'||w.workflows?.includes(workflow)),
      );
      if (!w) return null;
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO job_attempts VALUES (?,?,?,?,?)")
        .run(
          id,
          job,
          w.id,
          "active",
          JSON.stringify({
            id,
            job_id: job,
            worker_id: w.id,
            created_at: this.date(),
          }),
        );
      w.current_job_id = job;
      w.state = "generating";
      this.save(w);
      return w;
    })();
  }
  assigned(job: string) {
    return this.all().find((w) => w.current_job_id === job) ?? null;
  }
  saving(job: string) {
    const w = this.assigned(job);
    if (w && !stopped(w))
      this.update(w.id, (current) => {
        current.state = "saving";
      });
  }
  complete(job: string) {
    const w = this.assigned(job);
    if (!w) return;
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE job_attempts SET state='finished' WHERE job_id=? AND state='active'",
        )
        .run(job);
      this.update(w.id, (current) => {
        delete current.current_job_id;
        if (!stopped(current) && current.quit_mode !== "now")
          current.state =
            current.quit_mode === "finish"
              ? "finishing"
              : current.ready
                ? "ready"
                : "reconnecting";
      });
    })();
  }
  async beforeCredentialChange(
    field: CredentialField,
    next: string | null,
    _previous: string,
  ) {
    const provider =
      field === "vastApiKey"
        ? "vast"
        : field === "runpodApiKey"
          ? "runpod"
          : null;
    if (!provider) return;
    const workers = this.all().filter(
      (w) => w.provider === provider && !stopped(w),
    );
    if (!workers.length) return;
    if (!next)
      throw Error(
        "Quit all workers from this provider before removing its key.",
      );
    const validate = this.dependencies.providers[provider].validateCredential;
    if (!validate)
      throw Error(
        "This provider cannot verify replacement keys while workers are active. Quit those workers first.",
      );
    await validate.call(this.dependencies.providers[provider], next, workers);
  }
  async withCredentialChange(
    field: CredentialField,
    next: string | null,
    previous: string,
    commit: () => void,
  ) {
    const provider =
      field === "vastApiKey"
        ? "vast"
        : field === "runpodApiKey"
          ? "runpod"
          : null;
    if (!provider) {
      commit();
      return;
    }
    if (this.changingCredentials.has(provider))
      throw Error("Wait for the current provider credential update to finish.");
    // Freeze new purchases before yielding. Existing create calls finish using
    // the current key, then the replacement must still own every rental.
    this.changingCredentials.add(provider);
    try {
      await Promise.allSettled(
        [...this.inFlight.entries()]
          .filter(([id]) => this.get(id)?.provider === provider)
          .map(([, task]) => task),
      );
      await this.beforeCredentialChange(field, next, previous);
      commit();
      this.startupLogs.credentialsChanged();
    } finally {
      this.changingCredentials.delete(provider);
      void this.tick();
    }
  }
}
