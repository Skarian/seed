import path from 'node:path';
import {pathToFileURL} from 'node:url';
const serverRoot=path.resolve(process.env.SEED_QA_SERVER_ROOT??'dist');
const {createApp}=await import(pathToFileURL(path.join(serverRoot,'server/http.js')).href);
const {resolvePaths}=await import(pathToFileURL(path.join(serverRoot,'server/storage.js')).href);
import { offlineProviders } from "./offline-providers.mjs";
const paths = resolvePaths(process.env.STUDIO_DEV_ROOT);
const host = process.env.SEED_QA_HOST ?? "127.0.0.1",
  port = Number(process.env.SEED_QA_PORT ?? 4311);
if (!process.env.STUDIO_DEV_ROOT) throw Error("A fresh test root is required.");
const nativeFetch = globalThis.fetch;
const blockedExternal = [];
globalThis.fetch = (url, ...args) => {
  const target = new URL(String(url));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    blockedExternal.push(target.hostname);
    throw Error("QA blocked external network access: " + target.hostname);
  }
  return nativeFetch(url, ...args);
};
const { fixtureControls, ...dependencies } = await offlineProviders(paths);
const app = await createApp({ paths, host, port, ...(process.env.SEED_QA_WEB_ROOT ? { webRoot: process.env.SEED_QA_WEB_ROOT } : {}), ...dependencies });
app.post("/__qa/scenario", async (request) =>
  fixtureControls.configure(request.body ?? {}),
);
app.get("/__qa/status", async () => ({
  ...fixtureControls.status(),
  blocked_external_attempts: blockedExternal,
}));
await app.listen({ host, port });
process.send?.("ready");
process.once("message", async () => {
  await app.close();
  process.disconnect?.();
});
