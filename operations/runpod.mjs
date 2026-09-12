#!/usr/bin/env node
// Seed-specific pairing and sanitized reads. Use the provider CLI/MCP for provisioning.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { readJson, requestJson, assertIdle, saveJson } from "./common.mjs";
export function validatePodId(id) {
  if(!/^[a-z0-9]+$/.test(id??''))throw Error('Supply the exact RunPod pod ID.');
  return id;
}
export class SeedRunpod {
  constructor(repo, { fetcher = fetch, env = process.env } = {}) {
    this.repo = path.resolve(repo);
    this.fetcher = fetcher;
    this.env = env;
  }
  async init() {
    const { resolvePaths } = await import(
      pathToFileURL(path.join(this.repo, "dist/server/storage.js"))
    );
    const { settings } = await import(
      pathToFileURL(path.join(this.repo, "dist/server/settings.js"))
    );
    this.paths = resolvePaths(this.env.STUDIO_DEV_ROOT);
    this.stateFile = path.join(this.paths.config, 'runpod-rental.json');
    this.state = await readJson(this.stateFile);
    this.image = (await import(pathToFileURL(path.join(this.repo, 'dist/shared/worker-release.js')))).workerRelease.image;
    const config = settings(this.paths);
    this.origin = `http://${config.host}:${config.port}`;
    return this;
  }
  async api(route, method = 'GET', body) {
    const creds = await readJson(
      path.join(this.paths.config, "credentials.json"),
      {},
    );
    const key = this.env.RUNPOD_API_KEY?.trim() || creds.runpodApiKey;
    if (!key) throw new Error("Run seed setup --provider runpod first.");
    return requestJson(`https://api.runpod.io/v2/${route}`, {
      method, body,
      headers: { Authorization: `Bearer ${key}` },
      timeout: 30000,
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
  async status() {
    const data = await this.api("pods");
    if (!Array.isArray(data.pods)) throw new Error("Invalid pod listing.");
    const pods = data.pods.map(
      ({ id, name, status, gpu, cost, dataCenterId, template, actions, ssh, runtime }) => ({
        id,
        name,
        status,
        gpu,
        cost,
        dataCenterId,
        template,
        actions, ssh, runtime,
      }),
    );
    let studio = null;
    try {
      studio = await this.local("GET", "/api/v1/studio");
    } catch {}
    return { pods, studio };
  }
  async catalog() {
    return this.api("catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE&count=1&minCudaVersion=13.0");
  }
  async datacenters() { return this.api('catalog/datacenters?include=GPU_AVAILABILITY'); }
  async billing(id=this.state?.pod_id) {
    validatePodId(id);
    return this.api(`billing/pods?podId=${id}&lastN=24`);
  }
  async connect(id=this.state?.pod_id,{reconnect=false}={}) {
    validatePodId(id);
    const pod=await this.api(`pods/${id}`);
    const deployment=await readJson(path.join(this.paths.config,'pod-deployment.json'));
    if(!deployment?.pairingSecret||this.state?.pod_id!==id||this.state.image!==pod.image||pod.image!==this.image)
      throw Error('Pod must match the recorded Seed rental and pinned image before sending its pairing secret.');
    const direct=pod.ssh?.direct;
    const {sshArgs}=await import('./ssh.mjs');
    const dir=path.join(this.paths.config,'seed-runpod');
    return (await import('./connection.mjs')).connectWorker(this,{
      ssh:()=>{
        if(!direct||direct.username!=='root')throw Error('Direct root SSH is not ready.');
        return sshArgs({public_ipaddr:direct.host,ports:{'22/tcp':[{HostPort:direct.port}]}},path.join(dir,'ssh-key'),path.join(dir,'known-hosts'));
      },
      secret:deployment.pairingSecret,reconnect,
    });
  }
  async safe(id, { sleep = delay, attempts = 30 } = {}) {
    const connection = await readJson(
      path.join(this.paths.config, "worker-connection.json"),
    );
    if (this.state?.pod_id !== id || !this.state?.paired_worker || connection?.worker_instance_id !== this.state.paired_worker)
      throw new Error(
        "Seed is not paired to this pod. Reconcile before teardown.",
      );
    await this.local("POST", "/api/v1/queue/pause", {});
    for (let i = 0; i < attempts; i++) {
      const status = await this.local("GET", "/api/v1/studio");
      if (status.safe_to_terminate === true)
        return { safe_to_terminate: true, pod_id: id };
      await sleep(500);
    }
    throw new Error(
      "No fresh safe-to-terminate confirmation. Wait for work and transfers; check again.",
    );
  }
}
export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string", default: process.cwd() },
      pod: { type: "string" },
      gpu: { type: 'string' },
      'max-hourly': { type: 'string' },
      'disk-gb': {type:'string',default:'180'},
      datacenter: {type:'string',multiple:true},
    },
  });
  const [command] = positionals;
  if(command==='help') return {
    provider:'runpod',
    commands:{catalog:'GPU prices, CUDA and per-region capacity',datacenters:'Region capabilities and availability',status:'Provider state, SSH/runtime and local studio',create:'--gpu ID --max-hourly USD [--disk-gb 180] [--datacenter ID (repeatable)]; global disposable placement by default',wait:'Wait for direct SSH with progress; no fixed deadline',prepare:'Direct model preparation and optional PC fallback',connect:'--pod ID; pair recorded worker',logs:'[--pod ID]; bounded sanitized log tail',billing:'[--pod ID]; provider billing may lag',reconcile:'Inspect uncertain rental before retrying',safe:'--pod ID; verify saved outputs',destroy:'Delete recorded pod and disposable disk'},
    unknown_metrics:['Host reliability','Measured host network throughput'],
  };
  if (
    positionals.length !== 1 ||
    !["status", "catalog", "datacenters", "logs", "billing", "connect", "reconnect", "safe", "create", "wait", "prepare", "destroy", "reconcile"].includes(command)
  )
    throw new Error("Use seed gpu runpod help for commands and options.");
  const app = await new SeedRunpod(values.repo).init();
  if(['connect','reconnect'].includes(command))return app.connect(values.pod,{reconnect:command==='reconnect'});
  if(command==='logs') {const {podLogs}=await import('./runpod-logs.mjs');return podLogs(app,values.pod);}
  if (['create','wait','prepare','destroy','reconcile'].includes(command)) {
    const {createPod,lifecycle} = await import('./runpod-lifecycle.mjs');
    return command==='create' ? createPod(app,{gpu:values.gpu,maxHourly:Number(values['max-hourly']),disk:Number(values['disk-gb']),datacenters:values.datacenter}) : lifecycle(app,command,values.pod);
  }
  return app[command](values.pod);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({error:{message:error.message,...(error.provider?{provider:error.provider}:{})}},null,2));
      process.exitCode = 1;
    });
