import { it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createProviders } from "../server/pool-providers.js";
import { prepareStorage, resolvePaths } from "../server/storage.js";
import type { RentalRecord, OfferResult } from "../server/pool-contracts.js";
const release = {
  image: "example/worker@sha256:" + "a".repeat(64),
  disk_gb: 180,
};
function record(result: OfferResult): RentalRecord {
  return {
    ...result.offer,
    id: "recorded-worker",
    launch_id: "launch",
    state: "starting",
    created_at: new Date().toISOString(),
    console_url: "",
    installed_loras: [],
    requested_loras: [],
    manifest: [],
    offer: result.offer,
    provider_data: result.data,
    submit_key: "launch-key",
  };
}
async function fixture(
  fn: (
    providers: ReturnType<typeof createProviders>,
    requests: Array<{ url: string; method: string; body: any }>,
    respond: (f: (url: string, method: string, body: any) => Response) => void,
  ) => Promise<void>,
) {
  mkdirSync(".local/tests", { recursive: true });
  const root = mkdtempSync(path.resolve(".local/tests/provider-")),
    paths = resolvePaths(root);
  prepareStorage(paths);
  writeFileSync(
    path.join(paths.config, "credentials.json"),
    JSON.stringify({ runpodApiKey: "fixture-key", vastApiKey: "fixture-key" }),
  );
  const requests: Array<{ url: string; method: string; body: any }> = [];
  let response: (url: string, method: string, body: any) => Response = () => {
    throw Error("Unexpected provider request");
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input),
      method = init?.method ?? "GET",
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method, body });
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer fixture-key",
    );
    return response(url, method, body);
  });
  try {
    await fn(createProviders(paths, fetcher), requests, (f) => {
      response = f;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
it('preserves the Retry-After delay from an observed Vast HTML rate-limit response', () =>
  fixture(async (providers, _requests, respond) => {
    const captured=JSON.parse(readFileSync(new URL('./fixtures/provider-synthetic/vast-delete-rate-limited.json',import.meta.url),'utf8'));
    respond(()=>new Response(captured.body,{status:captured.status,headers:{'Retry-After':captured.retry_after}}));
    await expect(providers.vast.destroy({resource:{id:'fixture-rental'}} as RentalRecord))
      .rejects.toMatchObject({issue:{code:'rate_limited'},retryAfterMs:3000});
  }));
it('excludes Volta even when the provider advertises enough VRAM and a CUDA 13 host', () =>
  fixture(async (providers, _requests, respond) => {
    respond(() => json({gpus:[{...gpu,id:'Tesla V100 SXM2 32GB',memory:32}]}));
    expect(await providers.runpod.offers('image', release)).toEqual([]);
    respond(() => json({offers:[{...vastOffer,gpu_name:'Tesla V100',gpu_ram:32000}]}));
    expect(await providers.vast.offers('image', release)).toEqual([]);
  }));
const gpu = {
  id: "NVIDIA RTX PRO 6000 Blackwell Server Edition",
  memory: 96,
  secure: true,
  price: { secure: 2 },
  availability: "HIGH",
};
const vastOffer = {
  id: 17,
  num_gpus: 1,
  gpu_name: "RTX PRO 6000 Blackwell",
  gpu_ram: 96000,
  cpu_ram: 128000,
  cuda_max_good: 13,
  disk_space: 500,
  direct_port_count: 8,
  reliability2: 0.999,
  verification: "verified",
  dph_total: 1.5,
  storage_cost: 0.1,
  geolocation: "fixture",
};
it('retains separate Vast bandwidth prices, advertised speed and host quality without inventing missing prices', () =>
  fixture(async (providers,requests,respond) => {
    respond(()=>json({offers:[{...vastOffer,inet_down:7420,inet_down_cost:0,inet_up_cost:.08,machine_id:123}]}));
    const [result]=await providers.vast.offers('video',release);
    expect(result!.offer).toMatchObject({download_mbps:7420,download_per_gb:0,upload_per_gb:.08,reliability:.999,verified:true,machine_id:'123'});
    expect(requests[0]!.body.order).toEqual([['reliability2','desc'],['inet_down','desc'],['dph_total','asc']]);
    respond(()=>json({offers:[{...vastOffer,inet_down:null,inet_down_cost:null,inet_up_cost:-1}]}));
    const missing=(await providers.vast.offers('video',release))[0]!.offer;
    expect(missing.download_per_gb).toBeUndefined();expect(missing.upload_per_gb).toBeUndefined();expect(missing.download_mbps).toBeUndefined();
  }));
it('retains RunPod regional stock without restricting global placement or inventing capacity and network measurements', () =>
  fixture(async (providers,requests,respond) => {
    respond(url=>url.includes('catalog')?json({gpus:[{...gpu,maxCount:{secure:8},dataCenters:[{id:'A',name:'Region A',availability:'LOW'},{id:'B',availability:'NONE'}]}]}):json({id:'fixture',status:'RUNNING'}));
    const [result]=await providers.runpod.offers('image',release);
    expect(result!.offer).toMatchObject({cloud:'secure',stock:'HIGH',min_ram_gb:48,locations:[{id:'A',name:'Region A',stock:'LOW'}]});
    expect(result!.offer.download_mbps).toBeUndefined();expect(result!.offer.download_per_gb).toBeUndefined();expect(result!.offer.ram_gb).toBeUndefined();
    await providers.runpod.create(record(result!),{public_key:'fixture',pairing_secret:'fixture'});
    const create=requests.find(r=>r.method==='POST')!.body;
    expect(create).not.toHaveProperty('dataCenterIds');expect(create.gpu).not.toHaveProperty('dataCenterIds');
    expect(create.gpu.minRamPerGpu).toBe(48);
  }));
it('accepts Vast Blackwell WS/Server aliases only with corroborating compute capability', () =>
  fixture(async (providers, _requests, respond) => {
    const captured=JSON.parse(readFileSync(new URL('./fixtures/provider-synthetic/vast-video-catalog.json',import.meta.url),'utf8'));
    respond(()=>json(captured.response,captured.status));
    expect((await providers.vast.offers('video',release)).map(r=>r.offer.gpu)).toEqual(['RTX PRO 6000 WS','RTX PRO 6000 S','RTX PRO 6000 WS','RTX PRO 6000 WS']);
    respond(()=>json({offers:[
      {...vastOffer,id:1,gpu_name:'RTX PRO 6000 WS',compute_cap:1200},
      {...vastOffer,id:2,gpu_name:'RTX PRO 6000 S',compute_cap:1200},
      {...vastOffer,id:3,gpu_name:'RTX PRO 6000 WS',compute_cap:890},
      {...vastOffer,id:4,gpu_name:'RTX 6000Ada',compute_cap:890},
    ]}));
    expect((await providers.vast.offers('video',release)).map(r=>r.data.offer_id)).toEqual([1,2]);
  }));
it('replays observed RunPod startup, direct SSH readiness, and confirmed deletion', () =>
  fixture(async (providers, requests, respond) => {
    const observed=(name:string)=>JSON.parse(readFileSync(new URL('./fixtures/provider-synthetic/'+name+'.json',import.meta.url),'utf8'));
    const created=observed('runpod-created').response;
    const worker={id:'fixture-worker',provider:'runpod',resource:{id:created.id,status:created.status}} as RentalRecord;
    for(const name of ['runpod-pending','runpod-ready','runpod-deleted']) {
      const reply=observed(name);
      respond(()=>json(reply.response,reply.status));
      const resource=await providers.runpod.find(worker);
      if(name==='runpod-pending')expect(resource).toMatchObject({id:'fixture-rental',status:'RUNNING'});
      if(name==='runpod-pending')expect(resource?.ssh).toBeUndefined();
      if(name==='runpod-ready')expect(resource?.ssh).toEqual({host:'192.0.2.10',port:18918,user:'root'});
      if(name==='runpod-deleted')expect(resource).toBeNull();
    }
    expect(requests).toHaveLength(3);
    expect(requests.every(r=>r.method==='GET'&&r.url.endsWith('/pods/fixture-rental'))).toBe(true);
  }));
it("uses live RunPod capacity and quotes disposable disk separately from GPU compute", () =>
  fixture(async (providers, requests, respond) => {
    respond(() =>
      json({
        gpus: [
          gpu,
          { ...gpu, id: "unavailable", availability: "NONE" },
          { ...gpu, id: "unpriced", price: {} },
        ],
      }),
    );
    const offers = await providers.runpod.offers("video", release);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.offer).toMatchObject({
      compute_hourly: 2,
      storage_hourly: 0.025,
      hourly: 2.025,
    });
    expect(requests[0]!.url).toContain("count=1&minCudaVersion=13.0");
  }));
it("refreshes the rate before creation and refuses a price increase without sending a create request", () =>
  fixture(async (providers, requests, respond) => {
    respond(() => json({ gpus: [gpu] }));
    const w = record((await providers.runpod.offers("video", release))[0]!);
    respond(() => json({ gpus: [{ ...gpu, price: { secure: 3 } }] }));
    await expect(
      providers.runpod.create(w, {
        public_key: "ssh-fixture",
        pairing_secret: "fixture-secret",
      }),
    ).rejects.toMatchObject({definitive: true, issue: {code: 'quote_changed'}});
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  }));
it.each(['vast','runpod'] as const)('classifies an empty %s revalidation as unavailable without making a purchase', provider => fixture(async(providers,requests,respond)=>{
  respond(()=>json(provider==='vast'?{offers:[vastOffer]}:{gpus:[gpu]}));
  const w=record((await providers[provider].offers('video',release))[0]!);
  respond(()=>json(provider==='vast'?{offers:[]}:{gpus:[]}));
  await expect(providers[provider].create(w,{public_key:'fixture',pairing_secret:'fixture'})).rejects.toMatchObject({definitive:true,issue:{code:'capacity_unavailable'}});
  expect(requests.some(r=>r.method==='PUT'||r.url.endsWith('/pods'))).toBe(false);
}));
it.each([
  ['Downloading fs layer','downloading_container'],
  ['Verifying Checksum','verifying_container'],
  ['Retrying in 5 seconds','retrying_container'],
  ['Provider has not reported details',undefined],
])('bounds provider startup message %s to a category', (message,category)=>fixture(async(providers,_requests,respond)=>{
  respond(()=>json({instances:{id:17,actual_status:'loading',status_msg:message}}));
  const found=await providers.vast.find({resource:{id:'17'}} as RentalRecord);
  expect(found?.startup_stage).toBe(category);
  expect(JSON.stringify(found)).not.toContain(message);
}));
it("creates independent single-GPU pods and reconciles only the unique recorded launch name", () =>
  fixture(async (providers, requests, respond) => {
    respond((url, method) =>
      url.includes("catalog")
        ? json({ gpus: [gpu] })
        : method === "POST"
          ? json({ id: "owned", status: "RUNNING", image: release.image })
          : json({
              pods: [
                { id: "unrelated", name: "other" },
                {
                  id: "owned",
                  name: "seed-recorded-worker",
                  status: "RUNNING",
                  image: release.image,
                },
              ],
            }),
    );
    const w = record((await providers.runpod.offers("video", release))[0]!);
    await providers.runpod.create(w, {
      public_key: "ssh-fixture",
      pairing_secret: "fixture-secret",
    });
    const create = requests.find((r) => r.method === "POST")!;
    expect(create.body.gpu.count).toBe(1);
    expect(create.body.env).toMatchObject({
      SEED_WORKER_CLASS: "video",
      SEED_START_SSH: "1",
    });
    expect(create.body).not.toHaveProperty("volume");
    expect((await providers.runpod.find(w))?.id).toBe("owned");
  }));
it("does not treat malformed provider responses as evidence that a rental was terminated", () =>
  fixture(async (providers, _requests, respond) => {
    const w = record({
      offer: {
        id: "quote",
        provider: "vast",
        worker_class: "video",
        gpu: "RTX PRO 6000 Blackwell",
        vram_gb: 96,
        region: "test",
        hourly: 1,
        compute_hourly: 1,
        storage_hourly: 0,
        disk_gb: 180,
        max_quantity: 1,
        quoted_at: "",
        expires_at: "",
        image: release.image,
        available: true,
      },
      data: { offer_id: 1 },
    });
    w.resource = { id: "42", status: "running" };
    respond(() => json({ unexpected: "shape" }));
    await expect(providers.vast.find(w)).rejects.toThrow("Cannot verify");
    respond(() => json({ instances: [] }));
    await expect(providers.vast.find(w)).rejects.toThrow("Cannot verify");
    respond(() => json({ instances: null }));
    expect(await providers.vast.find(w)).toBeNull();
    respond(() => json({ error: "not found" }, 404));
    expect(await providers.vast.find(w)).toBeNull();
  }));
it.each([401, 402, 403, 429, 503])(
  "maps provider HTTP %s without exposing provider response bodies or credentials",
  (status) =>
    fixture(async (providers, _requests, respond) => {
      respond(() => json({ secret: "must never escape" }, status));
      try {
        await providers.runpod.offers("image", release);
        throw Error("Expected failure");
      } catch (error) {
        expect(String(error)).not.toContain("must never escape");
        expect(String(error)).not.toContain("fixture-key");
        expect((error as any).issue.provider).toBe("runpod");
      }
    }),
);
it("uses only the worker public key and container startup on Vast, without changing account SSH keys", () =>
  fixture(async (providers, requests, respond) => {
    respond((url, method, body) =>
      url.includes("/bundles/")
        // Vast's returned id is the ask contract ID. Searching with id instead
        // finds no offer even while the contract remains available.
        ? json({ offers: body.id ? [] : [vastOffer] })
        : method === "PUT" && url.includes("/asks/17/")
          ? json({ success: true, new_contract: 42 })
          : json({ unexpected: "request" }, 400),
    );
    const w = record((await providers.vast.offers("video", release))[0]!);
    expect(
      (
        await providers.vast.create(w, {
          public_key: "ssh-ed25519 fixture",
          pairing_secret: "fixture-secret",
        })
      ).id,
    ).toBe("42");
    const create = requests.find((r) => r.method === "PUT")!;
    expect(requests.filter(r => r.url.includes("/bundles/")).at(-1)?.body)
      .toMatchObject({ ask_contract_id: { eq: 17 } });
    expect(create.body).toMatchObject({
      runtype: "args",
      args: ["/opt/venv/bin/python", "-m", "worker.entrypoint"],
      env: {
        PUBLIC_KEY: "ssh-ed25519 fixture",
        SEED_SSH_PUBLIC_KEY: "ssh-ed25519 fixture",
        "-p 22:22": "1",
        SEED_START_SSH: "1",
      },
    });
    expect(create.body).not.toHaveProperty("onstart");
    expect(requests.some((r) => r.url.includes("/ssh"))).toBe(false);
  }));
it("rejects Vast responses that do not satisfy the advertised host constraints", () =>
  fixture(async (providers, _requests, respond) => {
    respond(() =>
      json({
        offers: [
          vastOffer,
          { ...vastOffer, id: 18, cpu_ram: 32000 },
          { ...vastOffer, id: 19, cuda_max_good: 12.8 },
          { ...vastOffer, id: 20, disk_space: 100 },
          { ...vastOffer, id: 21, gpu_ram: 24000 },
        ],
      }),
    );
    expect(await providers.vast.offers("video", release)).toHaveLength(1);
  }));
it("registers the existing SSH key only on the owned Vast instance", () =>
  fixture(async (providers, requests, respond) => {
    respond(() => json({ offers: [vastOffer] }));
    const w = record((await providers.vast.offers('video', release))[0]!);
    w.resource = { id:'42', status:'running' };
    respond(() => json({success:true}));
    await providers.vast.prepareAccess!(w, 'ssh-ed25519 fixture');
    expect(requests.at(-1)).toMatchObject({url:'https://console.vast.ai/api/v0/instances/42/ssh/', method:'POST', body:{ssh_key:'ssh-ed25519 fixture'}});
    respond(() => json({success:false, msg:'SSH key already associated with instance.'}));
    await expect(providers.vast.prepareAccess!(w, 'ssh-ed25519 fixture')).resolves.toBeUndefined();
    respond(() => json({success:false}));
    await expect(providers.vast.prepareAccess!(w, 'ssh-ed25519 fixture')).rejects.toThrow('not confirmed');
  }));
it.each(["vast", "runpod"] as const)(
  "treats %s offer-refresh failure before purchasing as definitively unallocated",
  (provider) =>
    fixture(async (providers, requests, respond) => {
      respond(() =>
        provider === "vast"
          ? json({ offers: [vastOffer] })
          : json({ gpus: [gpu] }),
      );
      const w = record(
        (await providers[provider].offers("video", release))[0]!,
      );
      respond(() => {
        throw Error("fixture connection lost");
      });
      await expect(
        providers[provider].create(w, {
          public_key: "ssh-fixture",
          pairing_secret: "fixture-secret",
        }),
      ).rejects.toMatchObject({
        definitive: true,
        issue: { code: "provider_unavailable" },
      });
      expect(
        requests.some(
          (r) =>
            r.method === "PUT" ||
            (r.method === "POST" && r.url.endsWith("/pods")),
        ),
      ).toBe(false);
    }),
);
it.each(["vast", "runpod"] as const)(
  "preserves %s rental mutation uncertainty instead of declaring zero cost",
  (provider) =>
    fixture(async (providers, _requests, respond) => {
      respond(() =>
        provider === "vast"
          ? json({ offers: [vastOffer] })
          : json({ gpus: [gpu] }),
      );
      const w = record(
        (await providers[provider].offers("video", release))[0]!,
      );
      respond((url) =>
        url.includes("catalog")
          ? json({ gpus: [gpu] })
          : url.includes("/bundles/")
            ? json({ offers: [vastOffer] })
            : json({}, 503),
      );
      await expect(
        providers[provider].create(w, {
          public_key: "ssh-fixture",
          pairing_secret: "fixture-secret",
        }),
      ).rejects.toMatchObject({ definitive: false });
    }),
);
it.each(["vast", "runpod"] as const)(
  "does not follow a mismatched %s resource ID into another rental",
  (provider) =>
    fixture(async (providers, _requests, respond) => {
      respond(() =>
        provider === "vast"
          ? json({ offers: [vastOffer] })
          : json({ gpus: [gpu] }),
      );
      const w = record(
        (await providers[provider].offers("video", release))[0]!,
      );
      w.resource = { id: "42", status: "running" };
      respond(() =>
        provider === "vast"
          ? json({ instances: { id: 99 } })
          : json({ id: "99" }),
      );
      await expect(providers[provider].find(w)).rejects.toThrow(
        "different resource",
      );
    }),
);
it.each(["vast", "runpod"] as const)(
  "requires the replacement %s credential to retain access to every active rental",
  (provider) =>
    fixture(async (providers, _requests, respond) => {
      respond(() =>
        provider === "vast"
          ? json({ offers: [vastOffer] })
          : json({ gpus: [gpu] }),
      );
      const w = record(
        (await providers[provider].offers("video", release))[0]!,
      );
      w.resource = { id: "42", status: "running" };
      respond(() =>
        provider === "vast"
          ? json({ instances: [{ id: 42 }, { id: 100 }] })
          : json({ pods: [{ id: "42" }, { id: "100" }] }),
      );
      await expect(
        providers[provider].validateCredential!("fixture-key", [w]),
      ).resolves.toBeUndefined();
      respond(() =>
        provider === "vast"
          ? json({ instances: [{ id: 100 }] })
          : json({ pods: [{ id: "100" }] }),
      );
      await expect(
        providers[provider].validateCredential!("fixture-key", [w]),
      ).rejects.toThrow("cannot verify");
      delete w.resource;
      await expect(
        providers[provider].validateCredential!("fixture-key", [w]),
      ).rejects.toThrow("uncertain rental");
    }),
);
it("follows Vast after_token pagination and never mistakes a repeated page for complete ownership", () =>
  fixture(async (providers, requests, respond) => {
    respond(() => json({ offers: [vastOffer] }));
    const w = record((await providers.vast.offers("video", release))[0]!);
    respond((url) =>
      url.includes("after_token=page-2")
        ? json({
            instances: [
              {
                id: 42,
                label: "seed-recorded-worker",
                actual_status: "running",
              },
            ],
            next_token: null,
          })
        : json({
            instances: [{ id: 99, label: "unrelated" }],
            next_token: "page-2",
          }),
    );
    expect((await providers.vast.find(w))?.id).toBe("42");
    expect(requests.some((r) => r.url.endsWith("?after_token=page-2"))).toBe(
      true,
    );
    respond(() => json({ instances: [], next_token: "same" }));
    await expect(providers.vast.find(w)).rejects.toThrow(
      "Cannot finish verifying",
    );
  }));
