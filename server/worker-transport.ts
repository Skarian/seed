import {createHash} from 'node:crypto';
import {existsSync,statSync,createReadStream,renameSync} from 'node:fs';
import {open} from 'node:fs/promises';
import type {WorkerConnection} from './worker.js';
import type {WorkerReceipt,WorkerOutput} from './pool-contracts.js';
import {WorkerHttpError,TransferIntegrityError} from './worker-transfer.js';
import {PoolError} from './pool-errors.js';
import type {Diagnostics} from './diagnostics.js';

/** Shared authenticated protocol, integrity checks and resumable output copy. */
export abstract class WorkerTransport<W extends {id:string;session_id?:string}> {
  constructor(protected diagnostics?:Diagnostics) {}
  protected abstract connection(worker:W):Promise<WorkerConnection>;
  async upload(w: W, job: string, file: string, name: string) {
    await (await this.connection(w)).upload(job, file, name);
  }
  async submit(w: W, body: Record<string, unknown>, options: { beforePost?: () => void } = {}) {
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
  async receipt(w: W, job: string): Promise<WorkerReceipt | null> {
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
  async cancel(w: W, job: string) {
    await (
      await this.connection(w)
    ).json("/comfy/cancel", {
      method: "POST",
      body: { job_id: job },
      session: w.session_id,
    });
  }
  async download(
    w: W,
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
  async acknowledge(w: W, job: string, digest: string) {
    const r = await (
      await this.connection(w)
    ).json(`/worker/v1/jobs/${job}/receipt`, {
      method: "POST",
      body: { manifest_digest: digest },
    });
    if (!r.cleanup_complete) throw Error("Worker cleanup is pending.");
  }
}
