import { afterEach, beforeEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WorkerConnection, validateWorkerEndpoint } from '../server/worker.js';
import { prepareStorage, resolvePaths } from '../server/storage.js';
let server: Server;
let root: string;
let origin: string;
let identity = 'worker-one';
const credential = 'test-credential-'.repeat(4);
let requests = 0;
beforeEach(async () => {
  mkdirSync('.local/tests', { recursive: true }); root = mkdtempSync(path.resolve('.local/tests/worker-'));
  prepareStorage(resolvePaths(root)); requests = 0; identity = 'worker-one';
  server = createServer((req, res) => {
    requests++; res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/exchange')) res.end(JSON.stringify({ worker_credential: credential, worker_instance_id: identity, workspace_id: 'workspace-one', protocol_version: 1 }));
    else if (req.headers.authorization === `Bearer ${credential}`) res.end(JSON.stringify({ worker_instance_id: identity, workspace_id: 'workspace-one', protocol_version: 1, state: 'ready', engine_session_id: 'session-one', preparation: { phase: 'complete' } }));
    else { res.statusCode = 401; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
function code(endpoint = origin, expires = Math.floor(Date.now()/1000) + 300) { return 'studio1.' + Buffer.from(JSON.stringify({ version: 1, endpoint, expires_at: expires, exchange_token: 'a'.repeat(43) })).toString('base64url'); }
it('rejects arbitrary endpoints and expired codes before sending anything', async () => {
  const connection = new WorkerConnection(resolvePaths(root), origin);
  for (const endpoint of ['http://169.254.169.254', 'https://evil.test', 'https://abc-8080.proxy.runpod.net@evil.test', 'https://abc-8080.proxy.runpod.net/path', 'https://abc-8080.proxy.runpod.net:444']) expect(() => validateWorkerEndpoint(endpoint)).toThrow();
  await expect(connection.pair(code(origin, 1))).rejects.toThrow('expired');
  await expect(connection.pair(code('https://evil.test'))).rejects.toThrow();
  expect(requests).toBe(0);
});
it('persists privately, reloads, validates identity, and forgets without provider changes', async () => {
  const paths = resolvePaths(root); const connection = new WorkerConnection(paths, origin);
  await connection.pair(code());
  expect(connection.connected).toBe(true);
  expect(JSON.parse(readFileSync(path.join(paths.config, 'worker-connection.json'), 'utf8')).worker_credential).toBe(credential);
  expect(await connection.status()).toMatchObject({ state: 'ready' });
  const loaded = new WorkerConnection(paths, origin);
  identity = 'replacement';
  expect(await loaded.status()).toBeNull();
  loaded.forget(); expect(loaded.connected).toBe(false); expect(await loaded.status()).toBeNull();
  expect(new WorkerConnection(paths, origin).connected).toBe(false);
});

it('keeps credentials out of the browser API and leaves dispatch paused after pairing', async () => {
  const { createApp } = await import('../server/http.js');
  const app = await createApp({ paths: resolvePaths(root), port: 4311, localTestWorkerOrigin: origin });
  const headers = { host: '127.0.0.1:4311', origin: 'http://127.0.0.1:4311' };
  try {
    const paired = await app.inject({ method: 'PUT', url: '/api/v1/connection', headers, payload: { connection_code: code() } });
    expect(paired.json()).toEqual({ connected: true });
    const status = await app.inject({ url: '/api/v1/studio', headers });
    expect(status.json()).toMatchObject({ worker: { state: 'ready', connected: true }, safe_to_terminate: null, outputs: { pending: null }, queue: { paused: true }, implementation: { generation: false } });
    expect(status.body).not.toContain(credential);
    expect(status.body).not.toContain(origin);
    const removed = await app.inject({ method: 'DELETE', url: '/api/v1/connection', headers });
    expect(removed.json()).toEqual({ connected: false });
  } finally { await app.close(); }
});
