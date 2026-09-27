import { it, expect, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PoolWorkerDriver } from "../server/pool-worker.js";
import { WorkerHttpError } from "../server/worker-transfer.js";
import { prepareStorage, resolvePaths } from "../server/storage.js";
import type { RentalRecord, WorkerOutput } from "../server/pool-contracts.js";
const worker = {
  id: "worker",
  worker_class: "video",
  manifest: [],
  session_id: "session",
} as unknown as RentalRecord;
async function fixture(
  fn: (
    driver: PoolWorkerDriver,
    connection: any,
    root: string,
  ) => Promise<void>,
) {
  mkdirSync(".local/tests", { recursive: true });
  const root = mkdtempSync(path.resolve(".local/tests/worker-")),
    paths = resolvePaths(root);
  prepareStorage(paths);
  const connectionDirectory=path.join(paths.config,'workers',worker.id);
  mkdirSync(connectionDirectory,{recursive:true});
  writeFileSync(path.join(connectionDirectory,'worker-connection.json'),JSON.stringify({
    protocol_version:2,workspace_id:'workspace',worker_instance_id:'instance',
  }));
  const connection = {
    identity: { workspace_id: "workspace", worker_instance_id: "instance" },
    status: vi.fn(async () => ({
      protocol_version: 2,
      runtime_revision: "seed-pool-v1",
      worker_class: "video",
      state: "ready",
      workspace_id: "workspace",
      worker_instance_id: "instance",
      engine_session_id: "session",
      installed_loras: [],
    })),
    json: vi.fn(async (route: string) =>
      route === "/worker/v1/preparation"
        ? { state: "ready", revision: 0, files: [] }
        : route === "/comfy/capabilities"
          ? {
              ready: true,
              hardware: { ready: true },
              workspace_id: "workspace",
              engine_session_id: "session",
            }
          : {},
    ),
    request: vi.fn(),
  };
  const driver = new PoolWorkerDriver(paths);
  vi.spyOn(driver as any, "connection").mockResolvedValue(connection);
  try {
    await fn(driver, connection, root);
  } finally {
    await driver.close();
    rmSync(root, { recursive: true, force: true });
  }
}
it('preserves authentication failure from an exited SSH process until reconnect',()=>fixture(async(driver,_c,root)=>{
  const paths=resolvePaths(root),dir=path.join(paths.config,'workers',worker.id);mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'bootstrap.json'),JSON.stringify({port:12345,pairing_secret:'fixture'}));
  const record={...worker,resource:{id:'rental',status:'running',ssh:{host:'127.0.0.1',port:22,user:'root'}}};
  (driver as any).sessions.set(worker.id,{child:{exitCode:255,signalCode:null,kill:vi.fn()},error:'SSH authentication failed for this worker.'});
  await expect((driver as any).connect(record)).rejects.toMatchObject({issue:{code:'ssh_failed',action:'Reconnect'}});
}));
it('probes the original engine freshly without preparing models or mutating the worker', () =>
  fixture(async (driver, c) => {
    expect(await driver.probe(worker)).toEqual({
      state: 'ready', session_id: 'session', active_job_id: undefined,
      workspace_id: 'workspace', worker_instance_id: 'instance',
    });
    expect(c.status).toHaveBeenCalledWith({fresh:true});
    expect(c.json).not.toHaveBeenCalled();
    c.status.mockResolvedValue({...await c.status(),state:'busy',active_prompt_id:'assigned-job'});
    expect(await driver.probe(worker)).toMatchObject({state:'busy',active_job_id:'assigned-job'});
    c.status.mockResolvedValue(null);
    await expect(driver.probe(worker)).rejects.toMatchObject({issue:{code:'connection_failed'}});
    expect(c.json).not.toHaveBeenCalled();
  }));
it('rejects recovery probes for mismatched worker identity, runtime or role', () =>
  fixture(async (driver, c) => {
    const status = await c.status();
    for (const change of [
      {workspace_id:'other'}, {worker_instance_id:'other'},
      {worker_class:'image'}, {protocol_version:1}, {runtime_revision:'other'},
    ]) {
      c.status.mockResolvedValue({...status,...change});
      await expect(driver.probe(worker)).rejects.toThrow('does not match');
    }
    expect(c.json).not.toHaveBeenCalled();
  }));
it('does not connect or pair when the original saved worker identity is missing or invalid', () =>
  fixture(async (driver, c, root) => {
    const file=path.join(resolvePaths(root).config,'workers',worker.id,'worker-connection.json');
    for (const saved of [undefined, '{}', '{invalid', JSON.stringify({protocol_version:2,workspace_id:'workspace'})]) {
      if(saved===undefined)rmSync(file);else writeFileSync(file,saved);
      await expect(driver.probe(worker)).rejects.toThrow('original worker identity is unavailable');
    }
    expect((driver as any).connection).not.toHaveBeenCalled();
    expect(c.status).not.toHaveBeenCalled();expect(c.json).not.toHaveBeenCalled();
  }));
it('does not probe a cached connection that differs from the recorded original identity', () =>
  fixture(async (driver, c) => {
    c.identity={workspace_id:'other',worker_instance_id:'instance'};
    await expect(driver.probe(worker)).rejects.toThrow('recorded original worker');
    expect(c.status).not.toHaveBeenCalled();expect(c.json).not.toHaveBeenCalled();
  }));
it("reports a rejected preparation request separately from connection failures", () =>
  fixture(async (driver, c) => {
    c.json.mockImplementation(async (_route: string, options?: {method?: string}) => {
      if (options?.method === 'PUT') throw new WorkerHttpError(400);
      return {state:'waiting', revision:0};
    });
    await expect(driver.prepare(worker)).rejects.toMatchObject({issue:{code:'preparation_failed',retryable:false}});
  }));
it("waits for engine startup before judging GPU capability", () =>
  fixture(async (driver, c) => {
    c.status.mockResolvedValue({protocol_version:2,runtime_revision:'seed-pool-v1',worker_class:'video',state:'preparing'});
    const health=await driver.prepare(worker);
    expect(health.ready).toBe(false);
    expect(health.preparation.error).toBeUndefined();
    expect(health.preparation.phase).toBe('Starting generation engine');
    expect(health.preparation.stage).toBe('starting_engine');
    expect(health.preparation.eta_seconds).toBeNull();
    expect(c.json).not.toHaveBeenCalledWith('/comfy/capabilities');
  }));
it('forwards live transfer measurements without treating downloaded bytes as readiness', () =>
  fixture(async (driver, c) => {
    c.status.mockResolvedValue({protocol_version:2,runtime_revision:'seed-pool-v1',worker_class:'video',state:'preparing'});
    c.json.mockResolvedValue({state:'preparing',stage:'downloading',phase:'Downloading models',revision:0,bytes_done:400,bytes_total:1000,bytes_per_second:100,eta_seconds:6,stalled:false,files:[]});
    const health=await driver.prepare(worker);
    expect(health.ready).toBe(false);
    expect(health.preparation).toMatchObject({stage:'downloading',bytes_done:400,bytes_total:1000,bytes_per_second:100,eta_seconds:6,stalled:false});
  }));
it('forwards only known active-file transfer report times, including stale reports', () =>
  fixture(async (driver, c) => {
    const at = 1750000000;
    const record = {...worker, manifest:[{path:'model',size:1000},{path:'encoder',size:500}]} as RentalRecord;
    c.status.mockResolvedValue({protocol_version:2,runtime_revision:'seed-pool-v1',worker_class:'video',state:'preparing'});
    c.json.mockResolvedValue({state:'preparing',stage:'downloading',stalled:true,files:[
      {path:'model',state:'downloading',updated_at:at},
      {path:'encoder',state:'ready',updated_at:at+100},
      {path:'not-in-manifest',state:'downloading',updated_at:at+200},
    ]});
    expect((await driver.prepare(record)).preparation.last_transfer_update_at).toBe(new Date(at*1000).toISOString());
    for (const updated_at of [undefined, '1750000000', NaN, Infinity, -1, 9e12]) {
      c.json.mockResolvedValue({state:'preparing',stage:'downloading',files:[{path:'model',state:'downloading',updated_at}]});
      expect((await driver.prepare(record)).preparation.last_transfer_update_at).toBeUndefined();
    }
    c.json.mockResolvedValue({state:'ready',stage:'pending',files:[{path:'model',state:'downloading',updated_at:at}]});
    expect((await driver.prepare(record)).preparation.last_transfer_update_at).toBeUndefined();
  }));
it("reports missing status as a connection failure and retains rental identity when replacing a stalled tunnel", () =>
  fixture(async (driver, c) => {
    c.status.mockResolvedValue(null);
    await expect(driver.prepare(worker)).rejects.toMatchObject({issue:{code:'connection_failed',retryable:true}});
    const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,kill:vi.fn()});
    child.kill.mockImplementation(()=>{child.emit('exit',0);return true;});
    (driver as any).sessions.set(worker.id,{child,connection:c,origin:'http://127.0.0.1:12345',ready:true});
    await driver.reconnect(worker);
    expect(child.kill).toHaveBeenCalledOnce();
    expect((driver as any).sessions.has(worker.id)).toBe(false);
    expect((driver as any).retired.has(worker.id)).toBe(false);
  }));
it("requires matching engine capability readiness, including the attention kernels", () =>
  fixture(async (driver, c) => {
    c.json.mockImplementation(async (route: string) =>
      route.includes("capabilities")
        ? {
            ready: false,
            hardware: { ready: true },
            workspace_id: "workspace",
            engine_session_id: "session",
          }
        : { state: "ready", revision: 0, files: [] },
    );
    const health = await driver.prepare(worker);
    expect(health.ready).toBe(false);
    expect(health.preparation.error).toContain("attention kernels");
    c.json.mockImplementation(async (route: string) =>
      route.includes("capabilities")
        ? { ready: true, workspace_id: "workspace", engine_session_id: "other" }
        : { state: "ready", revision: 0, files: [] },
    );
    await expect(driver.prepare(worker)).rejects.toThrow("engine changed");
  }));
it("does not schedule a worker with incompatible or unverified physical GPU hardware", () =>
  fixture(async (driver, c) => {
    expect((await driver.prepare(worker)).ready).toBe(true);
    for (const hardware of [{ ready: false }, undefined]) {
      c.json.mockImplementation(async (route: string) =>
        route.includes("capabilities")
          ? {
              ready: true,
              hardware,
              workspace_id: "workspace",
              engine_session_id: "session",
            }
          : { state: "ready", revision: 0, files: [] },
      );
      const health = await driver.prepare(worker);
      expect(health.ready).toBe(false);
      expect(health.preparation.error).toContain("GPU");
    }
  }));
it("surfaces failed preparation even when a subprocess failed before reporting an individual file", () =>
  fixture(async (driver, c) => {
    c.json.mockResolvedValue({
      state: "needs_source",
      revision: 0,
      files: [],
      error: { message: "private provider diagnostics" },
    });
    c.status.mockResolvedValue({
      protocol_version: 2,
      runtime_revision: "seed-pool-v1",
      worker_class: "video",
      state: "preparing",
      installed_loras: [],
    });
    const health = await driver.prepare(worker);
    expect(health.preparation.error).toContain("Model preparation failed");
    expect(JSON.stringify(health)).not.toContain(
      "private provider diagnostics",
    );
  }));
it("checks receipt identity and the original manifest bytes before accepting remote outputs", () =>
  fixture(async (driver, c) => {
    const manifest = {
        job_id: "job",
        workspace_id: "workspace",
        engine_session_id: "session",
        state: "completed",
        outputs: [],
      },
      bytes = JSON.stringify(manifest);
    c.json.mockResolvedValue({
      submission: {
        job_id: "job",
        workspace_id: "workspace",
        engine_session_id: "session",
      },
      manifest,
      manifest_bytes: bytes,
      manifest_digest: createHash("sha256").update(bytes).digest("hex"),
    });
    expect((await driver.receipt(worker, "job"))?.manifest?.state).toBe(
      "completed",
    );
    await expect(driver.receipt(worker, "different-job")).rejects.toThrow(
      "identity",
    );
    c.json.mockResolvedValue({
      submission: { job_id: "job", workspace_id: "workspace" },
      manifest,
      manifest_bytes: bytes,
      manifest_digest: "wrong",
    });
    await expect(driver.receipt(worker, "job")).rejects.toThrow("integrity");
  }));
it("resumes exact byte ranges, verifies the checksum, and publishes only a complete output", () =>
  fixture(async (driver, c, root) => {
    const bytes = Buffer.from("verified output"),
      target = path.join(root, "output.png");
    const output: WorkerOutput = {
      id: "0",
      path: "seed/job/output.png",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mime_type: "image/png",
    };
    writeFileSync(target + ".part", bytes.subarray(0, 4));
    c.request.mockResolvedValue(
      new Response(bytes.subarray(4), {
        status: 206,
        headers: {
          "Content-Range": `bytes 4-${bytes.length - 1}/${bytes.length}`,
        },
      }),
    );
    await driver.download(worker, "job", output, target);
    expect(readFileSync(target)).toEqual(bytes);
    expect(c.request.mock.calls[0][1]).toEqual({ range: 4 });
  }));
it("clears a corrupt partial file so a save retry can download clean bytes", () =>
  fixture(async (driver, c, root) => {
    const bytes = Buffer.from("good"),
      target = path.join(root, "output.png"),
      output: WorkerOutput = {
        id: "0",
        path: "output.png",
        size: 4,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mime_type: "image/png",
      };
    writeFileSync(target + ".part", "evil");
    await expect(
      driver.download(worker, "job", output, target),
    ).rejects.toThrow("checksum");
    expect(statSync(target + ".part").size).toBe(0);
    c.request.mockResolvedValue(new Response(bytes));
    await driver.download(worker, "job", output, target);
    expect(readFileSync(target)).toEqual(bytes);
  }));
