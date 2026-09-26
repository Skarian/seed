// Test-only process boundary. Real provider adapters use a separate HTTP replay
// server; worker inference remains a durable CPU fixture. No real credentials.
import { createApp } from '../dist/server/http.js';
import { resolvePaths, prepareStorage } from '../dist/server/storage.js';
import { createProviders } from '../dist/server/pool-providers.js';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const root = process.env.SEED_RECOVERY_ROOT;
if (!root) throw Error('An isolated recovery-test root is required.');
const file = path.join(root, 'external-state.json');
mkdirSync(root, { recursive: true });
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { rentals: {}, receipts: {}, audit: [] };
function record(operation, details = {}) {
  state.audit.push({ operation, ...details });
  writeFileSync(file + '.tmp', JSON.stringify(state));
  renameSync(file + '.tmp', file);
}
record('fixture-start');
async function checkpoint(name) {
  if (process.env.SEED_CRASH_AT !== name) return;
  process.send?.({ checkpoint: name });
  await new Promise(() => {}); // Parent kills this process; no graceful cleanup.
}
const nativeFetch=globalThis.fetch,replayOrigin=process.env.SEED_PROVIDER_REPLAY;
if(!replayOrigin||new URL(replayOrigin).hostname!=='127.0.0.1')throw Error('Local provider replay required');
globalThis.fetch = async () => { record('forbidden-network'); throw Error('External network disabled in recovery fixture.'); };
const providerFetch=(input,init)=>{
  const url=new URL(String(input));
  const name=url.origin==='https://api.runpod.io'?'runpod':url.origin==='https://console.vast.ai'?'vast':null;
  if(!name){record('forbidden-network');throw Error('Unexpected provider destination');}
  return nativeFetch(replayOrigin+'/'+name+(name==='runpod'?url.pathname.replace(/^\/v2/,''):url.pathname)+url.search,init);
};
const bytes = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#627a68' } }).png().toBuffer();
const output = { id: '0', path: 'image.png', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: 'image/png' };
const worker = {
  preflight: async () => {}, auth: async () => ({ public_key: 'offline-fixture', pairing_secret: 'offline-fixture' }),
  prepare: async w => ({ ready: true, session_id: `session-${w.id}`, installed_loras: [],
    preparation: { phase: 'ready', files: [], bytes_done: 0, bytes_total: 0 }, revision: w.preparation_revision }),
  upload: async () => {},
  submit: async (w, body) => {
    const id = body.prompt_id;
    if (state.receipts[id]) throw Error('Duplicate generation attempted.');
    state.receipts[id] = { submission: { graph_digest: 'offline' }, manifest: { state: 'completed', outputs: [output] }, manifest_digest: 'offline-digest' };
    record('submit', { id, worker: w.id });
    await checkpoint('submit');
  },
  receipt: async (_w, id) => state.receipts[id] ?? null,
  cancel: async (_w, id) => { state.receipts[id] = { submission: {}, manifest: { state: 'cancelled', outputs: [] }, manifest_digest: 'offline-digest' }; record('cancel', { id }); },
  download: async (_w, id, _output, target) => {
    // Exercise interruption during copying, and after a complete file exists but
    // before the app commits its asset transaction.
    if (process.env.SEED_CRASH_AT === 'partial-save') {
      writeFileSync(target, bytes.subarray(0, Math.floor(bytes.length / 2)));
      record('partial-save', { id }); await checkpoint('partial-save');
    }
    writeFileSync(target, bytes); record('download', { id }); await checkpoint('saved-file');
  },
  acknowledge: async (_w, id) => { record('acknowledge', { id }); await checkpoint('acknowledge'); },
  reconnect: async () => {}, disconnect: async () => {}, close: async () => {},
};
const release = { image: 'offline/image@sha256:' + 'a'.repeat(64), disk_gb: 200, manifest: [] };
const port = Number(process.env.SEED_RECOVERY_PORT);
const paths=resolvePaths(path.join(root,'profile'));prepareStorage(paths);
writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({vastApiKey:'fixture-key',runpodApiKey:'fixture-key'}));
const app = await createApp({ paths, port,
  poolDependencies: { providers: createProviders(paths,providerFetch), worker,
    releases: { image: release, video: { ...release, image: 'offline/video@sha256:' + 'b'.repeat(64) } } } });
await app.listen({ host: '127.0.0.1', port });
process.send?.({ ready: true });
process.on('message', async message => { if (message === 'close') { await app.close(); process.disconnect(); } });
