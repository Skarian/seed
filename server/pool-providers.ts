import { randomUUID } from "node:crypto";
import type { StudioPaths } from "./storage.js";
import { credential } from "./credential-store.js";
import type {
  OfferResult,
  ProviderDriver,
  RentalRecord,
  RentalResource,
} from "./pool-contracts.js";
import type { Provider, WorkerClass } from "../shared/pool.js";
import { PoolError, providerFailure } from "./pool-errors.js";
import { Diagnostics, boundedText, diagnosticId } from './diagnostics.js';
import {ProviderLogs} from './provider-logs.js';

/** Provider transports contain no scheduler state and never retry mutations. */
class ProviderApi {
  constructor(
    readonly provider: Provider,
    private key: () => string,
    private fetcher: typeof fetch,
    private diagnostics?: Diagnostics,
  ) {}
  configured() {
    return Boolean(this.key());
  }
  async request(
    route: string,
    method = "GET",
    body?: unknown,
    key = this.key(),
  ): Promise<any> {
    if (!key)
      throw new PoolError({
        code: "missing_credentials",
        message: "Add the provider key in Admin.",
        provider: this.provider,
        retryable: false,
      });
    const base =
      this.provider === "runpod"
        ? "https://api.runpod.io/v2/"
        : "https://console.vast.ai";
    this.diagnostics?.registerSecret(key);
    const exchange_id=diagnosticId(),started=Date.now();
    let status:number|undefined;
    try {
    const response = await this.fetcher(base + route, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    status=response.status;
    const text=await boundedText(response,response.ok?4*1024*1024:64*1024);
    let payload:unknown;
    try{payload=text?JSON.parse(text):{};}catch{payload={unparsed_text:text};}
    const startupMessage=(payload as any)?.instances?.status_msg;
    if(typeof startupMessage==='string' && /retrying|error|failed|denied|timeout|timed out/i.test(startupMessage))
      this.diagnostics?.event({category:'provider',provider:this.provider,operation:'container.startup_warning',level:'warn',
        data:{message:startupMessage,exchange_id}});
    this.diagnostics?.event({category:'provider',provider:this.provider,operation:method+' '+route.split('?')[0],level:response.ok&&(payload as any)?.success!==false?'info':'warn',
      data:{exchange_id,status,duration_ms:Date.now()-started,query:route.includes('?')?route.split('?')[1]:undefined,
        request:body,response:payload,response_bytes:Buffer.byteLength(text),
        provider_request_id:response.headers.get('x-request-id')??response.headers.get('request-id'),retry_after:response.headers.get('retry-after')}});
    if(status===404&&method==='GET')return null;
    if(!response.ok) {
      const error=providerFailure(status,this.provider,payload),retry=response.headers.get('retry-after');
      if(status===429) {
        const delay=retry&&/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-Date.now():NaN;
        error.retryAfterMs=Number.isFinite(delay)?Math.max(1000,Math.min(delay,300000)):5000;
      }
      throw error;
    }
    if(status===204)return {};
    if((payload as any)?.unparsed_text!==undefined)throw Error('Provider returned malformed JSON.');
    return payload;
    } catch(error) {
      this.diagnostics?.event({category:'provider',provider:this.provider,operation:method+' '+route.split('?')[0],level:'error',data:{exchange_id,status,duration_ms:Date.now()-started,error}});
      throw error;
    }
  }
}
function quote(
  provider: Provider,
  role: WorkerClass,
  release: { image: string; disk_gb: number },
  gpu: string,
  vram: number,
  compute: number,
  storage: number,
  region: string,
  max = 1,
) {
  const now = Date.now();
  return {
    id: randomUUID(),
    provider,
    worker_class: role,
    gpu,
    vram_gb: vram,
    region,
    hourly: compute + storage,
    compute_hourly: compute,
    storage_hourly: storage,
    disk_gb: release.disk_gb,
    max_quantity: max,
    quoted_at: new Date(now).toISOString(),
    expires_at: new Date(now + 120000).toISOString(),
    image: release.image,
    available: true,
  };
}
function environment(
  w: RentalRecord,
  auth: { public_key: string; pairing_secret: string },
) {
  return {
    PUBLIC_KEY: auth.public_key,
    SEED_SSH_PUBLIC_KEY: auth.public_key,
    SEED_PAIRING_SECRET: auth.pairing_secret,
    SEED_START_SSH: "1",
    SEED_TRANSPORT: "ssh",
    SEED_WORKER_CLASS: w.worker_class,
  };
}
async function beforeRental<T>(
  provider: Provider,
  check: () => Promise<T>,
): Promise<T> {
  try {
    return await check();
  } catch (error) {
    // Only pre-purchase checks belong here. Even a timeout is definite evidence
    // of no rental when the create request has not yet been attempted.
    if (error instanceof PoolError) throw new PoolError(error.issue, true);
    throw new PoolError(
      {
        code: "provider_unavailable",
        message:
          "The provider could not verify this offer. No rental was created. Refresh available GPUs and try again.",
        provider,
        retryable: true,
        action: "Refresh offers",
      },
      true,
    );
  }
}
// These pre-Turing devices are not supported by the pinned PyTorch CUDA 13 build,
// even when host drivers and advertised VRAM satisfy the other requirements.
function unsupportedLegacyGpu(name: string) {
  return /\b(?:V100|P100|P40|P6000|M40|M60|K80|TITAN[ _]V)\b/i.test(name);
}
function runpodAvailable(g: any, role: WorkerClass) {
  const memory = Number(g?.memory ?? g?.memoryInGb);
  return (
    g?.secure === true &&
    !unsupportedLegacyGpu(String(g.id)) &&
    ["HIGH", "MEDIUM", "LOW"].includes(g.availability) &&
    Number.isFinite(memory) &&
    memory >= (role === "image" ? 32 : 96) &&
    Number.isFinite(g.price?.secure) &&
    g.price.secure > 0 &&
    (role !== "video" || /RTX PRO 6000.*Blackwell/i.test(g.id))
  );
}
function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function vastAvailable(g: any, role: WorkerClass, disk: number) {
  const videoGpu = /RTX PRO 6000.*Blackwell/i.test(g?.gpu_name)
    || (/^RTX PRO 6000(?: (?:WS|S))?$/i.test(g?.gpu_name) && Number(g?.compute_cap) === 1200);
  return (
    g?.num_gpus === 1 &&
    !unsupportedLegacyGpu(String(g.gpu_name)) &&
    Number.isFinite(g.dph_total) &&
    g.dph_total > 0 &&
    g.reliability2 >= 0.99 &&
    g.verification === "verified" &&
    Number(g.gpu_ram) >= (role === "image" ? 32 : 96) * 1000 &&
    Number(g.cpu_ram) >= (role === "image" ? 48 : 128) * 1000 &&
    Number(g.cuda_max_good) >= 13 &&
    Number(g.disk_space) >= disk &&
    Number(g.direct_port_count) >= 1 &&
    (role !== "video" || videoGpu)
  );
}
function verifiedResource(w: RentalRecord, resource: RentalResource) {
  if (w.resource && resource.id !== w.resource.id)
    throw Error(
      "The provider returned a different resource than the recorded rental.",
    );
  return resource;
}
function startupStage(message: unknown): RentalResource['startup_stage'] {
  if (typeof message !== 'string') return undefined;
  const text = message.slice(0, 4096);
  if (/retrying|retry in \d/i.test(text)) return 'retrying_container';
  if (/verifying checksum|extracting|unpacking/i.test(text)) return 'verifying_container';
  if (/downloading|pulling (?:fs layer|image|container)/i.test(text)) return 'downloading_container';
  return undefined;
}
function runpodResource(p: any): RentalResource {
  if (!p || typeof p.id !== "string")
    throw Error("RunPod returned an invalid pod.");
  const ssh = p.ssh?.direct;
  return {
    id: p.id,
    status: String(p.status),
    ...(!ssh?.host && p.status === 'RUNNING' ? {startup_stage: 'waiting_for_ssh' as const} : {}),
    created_at: p.createdAt,
    host_id: typeof p.machineId==='string'?p.machineId:undefined,
    image: p.image,
    hourly: typeof p.cost === "number" ? p.cost : undefined,
    ...(ssh?.host && ssh?.port && ssh.username === "root"
      ? { ssh: { host: ssh.host, port: Number(ssh.port), user: "root" } }
      : {}),
  };
}
function vastResource(p: any): RentalResource {
  if (!p || !Number.isSafeInteger(p.id))
    throw Error("Vast returned an invalid instance.");
  const direct = p.ports?.["22/tcp"]?.[0]?.HostPort,
    host = direct ? p.public_ipaddr : p.ssh_host,
    port = Number(direct ?? p.ssh_port);
  return {
    id: String(p.id),
    status: String(p.actual_status ?? p.cur_state),
    startup_stage: startupStage(p.status_msg) ?? (!host && (p.actual_status ?? p.cur_state) === 'running' ? 'waiting_for_ssh' : undefined),
    host_id:p.machine_id!=null?String(p.machine_id):undefined,
    image: p.image_uuid ?? p.image,
    hourly: p.dph_total,
    ...(host && port ? { ssh: { host, port, user: "root" } } : {}),
  };
}
export function createProviders(
  paths: StudioPaths,
  fetcher: typeof fetch = fetch,
  diagnostics?: Diagnostics,
): Record<Provider, ProviderDriver> {
  const rp = new ProviderApi(
      "runpod",
      () => credential(paths, "runpodApiKey"),
      fetcher,
      diagnostics,
    ),
    vast = new ProviderApi(
      "vast",
      () => credential(paths, "vastApiKey"),
      fetcher,
      diagnostics,
    );
  const listPods = async (key?: string) => {
    const r = await rp.request("pods", "GET", undefined, key);
    if (!Array.isArray(r?.pods)) throw Error("Cannot verify RunPod rentals.");
    return r.pods as any[];
  };
  const listVast = async (key?: string) => {
    const result: any[] = [],
      seen = new Set<string>();
    let token: string | undefined;
    do {
      const r = await vast.request(
        "/api/v1/instances/" +
          (token ? "?after_token=" + encodeURIComponent(token) : ""),
        "GET",
        undefined,
        key,
      );
      if (!Array.isArray(r?.instances))
        throw Error("Cannot verify Vast rentals.");
      result.push(...r.instances);
      token = r.next_token;
      if (
        result.length > 10000 ||
        (token && (typeof token !== "string" || seen.has(token)))
      )
        throw Error("Cannot finish verifying Vast rentals.");
      if (token) seen.add(token);
    } while (token);
    return result;
  };
  const drivers:Record<Provider,ProviderDriver> = {
    runpod: {
      configured: () => rp.configured(),
      async offers(role, release) {
        const catalog = await rp.request(
          "catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE&count=1&minCudaVersion=13.0",
        );
        if (!Array.isArray(catalog?.gpus))
          throw Error("Cannot read the RunPod GPU catalog.");
        return catalog.gpus.flatMap((g: any): OfferResult[] => {
          const vram = Number(g.memory ?? g.memoryInGb),
            price = g.price?.secure;
          if (!runpodAvailable(g, role)) return [];
          // Disposable container disk, documented at $0.10/GB/month (720h).
          // https://docs.runpod.io/pods/pricing, checked 2026-09-22.
          const offer = quote(
            "runpod",
            role,
            release,
            String(g.id),
            vram,
            price,
            (release.disk_gb * 0.1) / 720,
            "Automatic placement",
            16,
          );
          return [{ offer: {
            ...offer,
            cloud: "secure",
            stock: g.availability,
            min_ram_gb: role === "image" ? 48 : 128,
            locations: Array.isArray(g.dataCenters) ? g.dataCenters.flatMap((d: any) =>
              typeof d.id === "string" && ["HIGH", "MEDIUM", "LOW"].includes(d.availability)
                ? [{id: d.id, name: typeof d.name === "string" ? d.name : d.id, stock: d.availability}] : []) : undefined,
          }, data: { gpu_id: g.id } }];
        });
      },
      async create(w, auth) {
        // Refresh price immediately before purchase; never silently exceed the reviewed quote.
        await beforeRental("runpod", async () => {
          const catalog = await rp.request(
            "catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE&count=1&minCudaVersion=13.0",
          );
          const g = catalog?.gpus?.find(
            (g: any) => g.id === w.provider_data.gpu_id,
          );
          if (!runpodAvailable(g, w.worker_class))
            throw new PoolError({code: 'capacity_unavailable', message: 'This GPU capacity is no longer available. Refresh available GPUs and choose another offer.', provider: 'runpod', retryable: true});
          if (g.price.secure > w.compute_hourly)
            throw new PoolError({
              code: "quote_changed",
              message:
                "This GPU price increased. Refresh available GPUs and review a new quote.",
              provider: "runpod",
              retryable: false,
            });
        });
        return runpodResource(
          await rp.request("pods", "POST", {
            name: `seed-${w.id}`,
            image: w.offer.image,
            cloud: "SECURE",
            disk: w.offer.disk_gb,
            gpu: {
              id: w.provider_data.gpu_id,
              count: 1,
              minCudaVersion: "13.0",
              minRamPerGpu: w.worker_class === "image" ? 48 : 128,
            },
            ports: ["22/tcp"],
            env: environment(w, auth),
          }),
        );
      },
      async find(w) {
        if (w.resource) {
          const p = await rp.request(
            "pods/" + encodeURIComponent(w.resource.id),
          );
          return p ? verifiedResource(w, runpodResource(p)) : null;
        }
        const found = (await listPods()).filter(
          (p) => p.name === `seed-${w.id}`,
        );
        if (found.length > 1)
          throw Error("More than one pod matches this launch.");
        return found.length ? runpodResource(found[0]) : null;
      },
      async destroy(w) {
        if (!w.resource) throw Error("Cannot terminate an unidentified pod.");
        try {
          await rp.request(
            "pods/" + encodeURIComponent(w.resource.id),
            "DELETE",
          );
        } catch (error) {
          if (
            (await rp.request("pods/" + encodeURIComponent(w.resource.id))) ===
            null
          )
            return;
          throw error;
        }
      },
      async validateCredential(key, workers) {
        const pods = await listPods(key);
        if (
          workers.some(
            (w) => w.resource && !pods.some((p) => p.id === w.resource!.id),
          ) ||
          workers.some((w) => !w.resource)
        )
          throw Error(
            "The replacement key cannot verify every active or uncertain rental. Keep the current key until those workers are resolved.",
          );
      },
    },
    vast: {
      configured: () => vast.configured(),
      async offers(role, release) {
        const r = await vast.request("/api/v0/bundles/", "POST", {
          verified: { eq: true },
          external: { eq: false },
          rentable: { eq: true },
          rented: { eq: false },
          num_gpus: { eq: 1 },
          gpu_ram: { gte: (role === "image" ? 32 : 96) * 1000 },
          cpu_ram: { gte: (role === "image" ? 48 : 128) * 1000 },
          cuda_max_good: { gte: 13 },
          direct_port_count: { gte: 1 },
          disk_space: { gte: release.disk_gb },
          reliability2: { gte: 0.99 },
          type: "on-demand",
          allocated_storage: release.disk_gb,
          order: [["reliability2", "desc"], ["inet_down", "desc"], ["dph_total", "asc"]],
          limit: 50,
        });
        if (!Array.isArray(r?.offers))
          throw Error("Cannot read the Vast GPU catalog.");
        return r.offers.flatMap((g: any): OfferResult[] => {
          if (!vastAvailable(g, role, release.disk_gb)) return [];
          const storage = Number.isFinite(g.storage_cost)
            ? (g.storage_cost * release.disk_gb) / 720
            : 0;
          if (storage > g.dph_total) return [];
          return [
            {
              offer: {
                ...quote(
                  "vast",
                  role,
                  release,
                  g.gpu_name,
                  Number(g.gpu_ram) / 1000,
                  g.dph_total - storage,
                  storage,
                  String(g.geolocation ?? "Unknown region"),
                ),
                cpu_cores: g.cpu_cores_effective,
                ram_gb: Number(g.cpu_ram) / 1000,
                power_watts: g.gpu_max_power,
                // Vast's CLI documents inet_down in Mb/s, rates in $/GB.
                download_mbps: nonnegative(g.inet_down),
                download_per_gb: nonnegative(g.inet_down_cost),
                upload_per_gb: nonnegative(g.inet_up_cost),
                reliability: g.reliability2 <= 1 ? nonnegative(g.reliability2) : undefined,
                verified: g.verification === "verified",
                machine_id: g.machine_id == null ? undefined : String(g.machine_id),
              },
              data: { offer_id: g.id },
            },
          ];
        });
      },
      async create(w, auth) {
        await beforeRental("vast", async () => {
          const current = await vast.request("/api/v0/bundles/", "POST", {
            // The listing's id is an ask contract ID; the search's id filter
            // addresses a different identifier and can hide an available offer.
            ask_contract_id: { eq: w.provider_data.offer_id },
            rentable: { eq: true },
            rented: { eq: false },
            type: "on-demand",
            allocated_storage: w.offer.disk_gb,
            limit: 1,
          });
          const offer = current?.offers?.find(
            (o: any) => o.id === w.provider_data.offer_id,
          );
          if (!vastAvailable(offer, w.worker_class, w.offer.disk_gb) || offer.gpu_name !== w.gpu)
            throw new PoolError({code: 'capacity_unavailable', message: 'This Vast offer is no longer available. Refresh available GPUs and choose another offer.', provider: 'vast', retryable: true});
          if (offer.dph_total > w.hourly)
            throw new PoolError({
              code: "quote_changed",
              message:
                "This Vast offer price increased. Refresh available GPUs and review a new quote.",
              provider: "vast",
              retryable: false,
            });
        });
        // Vast's args launch honors our startup and avoids a second provider sshd.
        // The official CLI sends parsed env objects, including port flag keys.
        // Account-wide SSH registration would modify unrelated existing rentals.
        const r = await vast.request(
          "/api/v0/asks/" +
            encodeURIComponent(String(w.provider_data.offer_id)) +
            "/",
          "PUT",
          {
            client_id: "me",
            image: w.offer.image,
            disk: w.offer.disk_gb,
            label: `seed-${w.id}`,
            runtype: "args",
            args: ["/opt/venv/bin/python", "-m", "worker.entrypoint"],
            cancel_unavail: true,
            env: { ...environment(w, auth), "-p 22:22": "1" },
          },
        );
        if (r?.success === false) throw providerFailure(400,'vast',r);
        if (!Number.isSafeInteger(r?.new_contract))
          throw new PoolError(
            {
              code: "launch_uncertain",
              message:
                "Vast did not confirm the rental ID. Seed will reconcile this launch without repeating it.",
              provider: "vast",
              retryable: true,
            },
            false,
          );
        return { id: String(r.new_contract), status: "starting" };
      },
      async find(w) {
        if (w.resource) {
          const r = await vast.request(
            "/api/v0/instances/" + encodeURIComponent(w.resource.id) + "/",
          );
          if (r === null) return null;
          const p = r?.instances;
          // Vast also returns HTTP 200 with an explicit null after deletion.
          // Missing/malformed payloads must still fail verification below.
          if (p === null) return null;
          if (!p || Array.isArray(p))
            throw Error("Cannot verify this Vast instance.");
          return verifiedResource(w, vastResource(p));
        }
        const found = (await listVast()).filter(
          (p) => p.label === `seed-${w.id}`,
        );
        if (found.length > 1)
          throw Error("More than one instance matches this launch.");
        return found.length ? vastResource(found[0]) : null;
      },
      async prepareAccess(w, publicKey) {
        if (!w.resource) throw Error("Cannot prepare access to an unidentified instance.");
        // Vast can replace authorized_keys during container startup. Register
        // this rental's existing key with the instance, never the account.
        const result = await vast.request(
          "/api/v0/instances/" + encodeURIComponent(w.resource.id) + "/ssh/",
          "POST", { ssh_key: publicKey },
        );
        if (result?.success !== true && result?.msg !== "SSH key already associated with instance.")
          throw Error("Vast has not confirmed this worker's SSH access.");
      },
      async destroy(w) {
        if (!w.resource)
          throw Error("Cannot terminate an unidentified instance.");
        await vast.request(
          "/api/v0/instances/" + encodeURIComponent(w.resource.id) + "/",
          "DELETE",
        );
      },
      async validateCredential(key, workers) {
        const instances = await listVast(key);
        if (
          workers.some(
            (w) =>
              w.resource &&
              !instances.some((p) => String(p.id) === w.resource!.id),
          ) ||
          workers.some((w) => !w.resource)
        )
          throw Error(
            "The replacement key cannot verify every active or uncertain rental. Keep the current key until those workers are resolved.",
          );
      },
    },
  };
  if(diagnostics) for(const [provider,driver] of Object.entries(drivers)) {
    const logs=new ProviderLogs(paths,diagnostics,fetcher);
    driver.collectStartupLogs=(w,signal,cursor)=>logs.collect(w,signal,cursor);
    for(const operation of ['offers','create','find','prepareAccess','destroy','validateCredential'] as const) {
      const original=driver[operation];
      if(!original)continue;
      (driver as any)[operation]=(...args:any[])=>diagnostics.within({provider,
        ...(['create','find','prepareAccess','destroy'].includes(operation)?{worker_id:args[0].id}:{})},async()=>{
        if(operation==='create')diagnostics.registerSecret(args[1].pairing_secret);
        try{return await (original as any).apply(driver,args);}
        catch(error){diagnostics.error('provider.'+operation,error);throw error;}
      });
    }
  }
  return drivers;
}
