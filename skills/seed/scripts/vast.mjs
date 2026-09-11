#!/usr/bin/env node
import { readFile, mkdir, access, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, isIP } from "node:net";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { readJson, saveJson, requestJson, assertIdle } from "./common.mjs";

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
  "preparation",
  "stop",
  "destroy",
  "billing",
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
export function run(file, args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
    });
    child.stderr.resume(); // Do not echo arbitrary command output that could contain credentials.
    child.stdin.on("error", () => {});
    child.once("error", () =>
      reject(new Error(`${path.basename(file)} could not start.`)),
    );
    child.once("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString("utf8"))
        : reject(
            new Error(
              `${path.basename(file)} failed (exit ${code}); inspect the private service log.`,
            ),
          ),
    );
    child.stdin.end(input);
  });
}
async function background(script, args, log) {
  await mkdir(path.dirname(log), { recursive: true, mode: 0o700 });
  const handle = await open(log, "a", 0o600);
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          ![
            "VAST_API_KEY",
            "RUNPOD_API_KEY",
            "HF_TOKEN",
            "HUGGING_FACE_HUB_TOKEN",
            "CIVITAI_API_TOKEN",
            "SEED_PAIRING_SECRET",
            "JUPYTER_TOKEN",
          ].includes(key.toUpperCase()),
      ),
    );
    const child = spawn(process.execPath, [script, ...args], {
      env,
      detached: true,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", handle.fd, handle.fd],
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  } finally {
    await handle.close();
  }
}
export async function freePort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(new Error(`Local tunnel port ${port} is occupied.`)),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
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
    connection.endpoint !== workerOrigin
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
export function sshArgs(instance, key, knownHosts) {
  const port = Number(instance.ports?.["22/tcp"]?.[0]?.HostPort);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !isIP(instance.public_ipaddr ?? "")
  )
    throw new Error("Direct SSH is not ready.");
  return [
    "-i",
    key,
    "-p",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile="${knownHosts.replaceAll("\\", "/").replaceAll('"', '\\"')}"`,
    `root@${instance.public_ipaddr}`,
  ];
}
export class SeedVast {
  constructor(
    repo,
    { fetcher = fetch, env = process.env, startBackground = background, checkPort = freePort } = {},
  ) {
    this.repo = path.resolve(repo);
    this.work = path.join(this.repo, ".local/seed-vast");
    this.fetcher = fetcher;
    this.env = env;
    this.startBackground = startBackground;
    this.checkPort = checkPort;
  }
  async init() {
    this.stateFile = path.join(this.work, "state.json");
    this.state = await readJson(this.stateFile);
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
        "No retained instance in this checkout. Inspect status/offers.",
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
  } = {}) {
    if (!Number.isSafeInteger(disk) || disk < 120)
      throw new Error(
        "Choose enough disk for the approximately 100 GB manifest and working space.",
      );
    const q = {
      verified: { eq: true },
      external: { eq: false },
      rentable: { eq: true },
      rented: { eq: false },
      num_gpus: { eq: 1 },
      gpu_name: { in: gpus },
      gpu_ram: { gte: 90000 },
      cpu_ram: { gte: 96000 },
      cuda_max_good: { gte: 13 },
      direct_port_count: { gte: 1 },
      disk_space: { gte: disk },
      reliability2: { gte: 0.99 },
      type: "on-demand",
      allocated_storage: disk,
      order: [["dph_total", "asc"]],
      limit: 20,
    };
    const r = await this.api("POST", "/api/v0/bundles/", q);
    if (!Array.isArray(r.offers)) throw new Error("Invalid offer listing.");
    await saveJson(path.join(this.work, "offers.json"), r.offers);
    return r.offers.map((o) =>
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
      ]),
    );
  }
  async requireModels() {
    const { modelManifest } = await import(pathToFileURL(path.join(this.repo, "dist/server/model-cache.js")));
    return modelManifest(this.paths);
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
    const cached = (
      await readJson(path.join(this.work, "offers.json"), [])
    ).find((o) => o.id === offerId);
    if (!cached)
      throw new Error("Run offers and choose a returned offer first.");
    const r = await this.api("POST", "/api/v0/bundles/", {
      machine_id: { eq: cached.machine_id },
      rentable: { eq: true },
      rented: { eq: false },
      num_gpus: { eq: 1 },
      type: "on-demand",
      allocated_storage: disk,
      limit: 100,
    });
    const offer = r.offers?.find((o) => o.id === offerId);
    validateOffer(offer, cached, maxHourly);
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
    const created = await this.api("PUT", `/api/v0/asks/${offerId}/`, {
      client_id: "me",
      image: this.image,
      disk,
      label: "seed-agent",
      runtype: "ssh_direc ssh_proxy",
      onstart: "chown root:root /root/.ssh /root/.ssh/authorized_keys && chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys",
      cancel_unavail: true,
      env: {},
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
    return path.join(this.privateDir, `worker-${this.state.instance_id}.json`);
  }
  async boot() {
    const instance = await this.current();
    if (instance.actual_status !== "running")
      throw new Error("Wait for the instance to be running before boot.");
    let secret = await readJson(this.secretFile());
    if (!secret) {
      secret = {
        SEED_PAIRING_SECRET: randomBytes(32).toString("hex"),
        JUPYTER_TOKEN: randomBytes(32).toString("hex"),
      };
      await saveJson(this.secretFile(), secret);
    }
    const payload = { SEED_PAIRING_SECRET: secret.SEED_PAIRING_SECRET, JUPYTER_TOKEN: secret.JUPYTER_TOKEN };
    await this.api("POST", `/api/v0/instances/${instance.id}/ssh/`, {
      ssh_key: (await readFile(this.key + ".pub", "utf8")).trim(),
    });
    const args = sshArgs(instance, this.key, this.knownHosts);
    await run("ssh", [...args, "umask 077; cat > /root/seed-agent-worker.py"], {
      input: await readFile(path.join(here, "worker.py")),
    });
    const existing = JSON.parse(await run("ssh", [...args, "/opt/venv/bin/python /root/seed-agent-worker.py status"]));
    if (existing.running) return { running: true, reused: true };
    const { transferModels } = await import("./model-transfer.mjs");
    await transferModels(this.repo, this.paths, args);
    const result = await run(
      "ssh",
      [...args, "/opt/venv/bin/python /root/seed-agent-worker.py boot"],
      { input: JSON.stringify(payload) },
    );
    return JSON.parse(result);
  }
  async stopTunnel() {
    // Authenticated local control avoids platform-specific PID inspection and PID-reuse risks.
    await this.lifecycle.control(this.tunnelPaths, "stop");
    for (let i = 0; i < 30; i++) {
      if (!(await this.lifecycle.control(this.tunnelPaths, "status"))) return;
      await delay(100);
    }
    throw new Error("The existing SSH tunnel did not stop.");
  }
  async connect() {
    const instance = await this.current();
    if (instance.actual_status !== "running")
      throw new Error("The instance is not running.");
    assertIdle(await this.local("GET", "/api/v1/studio"));
    await this.stopTunnel();
    for (const port of [18080, 18888]) await this.checkPort(port);
    const args = sshArgs(instance, this.key, this.knownHosts);
    const target = args.pop();
    args.push(
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      "127.0.0.1:18080:127.0.0.1:8080",
      "-L",
      "127.0.0.1:18888:127.0.0.1:8888",
      target,
    );
    await mkdir(this.tunnelPaths.config, { recursive: true, mode: 0o700 });
    try {
      await this.startBackground(
        path.join(here, "tunnel.mjs"),
        [this.repo, this.tunnelPaths.config, ...args],
        path.join(this.privateDir, "tunnel.log"),
      );
      let ready = false;
      for (let i = 0; i < 15; i++) {
        try {
          const r = await this.fetcher(workerOrigin, {
            redirect: "error",
            signal: AbortSignal.timeout(2000),
          });
          ready = r.ok;
          await r.body?.cancel();
          if (ready) break;
        } catch {}
        await delay(1000);
      }
      if (!ready)
        throw new Error(
          "Tunnel/worker is not ready. Run status and boot diagnostics.",
        );
      const secret = await readJson(this.secretFile());
      const response = await this.fetcher(workerOrigin + "/worker/v1/unlock", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Origin: workerOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_secret: secret?.SEED_PAIRING_SECRET }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Worker unlock failed. Check boot configuration.");
      }
      const cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      await response.body?.cancel();
      const pairing = await requestJson(
        workerOrigin + "/worker/v1/pairing-codes",
        {
          method: "POST",
          body: {},
          headers: { Origin: workerOrigin, Cookie: cookie },
          fetcher: this.fetcher,
        },
      );
      await this.local("PUT", "/api/v1/connection", {
        connection_code: pairing.connection_code,
      });
      this.state.paired_worker = (
        await readJson(this.connectionFile)
      ).worker_instance_id;
      await this.saveState();
      return {
        connected: true,
        url: this.origin,
        queue: "paused; resume when ready",
      };
    } catch (error) {
      try {
        await this.stopTunnel();
      } catch {
        throw new Error(
          "Connection failed and the tunnel did not stop. Inspect the private tunnel log; the GPU remains allocated.",
        );
      }
      throw error;
    }
  }
  async preparation() {
    const args = sshArgs(await this.current(), this.key, this.knownHosts);
    return JSON.parse(
      await run("ssh", [
        ...args,
        "/opt/venv/bin/python /root/seed-agent-worker.py preparation",
      ]),
    );
  }
  async teardown(action) {
    if (!["stop", "destroy"].includes(action))
      throw new Error("Invalid teardown action.");
    const instance = await this.current();
    if (
      instance.cur_state === "running" ||
      instance.actual_status === "running"
    )
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
      repo: { type: "string", default: process.cwd() },
      "offer-id": { type: "string" },
      "max-hourly": { type: "string" },
      "disk-gb": { type: "string", default: "180" },
      gpu: { type: "string", multiple: true },
    },
  });
  const [command] = positionals;
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
  if (command === "offers")
    return app.offers({ disk: Number(values["disk-gb"]), gpus: values.gpu });
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
      console.error(error.message);
      process.exitCode = 1;
    });
}
