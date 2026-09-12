import path from 'node:path';
import {mkdir,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer,isIP} from 'node:net';

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
export async function background(script, args, log) {
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
          ].includes(key.toUpperCase()) && !key.toUpperCase().startsWith('TAILSCALE_') && !key.toUpperCase().startsWith('TS_'),
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
export function sshArgs(instance, key, knownHosts, proxy = false) {
  const port = Number(proxy ? instance.ssh_port : instance.ports?.["22/tcp"]?.[0]?.HostPort);
  const host = proxy ? instance.ssh_host : instance.public_ipaddr;
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (proxy ? !/^ssh\d+\.vast\.ai$/.test(host ?? '') : !isIP(host ?? ""))
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
    `root@${host}`,
  ];
}
