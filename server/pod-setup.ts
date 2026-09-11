import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import type { StudioPaths } from "./storage.js";
import models from "../worker/models.json" with { type: "json" };

import { workerRelease } from "../shared/worker-release.js";
export { workerRelease } from "../shared/worker-release.js";
type Volume = {
  id: string;
  name: string;
  size: number;
  dataCenter: string;
  type: string;
};
type Deployment = {
  version: 1;
  pairingSecret: string;
  jupyterToken: string;
  volumeId?: string;
  templateId?: string;
};
type Template = { id: string; name: string; public: boolean };
type TemplateConfig = {
  name: string;
  public: false;
  image: string;
  disk: number;
  ports: string[];
  args: string;
  env: Record<string, string>;
  category: "NVIDIA";
  startJupyter: false;
  startSsh: false;
  allowedCudaVersions: string[];
};
type Intent = {
  name: string;
  size: number;
  dataCenter: string;
  type: "STANDARD";
};
const matchesIntent = (volume: Volume, intent: Intent) =>
  volume.name === intent.name &&
  volume.dataCenter === intent.dataCenter &&
  volume.size === intent.size &&
  volume.type === intent.type;
export type OperatorIO = {
  question?: (message: string) => Promise<string>;
  say: (message: string) => void;
};
export type Provider = {
  templates(): Promise<Template[]>;
  createTemplate(config: TemplateConfig): Promise<Template>;
  updateTemplate(id: string, config: TemplateConfig): Promise<Template>;
  volumes(): Promise<Volume[]>;
  datacenters(): Promise<
    { id: string; name: string; networkVolumeTypes: string[] }[]
  >;
  createVolume(intent: Intent): Promise<Volume>;
  storageRate(): Promise<number>;
};
const modelBytes = models.reduce((sum, item) => sum + item.size, 0);
export const recommendedGB = Math.ceil((modelBytes / 1e9 + 30) / 25) * 25;
const read = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(
      `Cannot read ${path.basename(file)}. Repair it before continuing.`,
    );
  }
};
function save(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}
export function deploymentSettings(paths: StudioPaths): Deployment {
  const file = path.join(paths.config, "pod-deployment.json");
  if (!read(file)) {
    try {
      writeFileSync(
        file,
        JSON.stringify(
          {
            version: 1,
            pairingSecret: randomBytes(32).toString("base64url"),
            jupyterToken: randomBytes(32).toString("base64url"),
          },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const value = read<Deployment>(file)!;
  if (
    value.version !== 1 ||
    !/^[\w-]{43}$/.test(value.pairingSecret) ||
    !/^[\w-]{43}$/.test(value.jupyterToken) ||
    (value.volumeId !== undefined && typeof value.volumeId !== "string")
  )
    throw new Error(
      "Invalid pod-deployment.json; repair it before continuing.",
    );
  return value;
}
export function podEnvironment(paths: StudioPaths) {
  const saved = deploymentSettings(paths);
  return {
    SEED_PAIRING_SECRET: saved.pairingSecret,
    JUPYTER_TOKEN: saved.jupyterToken,

  };
}
export function runpodProvider(paths: StudioPaths): Provider {
  const credentials = read<{ runpodApiKey?: string }>(
    path.join(paths.config, "credentials.json"),
  );
  if (!credentials?.runpodApiKey)
    throw new Error("Run seed setup to save your RunPod API key.");
  async function request(
    route: string,
    body?: unknown,
    method = body ? "POST" : "GET",
  ): Promise<any> {
    let response: Response;
    try {
      response = await fetch("https://api.runpod.io/v2/" + route, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${credentials!.runpodApiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "seed/0.1",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error(
        "RunPod request did not complete. Check connectivity and rerun setup; an uncertain storage creation will not be repeated automatically.",
      );
    }
    if (!response.ok)
      throw new Error(
        `RunPod returned HTTP ${response.status}. Check access and your account in the console.`,
      );
    return response.json();
  }
  return {
    templates: async () =>
      Promise.all(
        (await request("templates")).templates.map((item: { id: string }) =>
          request("templates/" + encodeURIComponent(item.id)),
        ),
      ),
    createTemplate: (config) => request("templates", config),
    updateTemplate: (id, config) =>
      request("templates/" + encodeURIComponent(id), config, "PATCH"),
    volumes: async () => (await request("network-volumes")).networkVolumes,
    datacenters: async () =>
      (await request("catalog/datacenters?networkVolumeTypes=STANDARD"))
        .dataCenters,
    createVolume: (intent) => request("network-volumes", intent),
    storageRate: async () => {
      const response = await fetch(
        "https://docs.runpod.io/storage/network-volumes.md",
        { signal: AbortSignal.timeout(15000), redirect: "error" },
      );
      if (!response.ok)
        throw new Error(
          "Cannot verify current storage pricing. Create storage in the RunPod console, then rerun with --volume ID.",
        );
      const text = (await response.text())
        .replaceAll("*", "")
        .replaceAll("\\", "");
      const rate = Number(
        text.match(/First 1 TB:\s*\$([0-9.]+)\/GB\/month/)?.[1],
      );
      if (!Number.isFinite(rate) || rate <= 0 || rate > 1)
        throw new Error(
          "Storage pricing format changed. Review it in the RunPod console before creating storage.",
        );
      return rate;
    },
  };
}

export async function setupTemplate(
  paths: StudioPaths,
  provider = runpodProvider(paths),
) {
  const saved = deploymentSettings(paths);
  const templates = await provider.templates();
  const candidates = templates.filter(
    (item) =>
      item.public === false &&
      (saved.templateId ? item.id === saved.templateId : item.name === "seed"),
  );
  if (candidates.length > 1)
    throw new Error(
      "Multiple private seed templates found. Choose one in pod-deployment.json using templateId.",
    );
  if (saved.templateId && !candidates.length)
    throw new Error(
      "Saved private template is missing or public. Repair its templateId before continuing. No credentials were sent.",
    );
  const config: TemplateConfig = {
    name: "seed",
    public: false,
    image: workerRelease.image,
    disk: 30,
    ports: ["8080/http", "8888/http"],
    args: "/opt/venv/bin/python -m worker.run",
    env: podEnvironment(paths),
    category: "NVIDIA",
    startJupyter: false,
    startSsh: false,
    allowedCudaVersions: ["13.0", "13.2", "13.3"],
  };
  const intent = path.join(paths.config, "pod-template-intent.json");
  let template = candidates[0];
  if (template) template = await provider.updateTemplate(template.id, config);
  else {
    if (read(intent))
      throw new Error(
        "Previous template creation is unresolved. Check RunPod templates before retrying; no duplicate was created.",
      );
    writeFileSync(intent, JSON.stringify({ name: "seed" }), {
      flag: "wx",
      mode: 0o600,
    });
    template = await provider.createTemplate(config);
  }
  if (!template?.id || template.public !== false)
    throw new Error(
      "RunPod did not confirm a private template. Check the console.",
    );
  save(path.join(paths.config, "pod-deployment.json"), {
    ...saved,
    templateId: template.id,
  });
  rmSync(intent, { force: true });
  return template;
}

export async function setupPod(
  paths: StudioPaths,
  options: OperatorIO & { volumeId?: string; create?: boolean },
  provider = runpodProvider(paths),
) {
  if (options.create && options.volumeId)
    throw new Error("Choose --volume ID or --create, not both.");
  const saved = deploymentSettings(paths);
  const intentFile = path.join(paths.config, "pod-volume-intent.json");
  const pending = read<Intent>(intentFile);
  const volumes = await provider.volumes();
  let volume: Volume | undefined;
  if (options.volumeId) {
    volume = volumes.find((item) => item.id === options.volumeId);
    if (!volume) throw new Error("That volume is not in your RunPod account.");
  } else if (pending) {
    const matches = volumes.filter((item) => matchesIntent(item, pending));
    if (matches.length !== 1)
      throw new Error(
        "Previous storage creation is unresolved. Check RunPod Storage; rerun with --volume ID after identifying the result. Do not create another volume blindly.",
      );
    volume = matches[0];
  } else if (saved.volumeId && !options.create) {
    volume = volumes.find((item) => item.id === saved.volumeId);
    if (!volume)
      throw new Error(
        "The saved volume is missing. Select an existing volume with --volume ID, or explicitly use --create.",
      );
  } else if (!options.create) {
    if (volumes.length === 1) volume = volumes[0];
    else {
      options.say(
        volumes
          .map(
            (item) =>
              `${item.id}: ${item.name}, ${item.size} GB, ${item.dataCenter}`,
          )
          .join("\n") || "No network volumes found.",
      );
      if (!options.question || volumes.length === 0)
        throw new Error(
          "Use seed pod-setup --volume ID, or seed pod-setup --create for new storage.",
        );
      const id = (await options.question("Volume ID to reuse: ")).trim();
      volume = volumes.find((item) => item.id === id);
      if (!volume) throw new Error("Choose a listed volume ID.");
    }
  } else {
    if (!options.question)
      throw new Error(
        "New storage requires interactive confirmation. Run seed pod-setup --create in a terminal.",
      );
    const centers = (await provider.datacenters()).filter((item) =>
      item.networkVolumeTypes.includes("STANDARD"),
    );
    options.say(centers.map((item) => `${item.id}: ${item.name}`).join("\n"));
    const dataCenter = (await options.question("Datacenter ID: ")).trim();
    if (!centers.some((item) => item.id === dataCenter))
      throw new Error("Choose a listed datacenter.");
    options.say(
      `Pinned models: ${(modelBytes / 1e9).toFixed(2)} GB. Recommended: ${recommendedGB} GB including 30 GB working space, rounded up. Existing files and later LoRAs may need more.`,
    );
    const size = Number(
      (await options.question(`Capacity in GB [${recommendedGB}]: `)).trim() ||
        recommendedGB,
    );
    if (
      !Number.isInteger(size) ||
      size < Math.ceil(modelBytes / 1e9) + 10 ||
      size > 4096
    )
      throw new Error(
        `Choose ${Math.ceil(modelBytes / 1e9) + 10}–4096 GB, allowing space beyond the pinned models.`,
      );
    const rate = await provider.storageRate();
    options.say(
      `Standard storage: $${rate}/GB/month for the first TB. Estimate up to $${(size * rate).toFixed(2)}/month; larger volumes may receive a lower marginal rate. Storage bills even with no pod. Source: https://docs.runpod.io/storage/network-volumes`,
    );
    if (
      (await options.question("Create this paid network volume? Type yes: "))
        .trim()
        .toLowerCase() !== "yes"
    )
      throw new Error("Storage creation cancelled.");
    const intent: Intent = {
      name: `seed-models-${randomUUID()}`,
      size,
      dataCenter,
      type: "STANDARD",
    };
    // Persist before POST. An exclusive intent prevents duplicate creates and lets
    // a later invocation reconcile a lost response without issuing another POST.
    try {
      writeFileSync(intentFile, JSON.stringify(intent), {
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      throw new Error(
        "Storage creation already has an unresolved intent. Rerun setup to reconcile it.",
      );
    }
    volume = await provider.createVolume(intent);
  }
  if (
    !volume ||
    !volume.id ||
    !Number.isFinite(volume.size) ||
    volume.size < Math.ceil(modelBytes / 1e9) + 10
  )
    throw new Error(
      "Selected volume is too small or returned invalid metadata. Increase its size in RunPod, then rerun.",
    );
  save(path.join(paths.config, "pod-deployment.json"), {
    ...saved,
    volumeId: volume.id,
  });
  const outstanding = read<Intent>(intentFile);
  if (outstanding && matchesIntent(volume, outstanding)) rmSync(intentFile);
  else if (outstanding)
    options.say(
      "A separate storage creation is still unresolved. Its intent record has been preserved; inspect RunPod Storage before creating anything else.",
    );
  const template = await setupTemplate(paths, provider);
  options.say(
    `Volume: ${volume.name} (${volume.id}), ${volume.size} GB, ${volume.dataCenter}\nPrivate template: seed\nhttps://console.runpod.io/deploy?template=${template.id}\nCredentials and worker settings are already filled in. Select this network volume and ONE available compatible GPU in ${volume.dataCenter}.\nAfter deployment, open HTTP port 8080, unlock with your pairing secret, and copy the connection code into seed.\nNo pod was started. Rerun this command to update your private template.`,
  );
  return volume;
}
