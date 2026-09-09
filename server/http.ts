import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAssets, openDatabase } from './db.js';
import { prepareStorage, type StudioPaths } from './storage.js';
import type { StudioSnapshot } from '../shared/studio.js';

export async function createApp(options: { paths: StudioPaths; port: number; webRoot?: string; host?: string }) {
  prepareStorage(options.paths);
  const db = openDatabase(options.paths.data);
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, trustProxy: false, ajv: { customOptions: { removeAdditional: false } } });
  const allowedHost = `${options.host ?? '127.0.0.1'}:${options.port}`;
  const origin = `http://${allowedHost}`;
  const instanceId = randomUUID();
  const fail = (reply: import('fastify').FastifyReply, status: number, code: string, message: string, requestId: string) =>
    reply.code(status).send({ error: { code, message, retryable: false }, request_id: requestId });

  app.addHook('onRequest', async (request, reply) => {
    // A loopback bind alone does not protect against DNS rebinding or hostile websites.
    if (request.headers.host !== allowedHost) return fail(reply, 403, 'untrusted_host', 'Open seed using its local address.', request.id);
    const site = request.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return fail(reply, 403, 'untrusted_origin', 'Cross-site access is not allowed.', request.id);
    if (request.headers.origin && request.headers.origin !== origin) return fail(reply, 403, 'untrusted_origin', 'Cross-site access is not allowed.', request.id);
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin) {
      return fail(reply, 403, 'origin_required', 'A same-origin request is required.', request.id);
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    return fail(reply, status, status === 500 ? 'internal_error' : 'invalid_request', status === 500 ? 'seed could not complete this request.' : 'Check the request and try again.', request.id);
  });
  app.addHook('onClose', async () => { db.close(); });
  app.get('/api/v1/health', async () => ({ application: 'seed', version: '0.1.0', instance_id: instanceId }));
  app.get('/api/v1/studio', async (): Promise<StudioSnapshot> => {
    const state = db.prepare('SELECT paused FROM dispatcher_state WHERE id = 1').get() as { paused: number };
    return {
      worker: { state: 'disconnected', observed_at: null, stale: true },
      queue: { paused: state.paused === 1, waiting: 0, active: 0 },
      outputs: { pending: 0 },
      safe_to_terminate: null,
      checked_at: null,
      reasons: ['No worker has been connected.'],
      implementation: { pairing: false, generation: false },
    };
  });
  for (const [action, paused] of [['pause', 1], ['resume', 0]] as const) {
    app.post(`/api/v1/queue/${action}`, { schema: { body: { type: 'object', additionalProperties: false, maxProperties: 0 } } }, async (request, reply) => {
      if (!paused) return fail(reply, 409, 'worker_unavailable', 'Connect and reconcile a worker before resuming.', request.id);
      db.prepare('UPDATE dispatcher_state SET paused = 1 WHERE id = 1').run();
      return { paused: true };
    });
  }
  app.get('/api/v1/assets', async () => ({ items: listAssets(db), next_cursor: null }));

  const webRoot = options.webRoot ?? fileURLToPath(new URL('../web', import.meta.url));
  if (existsSync(path.join(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: webRoot, dotfiles: 'deny', index: 'index.html' });
    app.get('/library', async (_request, reply) => reply.sendFile('index.html'));
  }
  app.setNotFoundHandler((request, reply) => fail(reply, 404, 'not_found', 'This page or operation is not available.', request.id));
  return app;
}
