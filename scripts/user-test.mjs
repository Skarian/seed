// Start Seed for realistic user testing in a fresh, isolated profile:
// fake GPU providers and workers, live chat through OpenRouter.
//
//   npm run user-test              Start and wait for Ctrl+C.
//   npm run test:user [-- args]    Start, run the Playwright user suite, stop.
//
// OPENROUTER_API_KEY is read from the environment and passed only to the
// server process. It is never written to the repository or the profile.
import { fork, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

const runTests = process.argv[2] === "--test";
const testArgs = process.argv.slice(runTests ? 3 : 2);
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.error("Set OPENROUTER_API_KEY to start live chat.");
  process.exit(1);
}
const serverRoot = path.resolve(process.env.SEED_QA_SERVER_ROOT ?? "dist");
if (!existsSync(path.join(serverRoot, "server/http.js"))) {
  console.error("Run npm run build first.");
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
const server = fork("scripts/user-test-server.mjs", [], {
  windowsHide: true,
  env: { ...env, STUDIO_DEV_ROOT: root, SEED_QA_PORT: port },
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
