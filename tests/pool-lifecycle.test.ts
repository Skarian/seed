import { it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../server/db.js";
import { resolvePaths, prepareStorage } from "../server/storage.js";
import { Loras } from "../server/loras.js";
import { fakePool } from "./fake-pool.js";
import { PoolError, WorkerStarting } from "../server/pool-errors.js";
import { WorkerPool } from "../server/pool.js";
import { Diagnostics } from '../server/diagnostics.js';
async function fixture(
  run: (
    f: ReturnType<typeof fakePool> & {
      paths: ReturnType<typeof resolvePaths>;
      loras: Loras;
      db: ReturnType<typeof openDatabase>;
    },
  ) => Promise<void>,
) {
  mkdirSync(".local/tests", { recursive: true });
  const root = mkdtempSync(path.resolve(".local/tests/pool-lifecycle-")),
    paths = resolvePaths(root);
  prepareStorage(paths);
  const db = openDatabase(paths.data),
    fake = fakePool(db, paths);
  try {
    await run({ ...fake, paths, loras: new Loras(paths), db });
  } finally {
    await fake.pool.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
async function eventually(fn: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("Fixture operation did not settle.");
}
it('includes the role-specific base model download size in offers',()=>fixture(async f=>{
  f.deps.releases!.image!.manifest=[{path:'model',url:'https://example.test/model',sha256:'a'.repeat(64),size:123456}];
  expect((await f.pool.offers('image')).items.every(o=>o.model_download_bytes===123456)).toBe(true);
}));
it('keeps a bounded initial SSH wait in startup, then records a real connection failure', () =>
  fixture(async f => {
    f.worker.prepare.mockRejectedValueOnce(new WorkerStarting('SSH tunnel is connecting.'));
    const worker = (await f.ready())[0]!;
    expect(f.pool.get(worker.id)!.state).toBe('starting');
    expect(f.pool.get(worker.id)!.issue).toBeUndefined();
    f.worker.prepare.mockRejectedValueOnce(Error('SSH tunnel did not become reachable.'));
    await f.pool.tick();
    expect(f.pool.get(worker.id)!.state).toBe('needs_attention');
    await f.pool.tick();
    expect(f.pool.get(worker.id)!.state).toBe('ready');
  }));
it("reconnect replaces the owned transport without retiring or renting a worker", async () =>
  fixture(async (f) => {
    await f.ready();
    const first=f.pool.all()[0]!;
    await f.pool.action(first.id,'reconnect');
    expect(f.worker.reconnect).toHaveBeenCalledWith(expect.objectContaining({id:first.id}));
    expect(f.worker.disconnect).not.toHaveBeenCalled();
    expect(f.providers.vast.create).toHaveBeenCalledOnce();
    expect(f.providers.vast.destroy).not.toHaveBeenCalled();
    expect(f.pool.get(first.id)!.resource!.id).toBe(first.resource!.id);
  }));
it("persists instance access preparation and does not prepare it again after restart", async () =>
  fixture(async f => {
    const prepareAccess = vi.fn(async () => {});
    Object.assign(f.providers.vast, {prepareAccess});
    const worker = (await f.ready())[0]!;
    expect(prepareAccess).toHaveBeenCalledWith(expect.objectContaining({id:worker.id}), 'fixture-public');
    expect(f.pool.get(worker.id)!.access_prepared).toBe(true);
    const restarted = new WorkerPool(f.db, f.paths, f.loras, f.deps);
    try { await restarted.tick(); expect(prepareAccess).toHaveBeenCalledOnce(); }
    finally { await restarted.close(); }
  }));
it('defers instance SSH registration until container startup exposes SSH',()=>fixture(async f=>{
  const access=vi.fn(async()=>{});Object.assign(f.providers.vast,{prepareAccess:access});
  f.providers.vast.find.mockImplementation(async w=>{const r=f.resources.get(w.id);return r?{...r,ssh:undefined}:null;});
  const w=(await f.ready())[0]!;expect(access).not.toHaveBeenCalled();expect(f.worker.prepare).not.toHaveBeenCalled();
  f.providers.vast.find.mockImplementation(async w=>f.resources.get(w.id)??null);f.advance(15000);await f.pool.tick();
  expect(access).toHaveBeenCalledOnce();expect(f.pool.get(w.id)!.state).toBe('ready');
}));
it("keeps Quit now available when instance access preparation fails", async () =>
  fixture(async f => {
    Object.assign(f.providers.vast, {prepareAccess:vi.fn(async () => { throw Error('Access pending'); })});
    const worker = (await f.ready())[0]!;
    expect(f.worker.prepare).not.toHaveBeenCalled();
    await f.pool.action(worker.id, 'quit');
    await eventually(() => f.pool.get(worker.id)!.state==='released');
    expect(f.providers.vast.destroy).toHaveBeenCalledOnce();
  }));
it("retains idle workers and accrues startup and idle spend until provider deletion is confirmed", async () =>
  fixture(async (f) => {
    await f.ready("image", 2);
    f.advance(3600000);
    await f.pool.tick();
    expect(f.pool.snapshot().summary).toMatchObject({
      active: 2,
      hourly: 2,
      estimated_spend: 2,
    });
    expect(f.providers.vast.destroy).not.toHaveBeenCalled();
    const first = f.pool.all()[0]!;
    await f.pool.action(first.id, "quit");
    await eventually(() => f.pool.get(first.id)!.state === "released");
    f.advance(3600000);
    expect(
      f.pool.snapshot().workers.find((w) => w.id === first.id),
    ).toMatchObject({ estimated_spend: 1 });
    expect(f.pool.snapshot().summary).toMatchObject({
      active: 1,
      hourly: 1,
      estimated_spend: 2,
    });
  }));
it("keeps release charges visible while termination is uncertain and retries only that owned rental", async () =>
  fixture(async (f) => {
    await f.ready();
    const w = f.pool.all()[0]!;
    const remove = f.providers.vast.destroy.getMockImplementation()!;
    f.providers.vast.destroy.mockImplementationOnce(async () => {
      throw Error("transport lost");
    });
    await f.pool.action(w.id, "quit");
    await eventually(() => Boolean(f.pool.get(w.id)!.issue));
    f.advance(1800000);
    expect(f.pool.snapshot().summary).toMatchObject({
      active: 1,
      hourly: 1,
      estimated_spend: 0.5,
    });
    f.providers.vast.destroy.mockImplementation(remove);
    await f.pool.tick();
    await eventually(() => f.pool.get(w.id)!.state === "released");
    expect(f.providers.vast.create).toHaveBeenCalledTimes(1);
  }));
it("freezes sources per launch and includes the new catalog only on later workers", async () =>
  fixture(async (f) => {
    const first = (await f.ready())[0]!;
    f.loras.applySources(
      "fixture-group",
      [
        {
          name: "arbitrary.safetensors",
          route: "image",
          source: {
            provider: "civitai",
            model_id: 5,
            version_id: 10,
            file_id: 20,
            url: "https://civitai.com/api/download/models/10",
            sha256: "a".repeat(64),
            size_bytes: 1000,
          },
        },
      ],
      {
        name: "Watercolor",
        description: "Gentle",
        default_scale: 1,
        trigger_words: [],
        availability: "all",
        enabled: true,
      },
    );
    await f.pool.tick();
    expect(f.pool.get(first.id)!.requested_loras).toEqual([]);
    await f.ready();
    expect(f.pool.all()[1]!.installed_loras).toHaveLength(1);
    expect(f.pool.get(first.id)!.installed_loras).toEqual([]);
  }));
it("keeps successful capacity when the other provider definitively rejects a launch", async () =>
  fixture(async (f) => {
    f.providers.runpod.create.mockRejectedValue(
      new PoolError(
        {
          code: "insufficient_funds",
          message: "Insufficient provider balance.",
          retryable: false,
          provider: "runpod",
        },
        true,
      ),
    );
    const offers = await f.pool.offers("image");
    await f.pool.launch(
      {
        selections: offers.items.map((o) => ({ offer_id: o.id, quantity: 1 })),
        max_hourly: 3,
      },
      "partial-launch-fixture",
    );
    await f.pool.tick();
    expect(f.pool.all().find((w) => w.provider === "vast")!.state).toBe(
      "ready",
    );
    expect(f.pool.all().find((w) => w.provider === "runpod")!.state).toBe(
      "released",
    );
    expect(f.pool.snapshot().summary.hourly).toBe(1);
    expect(f.providers.vast.destroy).not.toHaveBeenCalled();
    f.advance(3600000);
    expect(
      f.pool.snapshot().workers.find((w) => w.provider === "runpod")!
        .estimated_spend,
    ).toBe(0);
    expect(f.pool.snapshot().summary.estimated_spend).toBe(1);
  }));
it("holds ambiguous creation for reconciliation instead of renting a duplicate", async () =>
  fixture(async (f) => {
    f.providers.vast.create.mockRejectedValue(Error("response lost"));
    await f.ready();
    await f.pool.tick();
    await f.pool.tick();
    expect(f.providers.vast.create).toHaveBeenCalledTimes(1);
    expect(f.pool.all()[0]!.state).toBe("needs_attention");
    expect(f.pool.snapshot().summary.hourly).toBe(1);
  }));
it('persists rejected-launch dismissal without altering diagnostics, billing or provider resources', () => fixture(async f => {
  f.providers.runpod.create.mockRejectedValue(new PoolError({code:'capacity_unavailable',message:'This capacity is no longer available.',retryable:true},true));
  await f.ready('video',1,'runpod');
  const id = f.pool.all()[0]!.id;
  expect(f.pool.snapshot().workers[0]).toMatchObject({state:'released',create_rejected:true,estimated_spend:0,actions:['dismiss_launch_failure']});
  const diagnostics = new Diagnostics(f.db,f.paths,f.pool.now);
  const restarted = new WorkerPool(f.db,f.paths,f.loras,f.deps,diagnostics);
  const creates=f.providers.runpod.create.mock.calls.length, finds=f.providers.runpod.find.mock.calls.length;
  const first=await restarted.action(id,'dismiss_launch_failure');
  f.advance(1000);
  const second=await restarted.action(id,'dismiss_launch_failure');
  expect(first.workers[0]!.launch_failure_dismissed_at).toBeTruthy();
  expect(second.workers[0]!.launch_failure_dismissed_at).toBe(first.workers[0]!.launch_failure_dismissed_at);
  expect(second.workers[0]!.issue?.code).toBe('capacity_unavailable');
  expect(second.summary).toMatchObject({active:0,hourly:0,estimated_spend:0});
  expect(second.workers[0]!.actions).toEqual([]);
  const restored=new WorkerPool(f.db,f.paths,f.loras,f.deps,diagnostics);
  expect(restored.snapshot().workers[0]!.launch_failure_dismissed_at).toBe(first.workers[0]!.launch_failure_dismissed_at);
  expect(diagnostics.history().items[0]).toMatchObject({outcome:'rejected',issue:{code:'capacity_unavailable'}});
  const actions=f.db.prepare("SELECT COUNT(*) AS count FROM acquisition_events WHERE worker_id=? AND operation='user_action'").get(id) as {count:number};
  expect(actions.count).toBe(1);
  expect(f.providers.runpod.create).toHaveBeenCalledTimes(creates);
  expect(f.providers.runpod.find).toHaveBeenCalledTimes(finds);
  expect(f.providers.runpod.destroy).not.toHaveBeenCalled();
}));
it('refuses failure dismissal for uncertain creation and allocated or normally released rentals', () => fixture(async f => {
  f.providers.vast.create.mockRejectedValueOnce(Error('fixture response lost'));
  const [uncertain]=await f.ready();
  await expect(f.pool.action(uncertain!.id,'dismiss_launch_failure')).rejects.toThrow('confirmed rejected');
  const [allocated]=await f.ready('video',1,'runpod');
  await expect(f.pool.action(allocated!.id,'dismiss_launch_failure')).rejects.toThrow('confirmed rejected');
  await f.pool.action(allocated!.id,'quit');
  await eventually(()=>f.pool.get(allocated!.id)!.state==='released');
  await expect(f.pool.action(allocated!.id,'dismiss_launch_failure')).rejects.toThrow('confirmed rejected');
  expect(f.pool.snapshot().summary.hourly).toBe(1);
}));
it("validates provider replacements against owned workers and prevents credential removal", async () =>
  fixture(async (f) => {
    await f.ready();
    await expect(
      f.pool.beforeCredentialChange("vastApiKey", null, "working"),
    ).rejects.toThrow("Quit all workers");
    await f.pool.beforeCredentialChange("vastApiKey", "replacement", "working");
    expect(f.providers.vast.validateCredential).toHaveBeenCalledWith(
      "replacement",
      expect.arrayContaining([expect.objectContaining({ provider: "vast" })]),
    );
    await expect(
      f.pool.beforeCredentialChange("civitaiKey", null, "old"),
    ).resolves.toBeUndefined();
    expect(f.providers.runpod.validateCredential).not.toHaveBeenCalled();
  }));
it("Finish jobs drains already-approved work while excluding requests created after the cutoff", async () =>
  fixture(async (f) => {
    await f.ready();
    const w = f.pool.all()[0]!;
    let pending = true;
    f.pool.bindJobs({ pending: () => pending, cancel: () => {} });
    await f.pool.action(w.id, "finish");
    await f.pool.tick();
    expect(f.pool.get(w.id)!.state).toBe("finishing");
    expect(f.providers.vast.destroy).not.toHaveBeenCalled();
    const cutoff = f.pool.get(w.id)!.finish_before!;
    f.db
      .prepare("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)")
      .run(
        "existing-job",
        "text-to-image",
        "queued",
        "{}",
        cutoff,
        cutoff,
        "fixture",
        0,
      );
    expect(
      f.pool.claim(
        "new-job",
        "image",
        [],
        new Date(Date.parse(cutoff) + 1).toISOString(),
      ),
    ).toBeNull();
    expect(
      f.pool.claim(
        "existing-job",
        "image",
        [],
        new Date(Date.parse(cutoff) - 1).toISOString(),
      )?.id,
    ).toBe(w.id);
    pending = false;
    await f.pool.tick();
    expect(f.providers.vast.destroy).not.toHaveBeenCalled();
    f.pool.complete("existing-job");
    await f.pool.tick();
    await eventually(() => f.pool.get(w.id)!.state === "released");
  }));
it("Quit now during an unresolved create terminates the rental as soon as it appears", async () =>
  fixture(async (f) => {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => (resolve = done)),
      create = f.providers.vast.create.getMockImplementation()!;
    f.providers.vast.create.mockImplementation(async (...args) => {
      await gate;
      return create(...args);
    });
    await f.pool.offers("image");
    await f.pool.launch(
      { selections: [{ offer_id: "vast-image", quantity: 1 }], max_hourly: 1 },
      "quit-unresolved-fixture",
    );
    await eventually(() => f.providers.vast.create.mock.calls.length === 1);
    const id = f.pool.all()[0]!.id;
    await f.pool.action(id, "quit");
    await eventually(() => Boolean(f.pool.get(id)!.issue));
    expect(f.pool.get(id)!.state).toBe("releasing");
    resolve();
    await f.pool.tick();
    await eventually(() => f.pool.get(id)!.state === "released");
    expect(f.providers.vast.create).toHaveBeenCalledTimes(1);
    expect(f.providers.vast.destroy).toHaveBeenCalledTimes(1);
    expect(f.resources.size).toBe(0);
  }));

it("waits for an in-flight purchase before allowing credential replacement", async () =>
  fixture(async (f) => {
    let resume!: () => void;
    const held = new Promise<void>((resolve) => (resume = resolve)),
      create = f.providers.vast.create.getMockImplementation()!;
    let committed = false;
    f.providers.vast.create.mockImplementation(async (...args) => {
      await held;
      return create(...args);
    });
    await f.pool.offers("image");
    await f.pool.launch(
      { selections: [{ offer_id: "vast-image", quantity: 1 }], max_hourly: 1 },
      "rotation-in-flight-fixture",
    );
    await eventually(() => f.providers.vast.create.mock.calls.length === 1);
    f.providers.vast.validateCredential.mockRejectedValueOnce(
      Error("different account"),
    );
    const replacement = f.pool.withCredentialChange(
      "vastApiKey",
      "other-account",
      "old",
      () => {
        committed = true;
      },
    );
    const failure = expect(replacement).rejects.toThrow("different account");
    try {
      await Promise.resolve();
      expect(committed).toBe(false);
      expect(f.providers.vast.validateCredential).not.toHaveBeenCalled();
      resume();
      await failure;
      expect(committed).toBe(false);
      expect(f.providers.vast.validateCredential).toHaveBeenCalledWith(
        "other-account",
        expect.arrayContaining([
          expect.objectContaining({
            resource: expect.objectContaining({ id: expect.any(String) }),
          }),
        ]),
      );
    } finally {
      resume();
    }
  }));
it("pauses new purchases during credential validation while Quit now remains available", async () =>
  fixture(async (f) => {
    await f.ready();
    const existing = f.pool.all()[0]!;
    let resume!: () => void;
    const held = new Promise<void>((resolve) => (resume = resolve));
    let committed = false;
    f.providers.vast.validateCredential.mockImplementation(async () => {
      await held;
    });
    const replacement = f.pool.withCredentialChange(
      "vastApiKey",
      "replacement",
      "old",
      () => {
        committed = true;
      },
    );
    try {
      await eventually(
        () => f.providers.vast.validateCredential.mock.calls.length === 1,
      );
      await f.pool.offers("image");
      await f.pool.launch(
        {
          selections: [{ offer_id: "vast-image", quantity: 1 }],
          max_hourly: 1,
        },
        "rotation-paused-launch-fixture",
      );
      await f.pool.tick();
      expect(f.providers.vast.create).toHaveBeenCalledTimes(1);
      await f.pool.action(existing.id, "quit");
      await eventually(() => f.pool.get(existing.id)!.state === "released");
      expect(committed).toBe(false);
      resume();
      await replacement;
      await f.pool.tick();
      expect(committed).toBe(true);
      expect(f.providers.vast.create).toHaveBeenCalledTimes(2);
    } finally {
      resume();
    }
  }));
it("stops assigning work after engine readiness is lost while keeping adapter installation frozen", async () =>
  fixture(async (f) => {
    await f.ready();
    const id = f.pool.all()[0]!.id,
      prepare = f.worker.prepare.getMockImplementation()!;
    f.worker.prepare.mockImplementation(async (w) => ({
      ...(await prepare(w)),
      ready: false,
    }));
    await f.pool.tick();
    const worker = f.pool.get(id)!;
    expect(worker.ready).toBe(false);
    expect(worker.adapters_frozen).toBe(true);
    expect(
      f.pool.compatible(worker, "image", [], worker.created_at),
    ).toBeFalsy();
    await expect(f.pool.action(id, "retry_preparation")).rejects.toThrow(
      "frozen",
    );
  }));
it("does not advertise a worker as available while a foreign execution is running", async () =>
  fixture(async (f) => {
    await f.ready();
    const prepare = f.worker.prepare.getMockImplementation()!;
    f.worker.prepare.mockImplementation(async (w) => ({
      ...(await prepare(w)),
      busy: true,
      active_job_id: "unowned-request",
    }));
    await f.pool.tick();
    const worker = f.pool.all()[0]!;
    expect(worker).toMatchObject({
      ready: false,
      state: "needs_attention",
      issue: { code: "worker_busy" },
    });
    expect(
      f.pool.compatible(worker, "image", [], worker.created_at),
    ).toBeFalsy();
  }));
it("offers base-model fallback only before readiness and can quit while that transfer is in flight", async () =>
  fixture(async (f) => {
    let resume!: () => void;
    const held = new Promise<void>((resolve) => (resume = resolve)),
      fallback = vi.fn(async () => {
        await held;
      });
    f.deps.worker.fallbackBaseModels = fallback;
    const prepare = f.worker.prepare.getMockImplementation()!;
    f.worker.prepare.mockImplementation(async (w) => ({
      ...(await prepare(w)),
      ready: false,
      preparation: {
        phase: "failed",
        bytes_done: 0,
        bytes_total: 100,
        files: [
          {
            path: "base.safetensors",
            name: "Base model",
            ready: false,
            bytes_done: 0,
            bytes_total: 100,
            error: "Download failed",
            optional: false,
          },
        ],
      },
    }));
    await f.ready();
    const id = f.pool.all()[0]!.id;
    expect(f.pool.snapshot().workers[0]!.actions).toContain("local_fallback");
    try {
      await f.pool.action(id, "local_fallback");
      await eventually(() => fallback.mock.calls.length === 1);
      expect(f.pool.get(id)!.current_activity).toContain("this PC");
      await f.pool.action(id, "quit");
      await eventually(() => f.pool.get(id)!.state === "released");
      resume();
      await f.pool.tick();
      await eventually(() => f.pool.get(id)!.current_activity === undefined);
      expect(f.pool.get(id)!.state).toBe("released");
    } finally {
      resume();
    }
  }));
it("preserves allocation spend and unresolved release charges across coordinator restarts", async () =>
  fixture(async (f) => {
    await f.ready();
    const id = f.pool.all()[0]!.id;
    f.advance(3600000);
    f.providers.vast.destroy.mockRejectedValue(Error("delete response lost"));
    await f.pool.action(id, "quit");
    await eventually(() => Boolean(f.pool.get(id)!.issue));
    f.advance(1800000);
    const restarted = new WorkerPool(f.db, f.paths, f.loras, f.deps);
    try {
      expect(restarted.snapshot().workers[0]).toMatchObject({
        state: "releasing",
        estimated_spend: 1.5,
        hourly: 1,
      });
      await restarted.tick();
      expect(f.providers.vast.create).toHaveBeenCalledTimes(1);
      expect(restarted.snapshot().summary.estimated_spend).toBe(1.5);
    } finally {
      await restarted.close();
    }
  }));
it("disconnects a worker when the provider confirms it was removed externally", async () =>
  fixture(async (f) => {
    await f.ready();
    const worker = f.pool.all()[0]!;
    f.resources.clear();
    f.advance(15_000);
    await f.pool.tick();
    expect(f.pool.get(worker.id)!.state).toBe("released");
    expect(f.worker.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: worker.id }),
    );
    expect(f.providers.vast.destroy).not.toHaveBeenCalled();
  }));
it("polls worker progress between provider checks and preserves the verification timestamp", async () =>
  fixture(async f => {
    const worker = (await f.ready())[0]!;
    const verified = f.pool.get(worker.id)!.last_verified_at;
    f.providers.vast.find.mockClear();
    f.worker.prepare.mockClear();
    for (let i=0; i<7; i++) { f.advance(2000); await f.pool.tick(); }
    expect(f.providers.vast.find).not.toHaveBeenCalled();
    expect(f.worker.prepare).toHaveBeenCalledTimes(7);
    expect(f.pool.get(worker.id)!.last_verified_at).toBe(verified);
    f.advance(2000); await f.pool.tick();
    expect(f.providers.vast.find).toHaveBeenCalledOnce();
  }));
it("backs off provider rate limits without blocking health checks or Quit now", async () =>
  fixture(async f => {
    const worker = (await f.ready())[0]!;
    f.advance(15_000);
    f.providers.vast.find.mockRejectedValueOnce(new PoolError({code:'rate_limited', message:'Slow down', retryable:true}));
    await f.pool.tick();
    expect(f.pool.get(worker.id)!.issue?.code).toBe('rate_limited');
    f.providers.vast.find.mockClear();
    f.worker.prepare.mockClear();
    f.advance(20_000); await f.pool.tick();
    expect(f.providers.vast.find).not.toHaveBeenCalled();
    expect(f.worker.prepare).toHaveBeenCalledOnce();
    await f.pool.action(worker.id, 'quit');
    await eventually(() => f.pool.get(worker.id)!.state==='released');
    expect(f.providers.vast.destroy).toHaveBeenCalledOnce();
    expect(f.providers.vast.find).toHaveBeenCalledTimes(2);
  }));
it("waits for a fresh endpoint after a rate-limited initial verification and recovers without another purchase", async () =>
  fixture(async f => {
    f.providers.vast.find.mockRejectedValueOnce(new PoolError({code:'rate_limited', message:'Slow down', retryable:true}));
    const worker = (await f.ready())[0]!;
    expect(f.pool.get(worker.id)!.state).toBe('needs_attention');
    expect(f.worker.prepare).not.toHaveBeenCalled();
    f.advance(20_000); await f.pool.tick();
    expect(f.providers.vast.find).toHaveBeenCalledOnce();
    expect(f.worker.prepare).not.toHaveBeenCalled();
    f.advance(40_000); await f.pool.tick();
    expect(f.providers.vast.find).toHaveBeenCalledTimes(2);
    expect(f.providers.vast.create).toHaveBeenCalledOnce();
    expect(f.pool.get(worker.id)!.state).toBe('ready');
    expect(f.pool.get(worker.id)!.issue).toBeUndefined();
  }));
it("uses one cutoff for a pool-wide finish request", async () =>
  fixture(async (f) => {
    await f.ready("image", 3);
    f.pool.bindJobs({ pending: () => true, cancel: () => {} });
    await f.pool.actionAll("finish");
    const workers = f.pool.all();
    expect(new Set(workers.map((w) => w.finish_before)).size).toBe(1);
    expect(workers.every((w) => w.quit_mode === "finish")).toBe(true);
  }));
it("disconnects local work without waiting for an unresponsive delete request", async () =>
  fixture(async (f) => {
    await f.ready();
    const worker = f.pool.all()[0]!;
    let resume!: () => void;
    const wait = new Promise<void>((resolve) => (resume = resolve));
    const destroy = f.providers.vast.destroy.getMockImplementation()!;
    f.providers.vast.destroy.mockImplementation(async (w) => {
      await wait;
      await destroy(w);
    });
    try {
      await f.pool.action(worker.id, "quit");
      await eventually(() => f.providers.vast.destroy.mock.calls.length === 1);
      expect(f.worker.disconnect).toHaveBeenCalledWith(
        expect.objectContaining({ id: worker.id }),
      );
      expect(f.pool.get(worker.id)!.state).toBe("releasing");
    } finally {
      resume();
      await eventually(() => f.pool.get(worker.id)!.state === "released");
    }
  }));
it("does not resurrect a released worker when preparation retry returns late", async () =>
  fixture(async (f) => {
    const prepare = f.worker.prepare.getMockImplementation()!;
    let resume!: () => void;
    const wait = new Promise<void>((resolve) => (resume = resolve));
    let retryStarted = false;
    f.worker.prepare.mockImplementation(async (w, options) => {
      if (options?.retry) { retryStarted = true; await wait; }
      return { ...await prepare(w), ready: false };
    });
    await f.ready();
    const id = f.pool.all()[0]!.id;
    const retry = f.pool.action(id, "retry_preparation");
    try {
      await eventually(() => retryStarted);
      await f.pool.action(id, "quit");
      await eventually(() => f.pool.get(id)!.state === "released");
      resume(); await retry;
      expect(f.pool.get(id)!.state).toBe("released");
      expect(f.providers.vast.create).toHaveBeenCalledTimes(1);
    } finally { resume(); await retry; }
  }));
