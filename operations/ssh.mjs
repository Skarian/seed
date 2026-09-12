import path from 'node:path';
import {mkdir,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer,isIP} from 'node:net';

export function terminalSshError(text) {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(text)) return 'SSH host identity changed. Verify the rental and its host key before reconnecting; Seed will not remove trusted keys automatically.';
  if (/Permission denied \(.*publickey|Load key .*(?:invalid format|Permission denied|bad permissions)|UNPROTECTED PRIVATE KEY FILE|no such identity:/i.test(text)) return 'SSH could not authenticate. Check the configured key and the rental public key before reconnecting.';
  if (/Address already in use|cannot listen to port|Could not request local forwarding/i.test(text)) return 'The local tunnel port is occupied. Stop the conflicting tunnel before reconnecting.';
  return null;
}

export class SshFailure extends Error {
  constructor(message, terminal=false) { super(message); this.terminal = terminal; }
}

export function run(file, args, { input, cwd, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const isSsh = /^ssh(?:\.exe)?$/i.test(path.basename(file));
    const child = spawnProcess(file, args, {
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
    let fatal = null, diagnostics = '';
    child.stderr.on('data', chunk => {
      // Classify a bounded tail but never expose command stderr or remote secrets.
      if (!isSsh || fatal) return;
      diagnostics = (diagnostics + chunk.toString()).slice(-8192);
      fatal = terminalSshError(diagnostics);
    });
    child.stdin.on("error", () => {});
    child.once("error", () =>
      reject(isSsh ? new SshFailure("OpenSSH could not start. Check its installation and executable permissions.", true) : new Error(`${path.basename(file)} could not start.`)),
    );
    child.once("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString("utf8"))
        : reject(
            isSsh ? new SshFailure(fatal ?? `SSH failed (exit ${code}); inspect the private service log.`, Boolean(fatal)) : new Error(`${path.basename(file)} failed (exit ${code}); inspect the private service log.`),
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
    return child;
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
