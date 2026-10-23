import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerGeneratePreferences } from '../server/generate-preferences.js';
import { createApp } from '../server/http.js';
import { prepareStorage, resolvePaths } from '../server/storage.js';

const faults = vi.hoisted(() => ({ file: '', operation: '' }));
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  const fail = () => { throw Object.assign(Error('Injected storage failure'), { code: 'EACCES' }); };
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (faults.operation === 'read' && String(args[0]) === faults.file) fail();
      return actual.readFileSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (faults.operation === 'write' && String(args[0]).startsWith(faults.file + '.')) fail();
      return actual.writeFileSync(...args);
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (faults.operation === 'rename' && String(args[1]) === faults.file) fail();
      return actual.renameSync(...args);
    },
  };
});

const roots: string[] = [], apps: FastifyInstance[] = [];
const endpoint = '/api/v1/generate-preferences';
const defaults = { image: 'image-768', video: '768p' };
function fixture() {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/generate-preferences-')); roots.push(root);
  const paths = resolvePaths(root); prepareStorage(paths);
  const start = () => {
    const app = Fastify(); registerGeneratePreferences(app, paths); apps.push(app); return app;
  };
  const app = start();
  return { root, paths, app, start, file: path.join(paths.config, 'generate-preferences.json') };
}
afterEach(async () => {
  faults.file = ''; faults.operation = '';
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('installation Generate preferences', () => {
  it('accepts every approved choice without a flag and preserves saved legacy selections', async () => {
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', '');
    const { app, file } = fixture();
    writeFileSync(file, JSON.stringify({image:'1mp',video:'768p'}));
    expect((await app.inject(endpoint)).json().preferences).toEqual({image:'1mp',video:'768p'});
    for(const image of ['image-480','image-768','2mp','image-1440']) {
      const response=await app.inject({method:'PATCH',url:endpoint,payload:{image}});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({preferences:{image,video:'768p'},candidates:false});
    }
    expect((await app.inject({method:'PATCH',url:endpoint,payload:{video:'480p'}})).json().preferences).toEqual({image:'image-1440',video:'480p'});
  });
  it('returns released defaults for an absent file without writing settings', async () => {
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', '');
    const { app, file } = fixture();
    const response = await app.inject(endpoint);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ preferences: defaults, candidates: false });
    expect(existsSync(file)).toBe(false);
    expect((await app.inject({ method: 'PATCH', url: endpoint, payload: { image: 'image-768' } })).json()).toEqual({ preferences: defaults, candidates: false });
  });

  it('accepts exactly one family and rejects wrong-family and unknown values', async () => {
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', 'true');
    const { app, file } = fixture();
    for (const payload of [{}, [], { image: 'unknown' }, { image: '768p' }, { video: '1mp' }, { video: '720p' }, { image: null }, { image: 1 }, defaults, { image: '1mp', extra: true }, { preferences: defaults }]) {
      const response = await app.inject({ method: 'PATCH', url: endpoint, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe('invalid_generate_preferences');
    }
    expect(existsSync(file)).toBe(false);
    expect((await app.inject(endpoint)).json().candidates).toBe(false);
  });

  it('commits different-family updates and the last same-family update, surviving restart', async () => {
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', '1');
    const { app, file, start } = fixture();
    const changes = [{ image: '0.5mp' }, { video: '480p' }, { image: '2mp' }];
    const results = await Promise.all(changes.map(payload => app.inject({ method: 'PATCH', url: endpoint, payload })));
    expect(results.map(r => r.statusCode)).toEqual([200, 200, 200]);
    expect(results.map(r => r.json())).toEqual([
      { preferences: { image: '0.5mp', video: '768p' }, candidates: true },
      { preferences: { image: '0.5mp', video: '480p' }, candidates: true },
      { preferences: { image: '2mp', video: '480p' }, candidates: true },
    ]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ image: '2mp', video: '480p' });
    await app.close();
    const restarted = start();
    expect((await restarted.inject(endpoint)).json()).toEqual({ preferences: { image: '2mp', video: '480p' }, candidates: true });
    expect((await restarted.inject({ method: 'PATCH', url: endpoint, payload: { video: '768p' } })).json().preferences).toEqual({ image: '2mp', video: '768p' });
    expect((await restarted.inject({ method: 'PATCH', url: endpoint, payload: { image: 'image-768' } })).json().preferences).toEqual(defaults);
    await restarted.close(); vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', '');
    expect((await start().inject(endpoint)).json()).toEqual({ preferences: defaults, candidates: false });
  });

  it('treats malformed or unsupported saved data as corruption, preserving it on PATCH', async () => {
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', '');
    const { app, file } = fixture();
    for (const raw of ['{broken', 'null', '[]', '{}', '{"image":"1mp"}', '{"image":"768p","video":"1mp"}', '{"image":"unknown","video":"768p"}', '{"image":"1mp","video":"768p","extra":1}']) {
      writeFileSync(file, raw);
      const read = await app.inject(endpoint);
      expect(read.statusCode, raw).toBe(503);
      expect(read.json()).not.toHaveProperty('preferences');
      const patch = await app.inject({ method: 'PATCH', url: endpoint, payload: { image: 'image-768' } });
      expect(patch.statusCode).toBe(503);
      expect(readFileSync(file, 'utf8')).toBe(raw);
    }
  });

  it.each(['read', 'write', 'rename'])('keeps the committed pair on %s failure and permits a later retry', async operation => {
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', '1');
    const { app, file, paths, start } = fixture();
    writeFileSync(file, JSON.stringify(defaults));
    faults.file = file; faults.operation = operation;
    if (operation === 'read') expect((await app.inject(endpoint)).statusCode).toBe(503);
    const response = await app.inject({ method: 'PATCH', url: endpoint, payload: { image: '2mp' } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).not.toHaveProperty('preferences');
    faults.operation = '';
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(defaults);
    expect(readdirSync(paths.config)).toEqual(['generate-preferences.json']);
    await app.close(); const restarted = start();
    expect((await restarted.inject(endpoint)).json().preferences).toEqual(defaults);
    expect((await restarted.inject({ method: 'PATCH', url: endpoint, payload: { video: '480p' } })).statusCode).toBe(200);
    expect((await restarted.inject({ method: 'PATCH', url: endpoint, payload: { image: '2mp' } })).json().preferences).toEqual({ image: '2mp', video: '480p' });
  });

  it('isolates preference failures from app startup, studio, jobs and Chat routes', async () => {
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS', '');
    const { root, paths, file } = fixture();
    writeFileSync(file, '{broken');
    const webRoot = path.join(root, 'web'); mkdirSync(webRoot); writeFileSync(path.join(webRoot, 'index.html'), '<p>Isolated test app</p>');
    const app = await createApp({ paths, port: 4311, webRoot }); apps.push(app);
    const host = '127.0.0.1:4311', headers = { host, origin: `http://${host}` };
    expect((await app.inject({ url: endpoint, headers })).statusCode).toBe(503);
    expect((await app.inject({ method: 'PATCH', url: endpoint, headers, payload: { image: 'image-768' } })).statusCode).toBe(503);
    for (const url of ['/', '/api/v1/studio', '/api/v1/jobs']) expect((await app.inject({ url, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/chats', headers, payload: { mode: 'sfw' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: endpoint, headers: { host }, payload: { image: 'image-768' } })).statusCode).toBe(403);
    writeFileSync(file, JSON.stringify(defaults)); faults.file = file; faults.operation = 'rename';
    expect((await app.inject({ method: 'PATCH', url: endpoint, headers, payload: { image: 'image-768' } })).statusCode).toBe(503);
    expect((await app.inject({ url: '/api/v1/studio', headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/jobs', headers })).statusCode).toBe(200);
  });
});
