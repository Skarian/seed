// Start Seed for realistic user testing in a fresh, isolated profile:
// fake GPU providers and workers, live chat through OpenRouter.
//
//   npm run user-test                    Start and wait for Ctrl+C.
//   npm run user-test -- --gpu local     Same, but images and clips render for real on this PC's GPU.
//   npm run test:user [-- args]          Start, run the Playwright user suite, stop.
//
// OPENROUTER_API_KEY is read from the environment and passed only to the
// server process. It is never written to the repository or the profile.
//
// GPU mode uses a separate local-worker folder (SEED_QA_LOCAL_ROOT, default C:\SeedTest\local-worker) whose models,
// engine, python and tools are links to an installed Seed's folders, so nothing is downloaded twice. While it runs,
// the installed Seed's own local worker (SEED_QA_HOST_SEED, default http://127.0.0.1:4310) is paused, so the two never
// share the GPU, and it is resumed when the test stops. Only synthetic prompts go into a test profile.
import { fork, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const runTests = args[0] === "--test";
const gpuAt = args.indexOf("--gpu");
const gpu = gpuAt >= 0 ? args[gpuAt + 1] : "fake";
if (gpuAt >= 0) args.splice(gpuAt, 2);
const testArgs = args.slice(runTests ? 1 : 0);
if (gpu !== "fake" && gpu !== "local") {
  console.error("Use --gpu local, or leave it out for fake GPUs.");
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.error("Set OPENROUTER_API_KEY to start live chat.");
  process.exit(1);
}
const serverRoot = path.resolve(process.env.SEED_QA_SERVER_ROOT ?? "dist");
if (!existsSync(path.join(serverRoot, "server/http.js"))) {
  console.error("Run npm run build first.");
  process.exit(1);
}
const localRoot = path.resolve(process.env.SEED_QA_LOCAL_ROOT ?? "C:/SeedTest/local-worker");
if (gpu === "local" && !existsSync(path.join(localRoot, "models-verified.json"))) {
  console.error(`GPU mode needs an installed local worker folder at ${localRoot} (set SEED_QA_LOCAL_ROOT).`);
  process.exit(1);
}
await mkdir(".local", { recursive: true });
const root = await mkdtemp(path.resolve(".local/user-test-"));
const port = process.env.SEED_QA_PORT ?? "4312";
// Pass only the system environment the server needs, plus the chat key.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SEED_QA_SERVER_ROOT|SEED_QA_WEB_ROOT|OPENROUTER_API_KEY)$/i.test(key),
  ),
);

// The installed Seed's local worker steps aside for the test and comes back afterwards.
const hostSeed = process.env.SEED_QA_HOST_SEED ?? "http://127.0.0.1:4310";
let resumeHost = false;
async function hostLocal(action) {
  const response = await fetch(hostSeed + "/api/v1/pool/local/actions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: hostSeed },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) throw Error(`The installed Seed refused ${action} (${response.status}).`);
}
if (gpu === "local") {
  try {
    const state = await (await fetch(hostSeed + "/api/v1/pool/local")).json();
    if (state.worker?.enabled && !state.worker.paused) {
      await hostLocal("pause");
      resumeHost = true;
      console.log("Paused the installed Seed's local worker for this test.");
    }
  } catch (error) {
    console.log("The installed Seed is not reachable; continuing without pausing it.", String(error.message ?? error));
  }
}

const server = fork("scripts/user-test-server.mjs", [], {
  windowsHide: true,
  env: {
    ...env,
    STUDIO_DEV_ROOT: root,
    SEED_QA_PORT: port,
    ...(gpu === "local" ? { SEED_QA_GPU: "local", SEED_LOCAL_ROOT: localRoot } : {}),
  },
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
const closed = new Promise((resolve) => server.once("exit", resolve));
const url = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(Error("User-test server did not start.")), 30000);
  server.once("message", (message) => { clearTimeout(timeout); resolve(message.url); });
  server.once("error", (error) => { clearTimeout(timeout); reject(error); });
  server.once("exit", () => { clearTimeout(timeout); reject(Error("User-test server exited before startup.")); });
});
console.log(`Seed user test: ${url}`);
console.log(`Profile: ${root}`);
if (gpu === "local") {
  const response = await fetch(url + "/api/v1/pool/local/actions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ action: "enable" }),
  });
  console.log(response.ok ? "GPU mode: this PC renders for real." : `GPU mode: enabling this PC failed (${response.status}).`);
}

async function audit() {
  const status = await (await fetch(url + "/__qa/status")).json();
  console.log("Outside calls allowed:", JSON.stringify(status.allowed_external_calls));
  if (status.blocked_external_attempts.length) {
    console.error("Blocked outside calls:", status.blocked_external_attempts);
    return false;
  }
  return true;
}
async function stop(code) {
  let ok = false;
  try { ok = await audit(); } catch { /* The server did not answer. */ }
  process.exitCode = ok ? code : 1;
  if (server.connected) server.send("stop");
  await closed;
  if (resumeHost) {
    try {
      await hostLocal("enable");
      console.log("Resumed the installed Seed's local worker.");
    } catch (error) {
      console.error("Could not resume the installed Seed's local worker; enable This PC in its GPUs page.", String(error.message ?? error));
    }
  }
}

if (runTests) {
  const code = await new Promise((resolve, reject) => {
    const runner = spawn(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.user.config.ts", ...testArgs],
      { windowsHide: true, stdio: "inherit", env: { ...process.env, OPENROUTER_API_KEY: "", SEED_USER_TEST_URL: url } },
    );
    runner.once("error", reject);
    runner.once("exit", (exit) => resolve(exit ?? 1));
  });
  await stop(code);
} else {
  console.log("Press Ctrl+C to stop.");
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => { if (!stopping) { stopping = true; stop(0); } });
}
