import {
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  openAsBlob,
  createReadStream,
  statSync,
} from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { transferFetch, WorkerHttpError, TransferIntegrityError } from './worker-transfer.js';
import type { StudioPaths } from "./storage.js";
import {Upload} from 'tus-js-client';
import {boundedText} from './diagnostics.js';
import type {ModelSource} from './pool-contracts.js';
import {validateBaseModel} from './base-model-transfer.js';
export type WorkerStatus = {
  execution_activity?: {phase:string;percent?:number};
  active_prompt_id?: string | null;
  worker_class: "image"|"video";
  runtime_revision: string;
  installed_loras: Array<{filename:string;sha256:string;routes:string[]}>;
  protocol_version: 2;
  worker_instance_id: string;
  workspace_id: string;
  state: "preparing" | "ready" | "busy";
  engine_session_id: string | null;
  preparation: {
    phase: string;
    bytes_done?: number;
    bytes_total?: number;
    error: { message: string } | null;
  };
};
type Connection = {
  endpoint: string;
  reconnect_required?: boolean;
  worker_credential: string;
  worker_instance_id: string;
  workspace_id: string;
  protocol_version: 2;
};
export function validateWorkerEndpoint(
  value: unknown,
  localTestOrigin?: string,
): string {
  if (typeof value !== "string") throw new Error("Invalid worker address.");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("Invalid worker address.");
  // The normal app supports only the fixed, loopback-only Seed SSH tunnel.
  if (url.origin === "http://127.0.0.1:18080") return url.origin;
  if (
    localTestOrigin &&
    url.origin === localTestOrigin &&
    url.hostname === "127.0.0.1" &&
    url.protocol === "http:"
  )
    return url.origin;
  throw new Error('Use the private Seed SSH worker address.');
}
async function jsonRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    const text=await boundedText(response,64*1024);let detail:unknown=text;
    try{detail=JSON.parse(text);}catch{}
    throw new WorkerHttpError(response.status,detail);
  }
  if (!response.body) throw new Error("Empty worker response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw new Error("Worker response too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function validConnection(value: unknown): value is Connection {
  const c = value as Connection | null;
  return Boolean(
    c &&
      c.protocol_version === 2 &&
      typeof c.worker_credential === "string" &&
      /^[\w-]{32,256}$/.test(c.worker_credential) &&
      typeof c.worker_instance_id === "string" &&
      typeof c.workspace_id === "string",
  );
}
export class WorkerConnection {
  private connection: Connection | null = null;
  private readonly file: string;
  private revision = 0;
  private changing = false;
  private verified = false;
  private verificationError: Error | null = null;
  private cached: { at: number; value: WorkerStatus | null } | null = null;
  private inFlight: Promise<WorkerStatus | null> | null = null;
  constructor(
    paths: StudioPaths,
    private readonly localTestOrigin?: string,
  ) {
    this.file = path.join(paths.config, "worker-connection.json");
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8"));
      if (!validConnection(value))
        throw new Error("Invalid saved worker connection.");
      // Only the retired Seed tailnet format is eligible for this one-time upgrade.
      const legacy = /^http:\/\/100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d):8080\/?$/.test(value.endpoint);
      if (legacy) {
        value.endpoint = localTestOrigin ?? 'http://127.0.0.1:18080';
        value.reconnect_required = true;
      }
      value.endpoint = validateWorkerEndpoint(value.endpoint, localTestOrigin);
      const obsolete = value as Connection & { tailscale_endpoint?: string; tailscale_peer?: string; route?: string };
      const changed = legacy || ['tailscale_endpoint', 'tailscale_peer', 'route'].some(field => Object.hasOwn(value, field));
      delete obsolete.tailscale_endpoint; delete obsolete.tailscale_peer; delete obsolete.route;
      if (changed) this.save(value);
      this.connection = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Saved worker connection is invalid. Repair its configuration before reconnecting; existing jobs and credentials have been preserved.",
        );
    }
  }
  get connected() {
    return this.connection !== null;
  }
  get identity() {
    return this.connection
      ? {
          workspace_id: this.connection.workspace_id,
          worker_instance_id: this.connection.worker_instance_id,
        }
      : null;
  }
  private save(connection: Connection) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.file);
    } finally { rmSync(temporary, { force: true }); }
  }
  private async requireVerified() {
    const connection = this.connection;
    if (!connection) throw new Error('Connect a pod first.');
    if (this.changing || connection.reconnect_required) throw new Error('Reconnect the recorded worker over SSH first.');
    if (!this.verified) await this.status();
    if (connection !== this.connection || !this.verified)
      throw this.verificationError ?? new Error('Worker identity has not been verified.');
    return connection;
  }
  async upload(jobId: string, file: string, filename: string, signal?: AbortSignal) {
    const connection = await this.requireVerified();
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file, { signal })) digest.update(chunk);
    const sha256 = digest.digest('hex'), size = statSync(file).size;
    const form = new FormData();
    form.append("image", await openAsBlob(file), filename);
    form.append("subfolder", "seed/" + jobId);
    form.append("type", "input");
    form.append("overwrite", "true");
    const response = await transferFetch(connection.endpoint + "/comfy/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + connection.worker_credential,
        'X-Seed-Input-SHA256': sha256, 'X-Seed-Input-Size': String(size) },
      body: form,
      signal,
      redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); throw new WorkerHttpError(response.status); }
    const result = await response.json();
    if (
      result.name !== filename ||
      result.subfolder !== "seed/" + jobId ||
      result.type !== "input" || result.size !== size || result.sha256 !== sha256
    )
      throw new TransferIntegrityError("Worker could not verify the uploaded reference.");
  }
  /** A single resumable tus attempt, scoped to this worker's pinned base manifest. */
  async uploadModel(item:ModelSource,file:string,signal?:AbortSignal){
    validateBaseModel(item);signal?.throwIfAborted();
    if(statSync(file).size!==item.size)throw new TransferIntegrityError('Cached model size changed.');
    const connection=await this.requireVerified();
    const route='/worker/v1/model-uploads/'+createHash('sha256').update(item.path).digest('hex');
    const created=await this.json(route,{method:'POST',body:{},signal});
    if(created.ready===true)return;
    if(created.upload_path!==route)throw new TransferIntegrityError('Worker returned an unexpected model upload address.');
    const input=createReadStream(file);
    let upload:Upload|undefined,timer:ReturnType<typeof setTimeout>|undefined,stopping:Promise<void>|undefined;
    try{
      await new Promise<void>((resolve,reject)=>{
        let settled=false;
        const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
        const stop=(error:unknown)=>{if(settled||stopping)return;clearTimeout(timer);stopping=Promise.resolve(upload?.abort(false)).then(()=>finish(error),()=>finish(error));};
        const cancel=()=>stop(signal?.reason??new DOMException('Model transfer cancelled','AbortError'));
        let verifying=false;
        const progress=()=>{clearTimeout(timer);timer=setTimeout(()=>stop(new Error('Model upload stopped making progress.')),verifying?300000:30000);timer.unref?.();};
        input.on('error',()=>stop(new Error('Cannot read the cached model file.')));
        // The node tus implementation recognizes ReadStream.path as a seekable
        // source, so its authoritative HEAD offset does not require buffering.
        upload=new Upload(input as any,{
          uploadUrl:connection.endpoint+route,uploadSize:item.size,chunkSize:8*1024*1024,retryDelays:null,
          storeFingerprintForResuming:false,headers:{Authorization:'Bearer '+connection.worker_credential},
          onBeforeRequest:request=>{if(request.getURL()!==connection.endpoint+route)throw new TransferIntegrityError('Model upload left the paired worker.');},
          onProgress:(sent,total)=>{verifying=sent===total;progress();},
          onAfterResponse:(_request,response)=>{
            progress();const length=response.getHeader('Upload-Length'),offset=response.getHeader('Upload-Offset');
            if(length!==null&&length!==undefined&&Number(length)!==item.size||offset!==null&&offset!==undefined&&(!/^\d+$/.test(offset)||Number(offset)>item.size))stop(new TransferIntegrityError('Worker returned an invalid model upload offset.'));
          },
          onSuccess:()=>finish(),
          onError:error=>{const status='originalResponse' in error?(error.originalResponse as {getStatus?:()=>number}|undefined)?.getStatus?.():undefined;finish(status?new WorkerHttpError(status):new Error('Model upload was interrupted. Retry to resume it.'));},
        });
        signal?.addEventListener('abort',cancel,{once:true});
        if(signal?.aborted){cancel();return;}
        progress();try{upload.start();}catch{stop(new Error('Cannot start the model upload.'));}
      });
    }finally{clearTimeout(timer);await stopping;input.destroy();}
    signal?.throwIfAborted();
    // Reconcile a completed/lost PATCH response and require worker-side SHA proof.
    const completed=await this.json(route,{method:'POST',body:{},signal});
    if(completed.ready!==true)throw new TransferIntegrityError('Worker has not verified the transferred model.');
  }
  async request(
    route: string,
    options: {
      method?: string;
      body?: unknown;
      session?: string;
      range?: number;
      signal?: AbortSignal;
      beforePost?: () => void;
      onPostInvoked?: () => void;
    } = {},
  ) {
    const connection = await this.requireVerified();
    if (
      !/^\/(comfy\/(session|queue|capabilities|prompt|cancel)|worker\/v1\/(jobs(?:[/?].*)?|preparation(?:\/omit)?|model-uploads\/[a-f0-9]{64}))$/.test(
        route,
      )
    )
      throw new Error("Unsupported worker operation.");
    const send = options.range !== undefined ? transferFetch : fetch;
    const init: RequestInit = {
      method: options.method ?? "GET",
      redirect: "error",
      signal: options.range !== undefined ? options.signal : AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        AbortSignal.timeout(route.startsWith('/worker/v1/model-uploads/') ? 300000 : route === "/comfy/prompt" ? 65000 : 10000),
      ]),
      headers: {
        Authorization: `Bearer ${connection.worker_credential}`,
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.session
          ? { "X-Studio-Engine-Session": options.session }
          : {}),
        ...(options.range ? { Range: `bytes=${options.range}-` } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    };
    // The owner can still cancel while connection verification is awaiting I/O.
    // Recheck at the actual HTTP boundary, with no await between fence and send.
    if (route === "/comfy/prompt" && options.method === "POST")
      options.beforePost?.();
    const response = send(connection.endpoint + route, init);
    if (route === "/comfy/prompt" && options.method === "POST")
      options.onPostInvoked?.();
    return response;
  }
  async json(
    route: string,
    options: { method?: string; body?: unknown; session?: string; signal?: AbortSignal; beforePost?: () => void; onPostInvoked?: () => void } = {},
  ) {
    const response = await this.request(route, options);
    if (!response.ok) {
      await response.body?.cancel();
      throw new WorkerHttpError(response.status);
    }
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 1024 * 1024) throw new Error("Worker response too large.");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async pair(encoded: string) {
    if (this.changing)
      throw new Error("A connection change is already in progress.");
    this.changing = true;
    try {
      if (
        !encoded.startsWith("studio1.") ||
        encoded.length > 4096 ||
        !/^[\w-]+$/.test(encoded.slice(8))
      )
        throw new Error("Paste a complete connection code.");
      let payload;
      try {
        payload = JSON.parse(
          Buffer.from(encoded.slice(8), "base64url").toString("utf8"),
        );
      } catch {
        throw new Error("Invalid connection code.");
      }
      if (
        payload.version !== 1 ||
        !Number.isInteger(payload.expires_at) ||
        payload.expires_at <= Date.now() / 1000 ||
        payload.expires_at > Date.now() / 1000 + 330 ||
        typeof payload.exchange_token !== "string" ||
        !/^[\w-]{32,256}$/.test(payload.exchange_token)
      )
        throw new Error(
          "Connection code is invalid or expired. Create a fresh code.",
        );
      const endpoint = validateWorkerEndpoint(
        payload.endpoint,
        this.localTestOrigin,
      );
      if (endpoint !== 'http://127.0.0.1:18080' && endpoint !== this.localTestOrigin)
        throw new Error('Initial pairing requires the private SSH bootstrap.');
      let result;
      try {
        result = await jsonRequest(endpoint + "/worker/v1/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exchange_token: payload.exchange_token }),
        });
      } catch {
        throw new Error(
          "Could not exchange this code. Create a fresh code on the worker and try again.",
        );
      }
      if (!validConnection({ ...result, endpoint }))
        throw new Error(
          "Worker protocol is incompatible. Create a new code after updating the worker.",
        );
      const saved: Connection = {
        endpoint,
        worker_credential: result.worker_credential,
        worker_instance_id: result.worker_instance_id,
        workspace_id: result.workspace_id,
        protocol_version: 2,
      };
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(saved), {
          mode: 0o600,
          flag: "wx",
        });
        renameSync(temporary, this.file);
      } catch {
        rmSync(temporary, { force: true });
        throw new Error(
          "Could not save this connection. Create a fresh code after checking local storage.",
        );
      }
      this.connection = saved;
      this.verified = false;
      this.verificationError = null;
      this.revision++;
      this.cached = null;
      this.inFlight = null;
    } finally {
      this.changing = false;
    }
  }
  forget() {
    if (this.changing)
      throw new Error("A connection change is already in progress.");
    rmSync(this.file, { force: true });
    this.connection = null;
    this.verified = false;
    this.verificationError = null;
    this.revision++;
    this.cached = null;
    this.inFlight = null;
  }
  async reconnect() {
    if (this.changing || !this.connection) throw new Error('Connect the recorded worker first.');
    this.changing = true;
    this.verified = false;
    try {
      const current = this.connection;
      const endpoint = this.localTestOrigin ?? 'http://127.0.0.1:18080';
      const status = await jsonRequest(endpoint + '/worker/v1/status', {
        headers: { Authorization: 'Bearer ' + current.worker_credential },
      });
      if (status.protocol_version !== current.protocol_version ||
          status.worker_instance_id !== current.worker_instance_id || status.workspace_id !== current.workspace_id)
        throw new Error('The SSH tunnel does not lead to the recorded worker.');
      const saved = { ...current, endpoint, reconnect_required: false };
      this.save(saved);
      this.connection = saved;
      this.verified = true;
      this.verificationError = null;
      this.revision++;
    } finally {
      this.cached = null;
      this.inFlight = null;
      this.changing = false;
    }
  }
  async status(options: { fresh?: boolean } = {}): Promise<WorkerStatus | null> {
    if (!this.connection || this.connection.reconnect_required || this.changing) return null;
    if (!options.fresh && this.cached && Date.now() - this.cached.at < 2000)
      return this.cached.value;
    if (this.inFlight) return this.inFlight;
    const connection = this.connection,
      revision = this.revision;
    const promise = (async () => {
      let value: WorkerStatus | null = null;
      let failure: Error | null = null;
      try {
        const result = await jsonRequest(
          connection.endpoint + "/worker/v1/status",
          {
            headers: {
              Authorization: `Bearer ${connection.worker_credential}`,
            },
          },
        );
        if (
          result.protocol_version !== 2 ||
          result.workspace_id !== connection.workspace_id ||
          result.worker_instance_id !== connection.worker_instance_id ||
          !["preparing", "ready", "busy"].includes(result.state) ||
          (result.state !== "preparing" &&
            typeof result.engine_session_id !== "string")
        )
          throw new TransferIntegrityError("Unexpected worker identity.");
        value = {
          active_prompt_id: result.active_prompt_id, worker_class: result.worker_class, runtime_revision: result.runtime_revision, installed_loras: result.installed_loras??[],
          protocol_version: 2,
          workspace_id: result.workspace_id,
          worker_instance_id: result.worker_instance_id,
          state: result.state,
          engine_session_id:
            typeof result.engine_session_id === "string"
              ? result.engine_session_id
              : null,
          preparation: {
            phase:
              typeof result.preparation?.phase === "string"
                ? result.preparation.phase.slice(0, 200)
                : "starting",
            error:
              typeof result.preparation?.error?.message === "string"
                ? { message: result.preparation.error.message.slice(0, 500) }
                : null,
            ...(Number.isFinite(result.preparation?.bytes_done)
              ? { bytes_done: result.preparation.bytes_done }
              : {}),
            ...(Number.isFinite(result.preparation?.bytes_total)
              ? { bytes_total: result.preparation.bytes_total }
              : {}),
          },
        };
      } catch (error) {
        failure = error instanceof Error ? error : new Error("Worker identity check failed.");
      }
      if (revision !== this.revision) return null;
      this.verified = value !== null;
      this.verificationError = failure;
      this.cached = { at: Date.now(), value };
      return value;
    })();
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      if (this.inFlight === promise) this.inFlight = null;
    }
  }
}
