import { afterEach, beforeEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WorkerConnection, validateWorkerEndpoint } from '../server/worker.js';
import { prepareStorage, resolvePaths } from '../server/storage.js';
let server: Server;
let root: string;
let origin: string;
let identity = 'worker-one';
const credential = 'test-credential-'.repeat(4);
let requests = 0;
let routes: string[] = [];
beforeEach(async () => {
  mkdirSync('.local/tests', { recursive: true }); root = mkdtempSync(path.resolve('.local/tests/worker-'));
  prepareStorage(resolvePaths(root)); requests = 0; routes = []; identity = 'worker-one';
  server = createServer((req, res) => {
    requests++; routes.push(req.url ?? ''); res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/exchange')) res.end(JSON.stringify({ worker_credential: credential, worker_instance_id: identity, workspace_id: 'workspace-one', protocol_version: 1 }));
    else if (req.headers.authorization === `Bearer ${credential}`) res.end(JSON.stringify({ worker_instance_id: identity, workspace_id: 'workspace-one', protocol_version: 1, state: 'ready', engine_session_id: 'session-one', preparation: { phase: 'complete' } }));
    else { res.statusCode = 401; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
function code(endpoint = origin, expires = Math.floor(Date.now()/1000) + 300) { return 'studio1.' + Buffer.from(JSON.stringify({ version: 1, endpoint, expires_at: expires, exchange_token: 'a'.repeat(43) })).toString('base64url'); }
it('SSH reconnect preserves credentials and rejects a different worker', async () => {
  const paths = resolvePaths(root), connection = new WorkerConnection(paths, origin);
  await connection.pair(code());
  const saved = readFileSync(path.join(paths.config, 'worker-connection.json'), 'utf8');
  identity = 'replacement';
  await expect(connection.reconnect()).rejects.toThrow('recorded worker');
  expect(readFileSync(path.join(paths.config, 'worker-connection.json'), 'utf8')).toBe(saved);
  identity = 'worker-one';
  await connection.reconnect();
  expect(JSON.parse(readFileSync(path.join(paths.config, 'worker-connection.json'), 'utf8')).worker_credential).toBe(credential);
});
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
    const reconnect = await app.inject({ method: 'POST', url: '/api/v1/connection/reconnect', headers, payload: {} });
    expect(reconnect.json()).toEqual({ connected: true });
    const arbitrary = await app.inject({ method: 'POST', url: '/api/v1/connection/reconnect', headers, payload: { endpoint: 'http://100.100.1.2:8080' } });
    expect(arbitrary.statusCode).toBe(400);
    const retired = await app.inject({ method: 'PUT', url: '/api/v1/connection/route', headers, payload: { endpoint: origin } });
    expect(retired.statusCode).toBe(404);
    const status = await app.inject({ url: '/api/v1/studio', headers });
    expect(status.json()).toMatchObject({ worker: { state: 'ready', connected: true }, safe_to_terminate: null, outputs: { pending: 0 }, queue: { paused: true }, implementation: { generation: true } });
    expect(status.body).not.toContain(credential);
    expect(status.body).not.toContain(origin);
    const removed = await app.inject({ method: 'DELETE', url: '/api/v1/connection', headers });
    expect(removed.json()).toEqual({ connected: false });
  } finally { await app.close(); }
});

it('normal app reloads a saved SSH worker without a special launcher', async () => {
  const paths = resolvePaths(root);
  const endpoint = 'http://127.0.0.1:18080';
  expect(validateWorkerEndpoint(endpoint)).toBe(endpoint);
  for (const url of ['http://127.0.0.1:18081', 'http://localhost:18080', 'http://192.168.1.2:18080', endpoint+'/path', endpoint+'?x=1']) {
    expect(() => validateWorkerEndpoint(url)).toThrow();
  }
  writeFileSync(path.join(paths.config, 'worker-connection.json'), JSON.stringify({endpoint, worker_credential:credential, worker_instance_id:identity, workspace_id:'workspace-one', protocol_version:1}));
  const { createApp } = await import('../server/http.js');
  for (let restart=0; restart<2; restart++) {
    const app = await createApp({paths, port:4311});
    try {
      const health=await app.inject({url:'/api/v1/health',headers:{host:'127.0.0.1:4311'}});
      expect(health.statusCode).toBe(200);
      expect(new WorkerConnection(paths).identity?.worker_instance_id).toBe(identity);
    }
    finally { await app.close(); }
  }
});

it('failed replacement preserves the previous connection on disk and in memory', async () => {
  const paths=resolvePaths(root), connection=new WorkerConnection(paths, origin);
  await connection.pair(code());
  const file=path.join(paths.config,'worker-connection.json'), saved=readFileSync(file,'utf8');
  server.removeAllListeners('request');
  server.on('request', (_req,res)=>{res.writeHead(503);res.end();});
  await expect(connection.pair(code())).rejects.toThrow('Could not exchange');
  expect(readFileSync(file,'utf8')).toBe(saved);
  expect(connection.identity?.worker_instance_id).toBe('worker-one');
});

it('migrates tailnet configuration without sending requests or losing job identity', async () => {
  const paths=resolvePaths(root), file=path.join(paths.config,'worker-connection.json');
  writeFileSync(file,JSON.stringify({endpoint:'http://100.100.1.2:8080',tailscale_endpoint:'http://100.100.1.2:8080',tailscale_peer:'old',route:'tailscale',worker_credential:credential,worker_instance_id:identity,workspace_id:'workspace-one',protocol_version:1}));
  const connection=new WorkerConnection(paths,origin);
  expect(connection.identity).toEqual({worker_instance_id:identity,workspace_id:'workspace-one'});
  expect(JSON.parse(readFileSync(file,'utf8'))).toEqual({endpoint:origin,reconnect_required:true,worker_credential:credential,worker_instance_id:identity,workspace_id:'workspace-one',protocol_version:1});
  expect(await connection.status()).toBeNull();
  await expect(connection.request('/comfy/queue')).rejects.toThrow('Reconnect');
  expect(requests).toBe(0);
  identity='wrong';
  await expect(connection.reconnect()).rejects.toThrow('recorded worker');
  expect(JSON.parse(readFileSync(file,'utf8')).reconnect_required).toBe(true);
  identity='worker-one';
  await connection.reconnect();
  expect(JSON.parse(readFileSync(file,'utf8')).reconnect_required).toBe(false);
  await connection.json('/comfy/queue');
  expect(routes).toEqual(['/worker/v1/status','/worker/v1/status','/comfy/queue']);
});

it('loaded SSH pairing verifies identity before any operation', async () => {
  const paths=resolvePaths(root);
  await new WorkerConnection(paths,origin).pair(code());
  const loaded=new WorkerConnection(paths,origin);
  routes=[]; identity='wrong';
  await expect(loaded.request('/comfy/prompt',{method:'POST',body:{}})).rejects.toThrow('identity');
  expect(routes).toEqual(['/worker/v1/status']);
  identity='worker-one';
  const reloaded=new WorkerConnection(paths,origin); routes=[];
  await reloaded.json('/comfy/queue');
  expect(routes).toEqual(['/worker/v1/status','/comfy/queue']);
});

it('rejects tailnet pairing and preserves malformed saved credentials', async () => {
  const paths=resolvePaths(root),file=path.join(paths.config,'worker-connection.json');
  await expect(new WorkerConnection(paths,origin).pair(code('http://100.100.1.2:8080'))).rejects.toThrow('SSH');
  writeFileSync(file,'invalid');
  expect(()=>new WorkerConnection(paths,origin)).toThrow('preserved');
  expect(readFileSync(file,'utf8')).toBe('invalid');
  expect(requests).toBe(0);
});
