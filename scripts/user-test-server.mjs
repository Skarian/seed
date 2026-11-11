// Realistic user-testing server: offline fake GPU providers and workers, with
// live chat through OpenRouter. Only openrouter.ai is reachable; every other
// outside call is blocked and recorded. Started by scripts/user-test.mjs.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { offlineProviders } from "./offline-providers.mjs";
const serverRoot = path.resolve(process.env.SEED_QA_SERVER_ROOT ?? "dist");
const { createApp } = await import(pathToFileURL(path.join(serverRoot, "server/http.js")).href);
const { resolvePaths } = await import(pathToFileURL(path.join(serverRoot, "server/storage.js")).href);
if (!process.env.STUDIO_DEV_ROOT) throw Error("A fresh user-test root is required.");
if (!process.env.OPENROUTER_API_KEY?.trim()) throw Error("Set OPENROUTER_API_KEY to run live chat.");
const paths = resolvePaths(process.env.STUDIO_DEV_ROOT);
const host = process.env.SEED_QA_HOST ?? "127.0.0.1",
  port = Number(process.env.SEED_QA_PORT ?? 4312);
const local = ["127.0.0.1", "localhost", "[::1]"];
const allowed = ["openrouter.ai"];
const nativeFetch = globalThis.fetch;
const blockedExternal = [];
const allowedExternal = new Map();
globalThis.fetch = (url, ...args) => {
  const target = new URL(url instanceof Request ? url.url : String(url));
  if (allowed.includes(target.hostname) && target.protocol === "https:") {
    allowedExternal.set(target.hostname, (allowedExternal.get(target.hostname) ?? 0) + 1);
    return nativeFetch(url, ...args);
  }
  if (!local.includes(target.hostname)) {
    blockedExternal.push(target.hostname);
    throw Error("User test blocked external network access: " + target.hostname);
  }
  return nativeFetch(url, ...args);
};
const { fixtureControls, ...dependencies } = await offlineProviders(paths, { liveChat: true });
const app = await createApp({
  paths, host, port,
  ...(process.env.SEED_QA_WEB_ROOT ? { webRoot: process.env.SEED_QA_WEB_ROOT } : {}),
  ...dependencies,
  // GPU mode: the real local worker renders on this PC from synthetic prompts; cloud providers stay offline.
  ...(process.env.SEED_QA_GPU === "local" ? { localWorker: true } : {}),
});
app.post("/__qa/scenario", async (request) => fixtureControls.configure(request.body ?? {}));
// Host names and counts only: never request or response content.
app.get("/__qa/status", async () => ({
  scenario: fixtureControls.status().scenario,
  gpu: process.env.SEED_QA_GPU === "local" ? "local" : "fake",
  allowed_hosts: allowed,
  allowed_external_calls: Object.fromEntries(allowedExternal),
  blocked_external_attempts: blockedExternal,
}));
await app.listen({ host, port });
process.send?.({ ready: true, url: `http://${host}:${port}` });
// The launcher owns Ctrl+C, so it can audit outside calls before stopping us.
if (process.send) process.on("SIGINT", () => {});
process.once("message", async () => {
  await app.close();
  process.disconnect?.();
});
