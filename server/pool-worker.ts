import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  renameSync,
  createReadStream,
} from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import type { StudioPaths } from "./storage.js";
import type {
  RentalRecord,
  WorkerDriver,
  WorkerHealth,
  WorkerProbe,
  WorkerOutput,
  WorkerReceipt,
} from "./pool-contracts.js";
import { WorkerConnection } from "./worker.js";
import { WorkerHttpError, TransferIntegrityError } from "./worker-transfer.js";
import { credential } from "./credential-store.js";
import { PoolError, WorkerStarting } from "./pool-errors.js";
import { downloadAndRelayBaseModel } from "./base-model-transfer.js";
import type {Diagnostics} from './diagnostics.js';

const exec = promisify(execFile);
type Session = {
  child: ChildProcess;
  connection: WorkerConnection;
  origin: string;
  startedAt: number;
  ready?: boolean;
  error?: string;
};
type Auth = { port: number; pairing_secret: string };
/** One private SSH key, trusted-host file, loopback port and pairing per rental. */
export class PoolWorkerDriver implements WorkerDriver {
  private sessions = new Map<string, Session>();
  private connectionStarted = new Map<string,number>();
  private connecting = new Map<string, Promise<WorkerConnection>>();
  private transfers = new Map<string, AbortController>();
  private retired = new Set<string>();
  private closing = false;
  constructor(private paths: StudioPaths, private diagnostics?:Diagnostics) {}
  private directory(w: RentalRecord) {
    return path.join(this.paths.config, "workers", w.id);
  }
  async preflight() {
    try {
      await exec("ssh", ["-V"], { windowsHide: true, timeout: 5000 });
    } catch {
      throw new PoolError({
        code: "ssh_missing",
        message:
          "Install the OpenSSH client on this PC before starting workers.",
        retryable: false,
      });
    }
    mkdirSync(path.join(this.paths.config, "workers"), {
      recursive: true,
      mode: 0o700,
    });
  }
  async auth(w: RentalRecord) {
    const dir = this.directory(w);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = path.join(dir, "id_ed25519"),
      file = path.join(dir, "bootstrap.json");
    if (!existsSync(key))
      await exec(
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-f", key, "-N", "", "-C", `seed-${w.id}`],
        { windowsHide: true, timeout: 10000 },
      );
    if (!existsSync(file)) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = (server.address() as { port: number }).port;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      writeFileSync(
        file,
        JSON.stringify({
          port,
          pairing_secret: randomBytes(32).toString("base64url"),
        }),
        { mode: 0o600, flag: "wx" },
      );
    }
    const saved = JSON.parse(readFileSync(file, "utf8")) as Auth;
    this.diagnostics?.registerSecret(saved.pairing_secret);
    return {
      public_key: readFileSync(key + ".pub", "utf8").trim(),
      pairing_secret: saved.pairing_secret,
    };
  }
  private async connection(w: RentalRecord): Promise<WorkerConnection> {
    if (this.closing || this.retired.has(w.id))
      throw Error("Worker connection is stopping.");
    const pending = this.connecting.get(w.id);
    if (pending) return pending;
    const task = this.connect(w).finally(() => this.connecting.delete(w.id));
    this.connecting.set(w.id, task);
    return task;
  }
  private async connect(w: RentalRecord) {
    const ssh = w.resource?.ssh;
    if (
      !ssh ||
      !/^[-.a-zA-Z0-9:]+$/.test(ssh.host) ||
      ssh.host.startsWith("-") ||
      ssh.user !== "root" ||
      !Number.isInteger(ssh.port) ||
      ssh.port < 1 ||
      ssh.port > 65535
    )
      throw Error("Worker SSH is not ready.");
    const dir = this.directory(w),
      auth = JSON.parse(
        readFileSync(path.join(dir, "bootstrap.json"), "utf8"),
      ) as Auth;
    let session = this.sessions.get(w.id);
    // A short-lived ssh process may exit before the next poll. Preserve its
    // authentication/identity failure instead of replacing it with Starting.
    if(session?.error)throw new PoolError({code:'ssh_failed',message:session.error,retryable:true,action:'Reconnect'});
    if (
      session &&
      (session.child.exitCode !== null || session.child.signalCode !== null)
    ) {
      this.sessions.delete(w.id);
      session = undefined;
    }
    if (!session) {
      if(!this.connectionStarted.has(w.id))this.connectionStarted.set(w.id,Date.now());
      const origin = `http://127.0.0.1:${auth.port}`;
      const child = spawn(
        "ssh",
        [
          "-N",
          "-T",
          "-i",
          path.join(dir, "id_ed25519"),
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          // OpenSSH parses -o values as config text, even with shell:false.
          // Quote spaces inside that value; Windows profile names commonly
          // contain them. Forward slashes avoid config backslash escaping.
          `UserKnownHostsFile="${path.join(dir, "known_hosts").split(path.sep).join("/").replace(/"/g, '\\"')}"`,
          "-o",
          "ExitOnForwardFailure=yes",
          "-o",
          "ServerAliveInterval=15",
          "-o",
          "ServerAliveCountMax=3",
          "-o",
          "ConnectTimeout=10",
          "-L",
          `127.0.0.1:${auth.port}:127.0.0.1:8080`,
          "-p",
          String(ssh.port),
          `root@${ssh.host}`,
        ],
        {
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "ignore", "pipe"],
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([k]) => !/(KEY|TOKEN|SECRET|PASSWORD)/i.test(k),
            ),
          ),
        },
      );
      session = {
        child,
        startedAt: this.connectionStarted.get(w.id)!,
        connection: new WorkerConnection(
          { ...this.paths, config: dir },
          origin,
        ),
        origin,
      };
      this.sessions.set(w.id, session);
      child.on("error", (error) => {
        this.diagnostics?.error('ssh.spawn',error,{worker_id:w.id,provider:w.provider});
        if (session) session.error = "The SSH client could not start.";
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        const firstHostNotice = /^Warning: Permanently added [^\r\n]+ to the list of known hosts\.\s*$/.test(text);
        this.diagnostics?.event({category:'worker',operation:'ssh.stderr',worker_id:w.id,provider:w.provider,level:firstHostNotice?'info':'warn',data:{message:text}});
        if (
          /HOST IDENTIFICATION HAS CHANGED|Host key verification failed/.test(
            text,
          ) &&
          session
        )
          session.error =
            "The worker SSH identity changed. Verify the host in your provider console before reconnecting.";
        else if (/Permission denied/.test(text) && session)
          session.error = "SSH authentication failed for this worker.";
      });
    }
    if (session.error)
      throw new PoolError({
        code: "ssh_failed",
        message: session.error,
        retryable: false,
      });
    if (!session.ready) {
      let response: Response | undefined;
      try {
        response = await fetch(session.origin + "/worker/v1/status", {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
      } catch (cause) {
        if (Date.now() - session.startedAt < 30000)
          throw new WorkerStarting("SSH tunnel is connecting.", { cause });
        throw Error("SSH tunnel did not become reachable.", { cause });
      }
      if (response.status !== 401 && response.status !== 200)
        throw Error("Worker is starting.");
      if (session.connection.connected) await session.connection.reconnect();
      else {
        // Gateway CSRF origin is its fixed private bootstrap origin. Transport is
        // still this rental's exclusive loopback tunnel, never a provider URL.
        const headers = {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:18080",
        };
        const unlocked = await fetch(session.origin + "/worker/v1/unlock", {
          method: "POST",
          headers,
          body: JSON.stringify({ pairing_secret: auth.pairing_secret }),
          redirect: "error",
          signal: AbortSignal.timeout(7000),
        });
        if (!unlocked.ok) {
          await unlocked.body?.cancel();
          throw Error("Worker authentication failed.");
        }
        const cookie = unlocked.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join(";");
        await unlocked.body?.cancel();
        const reply = await fetch(session.origin + "/worker/v1/pairing-codes", {
          method: "POST",
          headers: { ...headers, Cookie: cookie },
          body: "{}",
          redirect: "error",
          signal: AbortSignal.timeout(7000),
        });
        if (!reply.ok) {
          await reply.body?.cancel();
          throw Error("Worker pairing failed.");
        }
        const code = ((await reply.json()) as { connection_code: string })
          .connection_code;
        if (
          typeof code !== "string" ||
          !code.startsWith("studio1.") ||
          code.length > 4096
        )
          throw Error("Invalid worker pairing response.");
        const payload = JSON.parse(
          Buffer.from(code.slice(8), "base64url").toString("utf8"),
        );
        payload.endpoint = session.origin;
        await session.connection.pair(
          "studio1." +
            Buffer.from(JSON.stringify(payload)).toString("base64url"),
        );
      }
      session.ready = true;
      this.connectionStarted.delete(w.id);
    }
    if (this.closing || this.retired.has(w.id)) {
      session.child.kill();
      this.sessions.delete(w.id);
      throw Error("Worker connection is stopping.");
    }
    return session.connection;
  }
  async prepare(
    w: RentalRecord,
    options?: { retry?: boolean; omit?: string[] },
  ): Promise<WorkerHealth> {
    const connection = await this.connection(w),
      status = await connection.status();
    if (!status)
      throw new PoolError({
        code: "connection_failed",
        message: "Cannot reach this worker. Reconnect or quit the rental; it may still be billed.",
        retryable: true,
        action: "Reconnect",
      });
    if (
      status.protocol_version !== 2 ||
      status.runtime_revision !== "seed-pool-v1" ||
      status.worker_class !== w.worker_class
    )
      throw new PoolError({
        code: "incompatible_worker",
        message:
          "The worker runtime or role does not match this rental. Quit it and start a worker using the current release.",
        retryable: false,
      });
    let prep = await connection.json("/worker/v1/preparation");
    if (options?.omit)
      prep = await connection.json("/worker/v1/preparation/omit", {
        method: "POST",
        body: { paths: options.omit, revision: prep.revision },
      });
    else if (prep.state === "waiting" || options?.retry)
      prep = await connection.json("/worker/v1/preparation", {
        method: "PUT",
        body: {
          entries: w.manifest,
          revision: prep.revision,
          credentials: {
            huggingFaceToken: credential(this.paths, "huggingFaceToken"),
            civitaiApiToken: credential(this.paths, "civitaiKey"),
          },
        },
      }).catch((error: unknown) => {
        this.diagnostics?.error('worker.preparation_request',error,{worker_id:w.id,provider:w.provider});
        if (error instanceof WorkerHttpError && [400, 409].includes(error.status))
          throw new PoolError({
            code: "preparation_failed",
            message: "The worker rejected its model preparation request. Check that Seed and the worker image use the same release before retrying.",
            retryable: false,
          });
        throw error;
      });
    let capabilities: any;
    if (status.state !== "preparing") {
      capabilities = await connection.json("/comfy/capabilities");
      if (
        capabilities.workspace_id !== connection.identity?.workspace_id ||
        capabilities.engine_session_id !== status.engine_session_id
      )
        throw new TransferIntegrityError(
          "Worker engine changed during readiness check.",
        );
    }
    const waitingForEngine = prep.state === "ready" && status.state === "preparing";
    // Existing worker timestamps describe reported transfer activity, not a
    // promise that network bytes are still moving. Older workers may omit them.
    const transferUpdates = w.manifest.flatMap(entry => {
      const file = prep.files?.find((f: any) => f.path === entry.path);
      return file?.state === 'downloading' && typeof file.updated_at === 'number' &&
        Number.isFinite(file.updated_at) && file.updated_at > 0 && file.updated_at <= 8640000000000
        ? [file.updated_at] : [];
    });
    const lastTransferUpdate = !waitingForEngine && transferUpdates.length
      ? new Date(Math.max(...transferUpdates) * 1000).toISOString() : undefined;
    const preparationError =
      prep.state === "ready" && prep.error
        ? "The worker engine failed to start or stopped. Quit this worker and start another using the current release."
        : prep.error || prep.state === "needs_source"
          ? "Model preparation failed. Retry preparation after checking credentials and available worker storage."
          : prep.state === "ready" && !waitingForEngine && capabilities?.hardware?.ready !== true
            ? "This worker's GPU does not meet the requirements for its role or could not be verified. Quit it and choose a compatible worker."
            : prep.state === "ready" && capabilities?.ready === false
              ? "This worker cannot run the required model and attention kernels. Quit it and check the worker release before starting another."
              : undefined;
    if (preparationError) this.diagnostics?.event({category:'worker',operation:'preparation.failed',worker_id:w.id,provider:w.provider,level:'error',
      data:{error:prep.error,files:prep.files?.filter((file:any)=>file.error),capabilities}});
    const health: WorkerHealth = {
      workflows: Array.isArray(capabilities?.workflows) ? capabilities.workflows.filter((w:unknown)=>typeof w==='string') : undefined,
      activity: w.worker_class==='image' && status.execution_activity ? ({loading:'Loading image models',editing:'Generating',saving:'Saving'}[status.execution_activity.phase] ?? undefined) + (Number.isFinite(status.execution_activity.percent)?` · ${status.execution_activity.percent}%`:'') : undefined,
      busy: status.state === "busy",
      active_job_id: status.active_prompt_id ?? undefined,
      ready:
        prep.state === "ready" &&
        status.state !== "preparing" &&
        capabilities?.hardware?.ready === true &&
        capabilities?.ready === true,
      session_id: status.engine_session_id ?? undefined,
      revision: prep.revision,
      installed_loras: status.installed_loras,
      preparation: {
        ...(preparationError ? { error: preparationError } : {}),
        phase: waitingForEngine ? "Starting generation engine" : prep.phase ?? "Preparing worker",
        stage: waitingForEngine ? "starting_engine" : prep.stage,
        bytes_per_second: waitingForEngine ? 0 : prep.bytes_per_second,
        eta_seconds: waitingForEngine ? null : prep.eta_seconds,
        stalled: !waitingForEngine && prep.stalled === true,
        ...(lastTransferUpdate ? { last_transfer_update_at: lastTransferUpdate } : {}),
        bytes_done: prep.bytes_done ?? 0,
        bytes_total: prep.bytes_total ?? 0,
        files: w.manifest.map((entry) => {
          const file = prep.files?.find((f: any) => f.path === entry.path);
          return {
            path: entry.path,
            name: path.posix.basename(entry.path),
            state: file?.state,
            optional: Boolean(entry.routes),
            ready: Boolean(file?.ready),
            omitted: prep.omitted_paths?.includes(entry.path) ?? false,
            bytes: file?.bytes_done ?? 0,
            total: entry.size,
            ...(file?.error
              ? {
                  error:
                    typeof file.error === "string"
                      ? file.error
                      : "Download failed. Retry preparation.",
                }
              : {}),
          };
        }),
      },
    };
    return health;
  }
  async probe(w: RentalRecord): Promise<WorkerProbe> {
    // Recovery must verify an existing pairing, never learn a replacement's
    // identity via connect()'s first-time pairing path.
    let original: { workspace_id: string; worker_instance_id: string };
    try {
      const saved = JSON.parse(readFileSync(path.join(this.directory(w), "worker-connection.json"), "utf8"));
      if (saved.protocol_version !== 2 || typeof saved.workspace_id !== "string" || !saved.workspace_id ||
        typeof saved.worker_instance_id !== "string" || !saved.worker_instance_id) throw Error();
      original = { workspace_id: saved.workspace_id, worker_instance_id: saved.worker_instance_id };
    } catch {
      throw new TransferIntegrityError("The original worker identity is unavailable. Recovery cannot pair a new worker.");
    }
    const connection = await this.connection(w);
    if (connection.identity?.workspace_id !== original.workspace_id || connection.identity?.worker_instance_id !== original.worker_instance_id)
      throw new TransferIntegrityError("The connection does not match the recorded original worker.");
    const status = await connection.status({ fresh: true });
    if (!status)
      throw new PoolError({
        code: "connection_failed",
        message: "Cannot verify the original worker. Reconnect it before retrying this request.",
        retryable: true,
        action: "Reconnect",
      });
    if (
      status.protocol_version !== 2 ||
      status.runtime_revision !== "seed-pool-v1" ||
      status.worker_class !== w.worker_class ||
      status.workspace_id !== original.workspace_id ||
      status.worker_instance_id !== original.worker_instance_id
    )
      throw new TransferIntegrityError("The original worker identity or runtime does not match.");
    return {
      state: status.state,
      session_id: status.engine_session_id,
      active_job_id: status.active_prompt_id ?? undefined,
      workspace_id: status.workspace_id,
      worker_instance_id: status.worker_instance_id,
    };
  }
  async upload(w: RentalRecord, job: string, file: string, name: string) {
    await (await this.connection(w)).upload(job, file, name);
  }
  async fallbackBaseModels(w: RentalRecord) {
    if (
      w.adapters_frozen ||
      w.ready ||
      w.current_job_id ||
      w.quit_mode === "now"
    )
      throw Error(
        "Base models can only be transferred before this worker becomes ready.",
      );
    if (this.transfers.has(w.id))
      throw Error("A base model transfer is already running.");
    const controller = new AbortController();
    this.transfers.set(w.id, controller);
    try {
      const connection = await this.connection(w);
      const missing = w.manifest.filter(
        (item) =>
          !item.routes &&
          !item.path.startsWith("loras/") &&
          !w.preparation?.files.some(
            (file) => file.path === item.path && file.ready,
          ),
      );
      for (const item of missing) {
        controller.signal.throwIfAborted();
        await downloadAndRelayBaseModel(
          item,
          this.paths,
          connection,
          credential(this.paths, "huggingFaceToken"),
          controller.signal,
        );
      }
    } finally {
      if (this.transfers.get(w.id) === controller) this.transfers.delete(w.id);
    }
  }
  async submit(w: RentalRecord, body: Record<string, unknown>, options: { beforePost?: () => void } = {}) {
    const started = Date.now();
    let stage: "connection" | "identity_verification" | "submission_gate" | "submission_post" = "connection";
    let postInvoked = false;
    // Only controlled values enter these events. Error names can also contain
    // user data, so never copy an arbitrary name, message, cause or response.
    const observe = (outcome: "started" | "invoked" | "succeeded" | "failed", error?: unknown) => {
      const errorClass = error instanceof WorkerHttpError ? "WorkerHttpError"
        : error instanceof TransferIntegrityError ? "TransferIntegrityError"
        : error instanceof PoolError ? "PoolError"
        : error instanceof Error && ["Error", "TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(error.name) ? error.name
        : error === undefined ? undefined : "UnknownError";
      this.diagnostics?.event({
        category: "job", operation: "submission.transport", worker_id: w.id,
        level: outcome === "failed" ? "warn" : "info",
        data: {
          job_id: typeof body.prompt_id === "string" ? body.prompt_id : undefined,
          stage, outcome, post_invoked: postInvoked, elapsed_ms: Date.now() - started,
          ...(errorClass ? { error_class: errorClass } : {}),
          ...(error instanceof WorkerHttpError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? { status: error.status } : {}),
        },
      });
    };
    try {
      observe("started");
      const connection = await this.connection(w);
      stage = "identity_verification";
      observe("started");
      await connection.json("/comfy/prompt", {
        method: "POST", body, session: w.session_id,
        beforePost: () => {
          observe("succeeded");
          stage = "submission_gate";
          options.beforePost?.();
        },
        onPostInvoked: () => {
          observe("succeeded");
          stage = "submission_post";
          postInvoked = true;
          observe("invoked");
        },
      });
      observe("succeeded");
    } catch (error) {
      observe("failed", error);
      throw error;
    }
  }
  async receipt(w: RentalRecord, job: string): Promise<WorkerReceipt | null> {
    const connection = await this.connection(w);
    let record: any;
    try {
      record = await connection.json("/worker/v1/jobs/" + job);
    } catch (error) {
      if (error instanceof WorkerHttpError && error.status === 404) return null;
      throw error;
    }
    if (
      record.submission?.job_id !== job ||
      record.submission?.workspace_id !== connection.identity?.workspace_id
    )
      throw new TransferIntegrityError("Worker job identity does not match.");
    if (record.manifest) {
      if (
        typeof record.manifest_bytes !== "string" ||
        createHash("sha256").update(record.manifest_bytes).digest("hex") !==
          record.manifest_digest
      )
        throw new TransferIntegrityError("Output manifest integrity failed.");
      const manifest = JSON.parse(record.manifest_bytes);
      if (
        manifest.job_id !== job ||
        manifest.workspace_id !== connection.identity?.workspace_id ||
        manifest.engine_session_id !== record.submission.engine_session_id ||
        !["completed", "failed", "cancelled"].includes(manifest.state) ||
        !Array.isArray(manifest.outputs)
      )
        throw new TransferIntegrityError("Output identity does not match.");
      record.manifest = manifest;
    }
    return record;
  }
  async cancel(w: RentalRecord, job: string) {
    await (
      await this.connection(w)
    ).json("/comfy/cancel", {
      method: "POST",
      body: { job_id: job },
      session: w.session_id,
    });
  }
  async download(
    w: RentalRecord,
    job: string,
    output: WorkerOutput,
    target: string,
  ) {
    if (
      !/^\d+$/.test(output.id) ||
      !Number.isSafeInteger(output.size) ||
      output.size <= 0 ||
      output.size > 20 * 1024 ** 3 ||
      !/^[a-f0-9]{64}$/.test(output.sha256)
    )
      throw new TransferIntegrityError("Invalid output manifest.");
    const partial = target + ".part";
    let offset = existsSync(partial) ? statSync(partial).size : 0;
    if (offset > output.size) offset = 0;
    const connection = await this.connection(w);
    if (offset < output.size) {
      const response = await connection.request(
        `/worker/v1/jobs/${job}/outputs/${output.id}`,
        { range: offset },
      );
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new WorkerHttpError(response.status);
      }
      if (response.status === 200) offset = 0;
      if (
        offset &&
        response.headers.get("Content-Range") !==
          `bytes ${offset}-${output.size - 1}/${output.size}`
      ) {
        await response.body.cancel();
        throw new TransferIntegrityError("Invalid output range.");
      }
      const file = await open(partial, offset ? "a" : "w", 0o600);
      try {
        for await (const chunk of response.body) {
          offset += chunk.length;
          if (offset > output.size)
            throw new TransferIntegrityError(
              "Output exceeded the declared size.",
            );
          await file.writeFile(chunk);
        }
        await file.sync();
      } finally {
        await file.close();
      }
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(partial)) hash.update(chunk);
    if (
      statSync(partial).size !== output.size ||
      hash.digest("hex") !== output.sha256
    ) {
      const reset = await open(partial, "w");
      await reset.close();
      throw new TransferIntegrityError("Output checksum failed.");
    }
    renameSync(partial, target);
  }
  async acknowledge(w: RentalRecord, job: string, digest: string) {
    const r = await (
      await this.connection(w)
    ).json(`/worker/v1/jobs/${job}/receipt`, {
      method: "POST",
      body: { manifest_digest: digest },
    });
    if (!r.cleanup_complete) throw Error("Worker cleanup is pending.");
  }
  async reconnect(w: RentalRecord) {
    this.connectionStarted.delete(w.id);
    if (this.closing || this.retired.has(w.id))
      throw Error("Worker connection is stopping.");
    const session = this.sessions.get(w.id);
    if (session) {
      // An SSH process can stay alive with a stalled forwarding channel.
      // Reconnect must replace that transport, retaining the saved identity.
      this.sessions.delete(w.id);
      if (session.child.exitCode === null && session.child.signalCode === null)
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 2000);
          session.child.once("exit", () => { clearTimeout(timeout); resolve(); });
          session.child.kill();
        });
    }
    await this.connecting.get(w.id)?.catch(() => {});
  }
  async disconnect(w: RentalRecord) {
    this.connectionStarted.delete(w.id);
    this.retired.add(w.id);
    this.transfers.get(w.id)?.abort();
    const session = this.sessions.get(w.id);
    if (session) {
      session.child.kill();
      this.sessions.delete(w.id);
    }
  }
  async close() {
    this.closing = true;
    for (const transfer of this.transfers.values()) transfer.abort();
    for (const session of this.sessions.values()) session.child.kill();
    this.sessions.clear();
    this.connectionStarted.clear();
  }
}
