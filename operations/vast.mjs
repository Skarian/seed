#!/usr/bin/env node
import { readFile, mkdir, access, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { randomBytes } from "node:crypto";
import { spawn } from 'node:child_process';

import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { readJson, saveJson, requestJson, assertIdle } from "./common.mjs";
import {run,background,freePort,sshArgs} from './ssh.mjs';
export {run,freePort,sshArgs} from './ssh.mjs';
import { waitFor } from './wait.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const workerOrigin = "http://127.0.0.1:18080";
const commands = [
  "doctor",
  "setup",
  "offers",
  "rent",
  "status",
  "boot",
  "connect",
  "reconnect",
  "preparation",
  "stop",
  "destroy",
  "billing",
  "wait",
  "reconcile",
  "logs",
];
const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
export function validateOffer(offer, cached, maxHourly) {
  if (!Number.isFinite(maxHourly) || maxHourly <= 0)
    throw new Error("Set a finite, positive approved --max-hourly.");
  if (
    !offer ||
    offer.num_gpus !== 1 ||
    !Number.isFinite(offer.dph_total) ||
    offer.dph_total < 0 ||
    offer.dph_total > maxHourly ||
    offer.gpu_name !== cached.gpu_name
  )
    throw new Error(
      "Offer disappeared, changed hardware or exceeds the approved price.",
    );
}
export async function safeShutdown(
  state,
  connection,
  local,
  { sleep = delay, attempts = 30 } = {},
) {
  if (
    !state?.paired_worker ||
    connection?.worker_instance_id !== state.paired_worker ||
    connection.endpoint !== (state.route==='tailscale'?state.tailscale_endpoint:workerOrigin)
  )
    throw new Error(
      "Seed is not paired to this recorded worker. Reconnect before teardown.",
    );
  await local("POST", "/api/v1/queue/pause", {});
  for (let i = 0; i < attempts; i++) {
    if ((await local("GET", "/api/v1/studio")).safe_to_terminate === true)
      return;
    await sleep(500);
  }
  throw new Error(
    "No fresh safe-shutdown confirmation. Reconnect and reconcile before teardown.",
  );
}
export class SeedVast {
  constructor(
    repo,
    { fetcher = fetch, env = process.env, startBackground = background, checkPort = freePort } = {},
  ) {
    this.repo = path.resolve(repo);
    this.fetcher = fetcher;
    this.env = env;
    this.startBackground = startBackground;
    this.checkPort = checkPort;
  }
  async init() {
    const load = (file) =>
      import(pathToFileURL(path.join(this.repo, "dist/server", file)).href);
    try {
      const { resolvePaths } = await load("storage.js");
      const { settings } = await load("settings.js");
      this.paths = resolvePaths(this.env.STUDIO_DEV_ROOT);
      this.settings = settings(this.paths);
      this.lifecycle = await load("lifecycle.js");
    } catch {
      throw new Error(
        "Install Seed dependencies and run npm run build in --repo first.",
      );
    }
    this.image = (
      await import(
        pathToFileURL(path.join(this.repo, "dist/shared/worker-release.js"))
          .href
      )
    ).workerRelease.image;
    this.origin = `http://${this.settings.host}:${this.settings.port}`;
    // Use the same per-user private config convention as Seed; never a repository .env.
    this.credentialFile = path.join(this.paths.config, "credentials.json");
    this.privateDir = path.join(this.paths.config, "seed-vast");
    this.work = this.privateDir;
    this.stateFile = path.join(this.work, "state.json");
    this.state = await readJson(this.stateFile);
    this.tunnelPaths = { config: path.join(this.privateDir, "tunnel") };
    this.key = path.join(this.privateDir, "ssh-key");
    this.knownHosts = path.join(this.privateDir, "known-hosts");
    this.connectionFile = path.join(
      this.paths.config,
      "worker-connection.json",
    );
    return this;
  }
  async credentials() {
    return await readJson(this.credentialFile, {});
  }
  async saveState() {
    await saveJson(this.stateFile, this.state);
  }
  async api(method, route, body) {
    const token =
      this.env.VAST_API_KEY?.trim() || (await this.credentials()).vastApiKey;
    if (!token)
      throw new Error(
        "Vast API key missing. Run setup or provide VAST_API_KEY in the environment.",
      );
    return requestJson("https://console.vast.ai" + route, {
      method,
      body,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 45000,
      fetcher: this.fetcher,
    });
  }
  async local(method, route, body) {
    return requestJson(this.origin + route, {
      method,
      body,
      headers: { Origin: this.origin },
      fetcher: this.fetcher,
    });
  }
  async instances() {
    const items = [];
    let next;
    do {
      const q = new URLSearchParams({
        limit: "100",
        ...(next ? { after_token: next } : {}),
      });
      const r = await this.api("GET", `/api/v1/instances/?${q}`);
      if (!Array.isArray(r.instances))
        throw new Error("Invalid instance listing.");
      items.push(...r.instances);
      next = r.next_token;
    } while (next);
    return items;
  }
  async current() {
    if (!Number.isSafeInteger(this.state?.instance_id) || this.state.destroyed)
      throw new Error(
        "No retained instance in your Seed configuration. Inspect status/offers.",
      );
    const r = await this.api(
      "GET",
      `/api/v0/instances/${this.state.instance_id}/`,
    );
    if (r.instances?.id !== this.state.instance_id)
      throw new Error("Saved instance not found.");
    return r.instances;
  }
  async doctor() {
    const c = await this.credentials(),
      tools = { node: process.version };
    for (const [tool, args] of [
      ["ssh", ["-V"]],
      ["ssh-keygen", ["-?"]],
    ]) {
      tools[tool] = await new Promise((resolve) => {
        const child = spawn(tool, args, {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
        child.once("error", () => resolve(false));
        child.once("spawn", () => resolve(true));
      });
    }
    return {
      platform: process.platform,
      tools,
      built: true,
      state_present: Boolean(this.state),
      credentials: {
        vast: Boolean(this.env.VAST_API_KEY || c.vastApiKey),
        hf: Boolean(this.env.HF_TOKEN || c.huggingFaceToken),
        civitai: Boolean(this.env.CIVITAI_API_TOKEN || c.civitaiApiToken),
      },
    };
  }
  async setup() {
    // One shared setup owns provider credentials, app directories and sign-in preference.
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(this.repo, "dist/server/cli.js"),
          "setup",
          "--provider",
          "vast",
        ],
        {
          cwd: this.repo,
          env: this.env,
          windowsHide: true,
          shell: false,
          stdio: "inherit",
        },
      );
      child.once("error", () =>
        reject(new Error("Seed setup could not start.")),
      );
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Seed setup did not complete.")),
      );
    });
    const u = await this.api("GET", "/api/v0/users/current/");
    return { authenticated: true, credit: u.credit };
  }

  async offers({
    disk = 180,
    gpus = ["RTX PRO 6000 WS", "RTX PRO 6000 S"],
    allGpus = false,
    minVram = 90,
    minRam = 96,
    maxHourly,
    minDownload = 0,
  } = {}) {
    if (!Number.isSafeInteger(disk) || disk < 120)
      throw new Error(
        "Choose enough disk for the approximately 100 GB manifest and working space.",
      );
    if (!Number.isFinite(minVram) || minVram<=0 || !Number.isFinite(minRam) || minRam<=0) throw Error('Invalid hardware search limits.');
    if ((maxHourly!==undefined && (!Number.isFinite(maxHourly) || maxHourly<=0)) || !Number.isFinite(minDownload) || minDownload<0)throw Error('Invalid price or network search limit.');
    const q = {
      verified: { eq: true },
      external: { eq: false },
      rentable: { eq: true },
      rented: { eq: false },
      num_gpus: { eq: 1 },
      ...(allGpus ? {} : {gpu_name: { in: gpus }}),
      gpu_ram: { gte: minVram * 1000 },
      cpu_ram: { gte: minRam * 1000 },
      cuda_max_good: { gte: 13 },
      direct_port_count: { gte: 1 },
      disk_space: { gte: disk },
      reliability2: { gte: 0.99 },
      ...(maxHourly===undefined ? {} : {dph_total:{lte:maxHourly}}),
      ...(minDownload ? {inet_down:{gte:minDownload}} : {}),
      type: "on-demand",
      allocated_storage: disk,
      order: [["reliability2", "desc"], ["inet_down", "desc"], ["dph_total", "asc"]],
      limit: 50,
    };
    const r = await this.api("POST", "/api/v0/bundles/", q);
    if (!Array.isArray(r.offers)) throw new Error("Invalid offer listing.");
    // Validate the returned status too: provider filter aliases have changed.
    const offers=r.offers.filter(o=>o.verification==='verified' && o.reliability2>=0.99);
    await saveJson(path.join(this.work, "offers.json"), {searched_at:Date.now(),disk_gb:disk,offers});
    return offers.map((o) =>
      pick(o, [
        "id",
        "machine_id",
        "gpu_name",
        "gpu_ram",
        "gpu_max_power",
        "cpu_ram",
        "geolocation",
        "dph_total",
        "storage_cost",
        "inet_down",
        "inet_down_cost",
        "inet_up_cost",
        "reliability2",
        "verification",
      ]),
    );
  }
  async requireModels() {
    const { modelManifest } = await import(pathToFileURL(path.join(this.repo, "dist/server/model-cache.js")));
    return modelManifest(this.paths);
  }
  async wait({probe = run, ...options} = {}) {
    return waitFor(async () => {
      const instance = await this.current();
      if (instance.actual_status === 'error') throw new Error('Vast startup failed. Inspect provider logs before recovery.');
      if (instance.actual_status !== 'running') return null;
      try { await probe('ssh', [...sshArgs(instance, this.key, this.knownHosts), 'true']); } catch { return null; }
      return { ready_for_preparation: true, instance_id: instance.id };
    }, options);
  }
  async reconcile() {
    if (!this.state || this.state.destroyed) return { reconciled: true, rental: null };
    const instances = await this.instances();
    if (this.state.instance_id) {
      const current = instances.find(i => i.id === this.state.instance_id);
      if (current) {
        delete this.state.absent_since;
        await this.saveState();
        return { reconciled: true, instance_id: current.id, status: current.actual_status };
      }
    } else if (instances.length) {
      delete this.state.absent_since;
      await this.saveState();
      throw new Error('Uncertain rental and instances exist. Inspect provider state; no new rental is permitted.');
    }
    // A read after an uncertain mutation may race provider propagation. Require a
    // second empty observation on a later command before allowing another rental.
    if (!this.state.absent_since) {
      this.state.absent_since = new Date().toISOString();
      await this.saveState();
      return { reconciled: false, next: 'Run reconcile again after 30 seconds to confirm absence.' };
    }
    if (Date.now() - Date.parse(this.state.absent_since) < 30000)
      return { reconciled: false, next: 'Wait 30 seconds after the first absence check.' };
    this.state.destroyed = true;
    await this.saveState();
    return { reconciled: true, rental: null };
  }
  async rent({ offerId, maxHourly, disk = 180 }) {
    if (
      !Number.isSafeInteger(offerId) ||
      offerId <= 0 ||
      !Number.isFinite(maxHourly) ||
      maxHourly <= 0 ||
      !Number.isSafeInteger(disk) ||
      disk < 120
    )
      throw new Error(
        "Specify an approved --offer-id, finite positive --max-hourly and adequate --disk-gb.",
      );
    if (this.state && !this.state.destroyed)
      throw new Error(
        "A saved rental or uncertain attempt exists. Inspect it before creating another.",
      );
    if (
      (await this.instances()).some(
        (i) =>
          i.cur_state === "running" ||
          ["running", "loading", "created"].includes(i.actual_status),
      )
    )
      throw new Error("An active Vast instance already exists.");
    await this.requireModels();
    const listing = await readJson(path.join(this.work, "offers.json"));
    const age = Date.now() - listing?.searched_at;
    if (!Number.isFinite(age) || age < 0 || age > 60000 || listing.disk_gb !== disk)
      throw Error('Refresh offers with the requested disk size before renting (listing expires after 60 seconds).');
    const offer = listing.offers?.find(o => o.id === offerId);
    if (!offer) throw Error('Run offers and choose a returned offer first.');
    validateOffer(offer, offer, maxHourly);
    if (offer.verification !== 'verified' || !Number.isFinite(offer.reliability2) || offer.reliability2 < 0.99)
      throw Error('Select a verified, reliable host.');
    // Accept the fresh offer ID directly, as Vast's documented search/create flow
    // does. A second host search can return a different set of GPU slices.
    await mkdir(this.privateDir, { recursive: true, mode: 0o700 });
    if (!(await exists(this.key)))
      await run("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-f",
        this.key,
        "-N",
        "",
        "-C",
        "seed-vast-agent",
      ]);
    const publicKey = (await readFile(this.key + ".pub", "utf8")).trim();
    await this.ensureAccountKey(publicKey);
    this.state = {
      offer_id: offerId,
      machine_id: offer.machine_id,
      hourly: offer.dph_total,
      disk_gb: disk,
      image: this.image,
      attempt_at: new Date().toISOString(),
      destroyed: false,
    };
    await this.saveState(); // An ambiguous request deliberately leaves a recovery record.
    const launch = {SEED_PAIRING_SECRET:randomBytes(32).toString('hex'),JUPYTER_TOKEN:randomBytes(32).toString('hex')};
    await saveJson(this.secretFile(),launch);
    const created = await this.api("PUT", `/api/v0/asks/${offerId}/`, {
      client_id: "me",
      image: this.image,
      disk,
      label: "seed-agent",
      runtype: "ssh_direc ssh_proxy",
      onstart: "cd /opt/seed && exec /opt/venv/bin/python -m worker.entrypoint",
      cancel_unavail: true,
      env: {...launch,PUBLIC_KEY:publicKey,SEED_START_SSH:'1',SEED_TRANSPORT:'ssh'},
    });
    if (!created.success || !Number.isSafeInteger(created.new_contract))
      throw new Error(
        "No confirmed contract ID. Inspect instances; do not retry blindly.",
      );
    this.state.instance_id = created.new_contract;
    await this.saveState();
    return {
      instance_id: created.new_contract,
      hourly: offer.dph_total,
      disk_gb: disk,
    };
  }
  async ensureAccountKey(publicKey) {
    const response = await this.api("GET", "/api/v0/ssh/");
    const keys = Array.isArray(response) ? response : response.ssh_keys;
    if (!Array.isArray(keys)) throw new Error("Cannot verify account SSH keys.");
    if (!keys.some((key) => (key.public_key ?? key.ssh_key)?.trim() === publicKey.trim()))
      await this.api("POST", "/api/v0/ssh/", { ssh_key: publicKey });
  }
  async status() {
    const result = {
      instances: (await this.instances()).map((i) =>
        pick(i, [
          "id",
          "label",
          "actual_status",
          "cur_state",
          "gpu_name",
          "dph_total",
        ]),
      ),
    };
    if (this.state?.instance_id && !this.state.destroyed)
      result.current = pick(await this.current(), [
        "id",
        "actual_status",
        "cur_state",
        "status_msg",
        "ssh_host",
        "ssh_port",
        "public_ipaddr",
        "ports",
      ]);
    try {
      result.studio = await this.local("GET", "/api/v1/studio");
    } catch {
      result.studio = null;
    }
    return result;
  }
  secretFile() {
    return path.join(this.privateDir, "worker-launch.json");
  }
  async boot() {
    await this.connect();
    return (await import('./preparation.mjs')).prepareWorker(this);
  }
  async stopTunnel() { return (await import('./connection.mjs')).stopTunnel(this); }
  async connect({reconnect=false,proxy=false,route}={}) {
    const instance=await this.current();
    if(instance.actual_status!=='running')throw Error('The instance is not running.');
    const secret=await readJson(this.secretFile());
    if(!secret?.SEED_PAIRING_SECRET)throw Error('No launch secret for this recorded worker.');
    return (await import('./connection.mjs')).connectWorker(this,{
      ssh:()=>sshArgs(instance,this.key,this.knownHosts,proxy),secret:secret.SEED_PAIRING_SECRET,route,reconnect,
    });
  }
  async preparation() { return (await import('./connection.mjs')).workerRequest(this,'/worker/v1/preparation'); }
  async teardown(action) {
    if (!["stop", "destroy"].includes(action))
      throw new Error("Invalid teardown action.");
    const instance = await this.current();
    if (this.state.paired_worker && !await (await import('./connection.mjs')).cancelUnusedPreparation(this))
      await safeShutdown(
        this.state,
        await readJson(this.connectionFile),
        this.local.bind(this),
      );
    else assertIdle(await this.local("GET", "/api/v1/studio"));
    const result = await this.api(
      action === "destroy" ? "DELETE" : "PUT",
      `/api/v0/instances/${instance.id}/`,
      action === "destroy" ? {} : { state: "stopped" },
    );
    if (!result.success) throw new Error("Teardown was not confirmed.");
    if (action === "destroy") {
      this.state.destroyed = true;
      await this.saveState();
    }
    await this.stopTunnel();
    for (let i = 0; i < 15; i++) {
      const found = (await this.instances()).find((x) => x.id === instance.id);
      if (
        (action === "destroy" && !found) ||
        (action === "stop" && found?.actual_status === "exited")
      )
        return {
          confirmed: action,
          instance_id: instance.id,
          disk_retained: action === "stop",
        };
      await delay(2000);
    }
    throw new Error(
      "Operation accepted but final provider state is not yet confirmed.",
    );
  }
  async billing() {
    const u = await this.api("GET", "/api/v0/users/current/");
    const result = { credit: u.credit, balance: u.balance, charges: [] };
    if (this.state?.instance_id) {
      const from = new Date(this.state.attempt_at);
      from.setUTCHours(0, 0, 0, 0);
      const filters = JSON.stringify({
        day: {
          gte: Math.floor(+from / 1000),
          lte: Math.floor(Date.now() / 1000) + 86400,
        },
      });
      let next;
      do {
        const q = new URLSearchParams({
          limit: "100",
          select_filters: filters,
          ...(next ? { after_token: next } : {}),
        });
        const r = await this.api("GET", `/api/v0/charges/?${q}`);
        result.charges.push(
          ...(r.results ?? []).filter(
            (x) => x.source === `instance-${this.state.instance_id}`,
          ),
        );
        next = r.next_token;
      } while (next);
    }
    return result;
  }
}
export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      route: {type:'string'},
      repo: { type: "string", default: process.cwd() },
      "offer-id": { type: "string" },
      "max-hourly": { type: "string" },
      "disk-gb": { type: "string", default: "180" },
      gpu: { type: "string", multiple: true },
      'all-gpus': {type:'boolean',default:false},
      proxy: {type:'boolean',default:false},
      'daemon-logs': {type:'boolean',default:false},
      'min-vram': { type: 'string', default: '90' },
      'min-ram': { type: 'string', default: '96' },
      'min-download-mbps': {type:'string',default:'0'},
    },
  });
  const [command] = positionals;
  if(values['all-gpus'] && values.gpu)throw Error('Choose --all-gpus or --gpu, not both.');
  if(command==='help')return {
    provider:'vast',
    commands:{doctor:'Local dependencies/configuration',offers:'Verified hosts ordered by reliability and network speed; --gpu NAME (repeatable) or --all-gpus, --disk-gb, --min-vram, --min-ram, --max-hourly, --min-download-mbps',rent:'--offer-id ID --max-hourly USD --disk-gb 180',wait:'Wait for startup/direct SSH with progress; no fixed deadline',boot:'Prepare models and start worker; rerun to resume',preparation:'Worker preparation status',connect:'Private SSH tunnel and automatic pairing; --proxy for provider SSH proxy',reconnect:'Restore recorded worker tunnel without re-pairing or interrupting jobs; optional --proxy',status:'Provider and local studio status',reconcile:'Resolve uncertain creation before retrying',logs:'Save redacted provider logs before cleanup; --daemon-logs for host diagnostics',billing:'Recorded-instance billing and account balance',destroy:'Verify outputs then delete recorded instance/disk',stop:'Explicitly retain billable disk'},
    selection:'Prioritize verified hosts, high reliability and good transfer speeds; consider compute and transfer prices together.'
  };
  if (!commands.includes(command) || positionals.length !== 1)
    throw new Error(
      `Usage: node vast.mjs <${commands.join("|")}> --repo <checkout>`,
    );
  let app;
  try {
    app = await new SeedVast(values.repo).init();
  } catch (error) {
    if (command === "doctor")
      return {
        platform: process.platform,
        node: process.version,
        built: false,
        next: error.message,
      };
    throw error;
  }
  if(command==='logs')return (await import('./vast-logs.mjs')).vastLogs(app,{daemon:values['daemon-logs']});
  if(values.proxy && !['connect','reconnect'].includes(command))throw Error('--proxy applies only to connect or reconnect.');
  if(command==='reconnect')return app.connect({reconnect:true,proxy:values.proxy,route:values.route});
  if(command==='connect')return app.connect({proxy:values.proxy,route:values.route});
  if (command === "offers")
    return app.offers({ disk: Number(values["disk-gb"]), gpus: values.gpu, allGpus:values['all-gpus'], minVram:Number(values['min-vram']), minRam:Number(values['min-ram']),maxHourly:values['max-hourly']===undefined?undefined:Number(values['max-hourly']),minDownload:Number(values['min-download-mbps']) });
  if (command === "rent")
    return app.rent({
      offerId: Number(values["offer-id"]),
      maxHourly: Number(values["max-hourly"]),
      disk: Number(values["disk-gb"]),
    });
  if (["stop", "destroy"].includes(command)) return app.teardown(command);
  return app[command]();
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({error:{message:error.message,...(error.provider?{provider:error.provider}:{})}},null,2));
      process.exitCode = 1;
    });
}
