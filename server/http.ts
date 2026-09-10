import Fastify from 'fastify';
import { WorkerConnection } from './worker.js';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream, statSync, realpathSync, unlinkSync } from 'node:fs';
import { Jobs } from './jobs.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAssets, openDatabase } from './db.js';
import { prepareStorage, type StudioPaths } from './storage.js';
import type { StudioSnapshot } from '../shared/studio.js';

export async function createApp(options: { paths: StudioPaths; port: number; webRoot?: string; host?: string; localTestWorkerOrigin?: string }) {
  prepareStorage(options.paths);
  const db = openDatabase(options.paths.data);
  const worker = new WorkerConnection(options.paths, options.localTestWorkerOrigin);
  const jobs = new Jobs(db, options.paths, worker);
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
  await jobs.media.register(app);
  app.addHook('onReady', async () => { jobs.start(); });
  app.addHook('preClose', async () => { await jobs.close(); });
  app.addHook('onClose', async () => { await jobs.media.close(); db.close(); });
  app.get('/api/v1/health', async () => ({ application: 'seed', version: '0.1.0', instance_id: instanceId }));
  app.get('/api/v1/studio', async (): Promise<StudioSnapshot> => {
    const remote = await worker.status();
    const state = db.prepare('SELECT paused FROM dispatcher_state WHERE id = 1').get() as { paused: number };
    return {
      worker: { state: remote?.state ?? 'disconnected', observed_at: remote ? new Date().toISOString() : null, stale: !remote, connected: worker.connected, ...(remote ? { preparation: remote.preparation } : {}) },
      queue: { paused: state.paused === 1, waiting: jobs.all().filter(j => j.state === 'queued').length, active: jobs.all().filter(j => !['queued', 'completed', 'cancelled', 'failed'].includes(j.state) && !j.uncertainty_acknowledged).length },
      outputs: { pending: jobs.all().filter(j => ['copying', 'copy_pending'].includes(j.state)).length },
      safe_to_terminate: jobs.checkedAt && Date.now() - jobs.checkedAt < 5000 ? jobs.safe : null,
      checked_at: jobs.checkedAt ? new Date(jobs.checkedAt).toISOString() : null,
      reasons: [jobs.reason],
      implementation: { pairing: true, generation: true },
    };
  });
  app.put('/api/v1/connection', { schema: { body: { type: 'object', required: ['connection_code'], additionalProperties: false, properties: { connection_code: { type: 'string', minLength: 20, maxLength: 4096 } } } } }, async (request, reply) => {
    db.prepare('UPDATE dispatcher_state SET paused = 1 WHERE id = 1').run();
    try { return await jobs.serialize(async () => { jobs.invalidate(); await worker.pair((request.body as { connection_code: string }).connection_code.trim()); return { connected: true }; }); }
    catch (error) { return fail(reply, 400, 'connection_failed', (error as Error).message, request.id); }
  });
  app.delete('/api/v1/connection', async (request, reply) => {
    db.prepare('UPDATE dispatcher_state SET paused = 1 WHERE id = 1').run();
    try { return await jobs.serialize(async () => { jobs.invalidate(); worker.forget(); return { connected: false }; }); }
    catch (error) { return fail(reply, 409, 'connection_busy', (error as Error).message, request.id); }
  });
  for (const [action, paused] of [['pause', 1], ['resume', 0]] as const) {
    app.post(`/api/v1/queue/${action}`, { schema: { body: { type: 'object', additionalProperties: false, maxProperties: 0 } } }, async (request, reply) => {
      try { return await jobs.serialize(async () => { if (!paused) await jobs.inspectCapabilities(); jobs.pause(Boolean(paused)); return { paused: Boolean(paused) }; }); }
      catch { return fail(reply, 409, 'worker_unavailable', 'Connect a ready worker before resuming.', request.id); }
    });
  }
  app.get('/api/v1/assets', async request => { const cursor = String((request.query as { cursor?: string }).cursor ?? ''); const items = listAssets(db, cursor, 51); return { items: items.slice(0, 50), next_cursor: items.length > 50 ? items[49]!.id : null }; });
  app.delete('/api/v1/assets/:id', async (request, reply) => jobs.serialize(async () => {
    const id = (request.params as { id: string }).id;
    const asset = db.prepare('SELECT relative_path, metadata_json FROM assets WHERE id=?').get(id) as { relative_path: string; metadata_json: string } | undefined;
    if (!asset) return reply.code(204).send();
    if(jobs.all().some(job=>!['completed','failed','cancelled'].includes(job.state) && job.request.references?.some(ref=>ref.asset_id===id))) return fail(reply,409,'asset_busy','A queued job still needs this file.',request.id);
    const owners = jobs.all().filter(job => job.outputs.includes(id));
    if (owners.some(job => job.state !== 'completed' || job.cleanup_state !== 'complete')) return fail(reply, 409, 'asset_busy', 'This file is still being saved. Try again shortly.', request.id);
    const root = realpathSync(options.paths.data) + path.sep;
    const file = path.resolve(options.paths.data, asset.relative_path);
    if (!file.startsWith(path.resolve(options.paths.data) + path.sep) || (existsSync(file) && !realpathSync(file).startsWith(root))) return fail(reply, 409, 'invalid_asset', 'Cannot delete this file location.', request.id);
    // Keep the record on file errors so deletion can be retried. A missing file is already deleted.
    try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail(reply, 409, 'delete_failed', 'Could not delete the file. Close any apps using it and try again.', request.id); }
    db.transaction(() => {
      db.prepare('DELETE FROM assets WHERE id=?').run(id);
      for (const job of owners) { job.outputs = job.outputs.filter(output => output !== id); jobs.save(job); }
    })();
    return reply.code(204).send();
  }));
  app.get('/api/v1/capabilities', async () => ({ revision: jobs.capabilities?.revision ?? null, workflows: { 'text-to-image': { enabled: Boolean(jobs.capabilities), modes: jobs.capabilities?.nsfw ? ['sfw', 'nsfw'] : ['sfw'], count_max: 16 }, ...Object.fromEntries(['text-to-video','reference-to-video'].map(id => [id,{enabled:Boolean(jobs.capabilities?.video?.ready),modes:jobs.capabilities?.video?.nsfw.fl && jobs.capabilities?.video?.nsfw.ref ? ['sfw','nsfw'] : ['sfw'],count_max:16}])) } }));
  app.post('/api/v1/jobs', async (request, reply) => {
    try { const result = await jobs.serialize(() => jobs.submit(request.body, String(request.headers['idempotency-key'] ?? ''))); return reply.code(202).send(result); }
    catch (error) { return fail(reply, 409, 'submission_failed', (error as Error).message, request.id); }
  });
  app.get('/api/v1/jobs', async request => { const cursor = String((request.query as { cursor?: string }).cursor ?? ''); const items = jobs.list(51, cursor); return { items: items.slice(0, 50), next_cursor: items.length > 50 ? items[49]!.id : null }; });
  app.get('/api/v1/jobs/:id', async (request, reply) => jobs.get((request.params as { id: string }).id) ?? fail(reply, 404, 'not_found', 'Job not found.', request.id));
  app.post('/api/v1/jobs/:id/cancel', async (request, reply) => {
    try { return await jobs.serialize(() => jobs.cancel((request.params as { id: string }).id)); }
    catch (error) { return fail(reply, 409, 'cancel_failed', (error as Error).message, request.id); }
  });
  app.post('/api/v1/jobs/:id/acknowledge', async (request, reply) => {
    try { return await jobs.serialize(async () => jobs.acknowledge((request.params as { id: string }).id)); }
    catch (error) { return fail(reply, 409, 'acknowledge_failed', (error as Error).message, request.id); }
  });
  app.get('/api/v1/assets/:id/content', async (request, reply) => {
    const asset = db.prepare('SELECT relative_path, metadata_json FROM assets WHERE id=?').get((request.params as { id: string }).id) as { relative_path: string; metadata_json: string } | undefined;
    if (!asset) return fail(reply, 404, 'not_found', 'Image not found.', request.id);
    const metadata=JSON.parse(asset.metadata_json);
    if(metadata.state && metadata.state!=='ready')return fail(reply,409,'asset_not_ready','This file has not finished validation.',request.id);
    const file = path.resolve(options.paths.data, asset.relative_path);
    if (!file.startsWith(path.resolve(options.paths.data) + path.sep) || !existsSync(file)) return fail(reply, 404, 'not_found', 'Image not found.', request.id);
    const size = statSync(file).size;
    const mime=metadata.mime_type??'image/png';
    const inline=/^(image\/(png|jpeg|webp|gif|avif|heic|tiff)|video\/(mp4|webm)|audio\/(mp4|webm|wav|mpeg|flac|ogg))$/.test(mime);
    reply.type(inline?mime:'application/octet-stream').header('Accept-Ranges', 'bytes').header('Content-Disposition', `${inline?'inline':'attachment'}; filename="${path.basename(file)}"`);
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range); const start = Number(match?.[1]), end = match?.[2] ? Number(match[2]) : size - 1;
      if (!match || start > end || end >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(file, { start, end }));
    }
    return reply.header('Content-Length', size).send(createReadStream(file));
  });

  const webRoot = options.webRoot ?? fileURLToPath(new URL('../web', import.meta.url));
  if (existsSync(path.join(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: webRoot, dotfiles: 'deny', index: 'index.html' });
    app.get('/library', async (_request, reply) => reply.sendFile('index.html'));
  }
  app.setNotFoundHandler((request, reply) => fail(reply, 404, 'not_found', 'This page or operation is not available.', request.id));
  return app;
}
