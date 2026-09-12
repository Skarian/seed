import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { openDatabase } from '../server/db.js';
import path from 'node:path';
import { createApp } from '../server/http.js';
import { resolvePaths } from '../server/storage.js';
import sharp from 'sharp';

let app: Awaited<ReturnType<typeof createApp>>;
let root: string;
const host = '127.0.0.1:4311';
beforeEach(async () => {
  mkdirSync('.local/tests', { recursive: true }); root = mkdtempSync(path.resolve('.local/tests/http-'));
  app = await createApp({ paths: resolvePaths(root), port: 4311, webRoot: path.resolve('dist/web') });
});
afterEach(async () => { await app.close(); await new Promise(resolve => setTimeout(resolve, 30)); rmSync(root, { recursive: true, force: true }); });

describe('local studio boundary', () => {
  it('serves real frame previews, groups Library results and retains selected originals', async () => {
    const paths=resolvePaths(root), db=openDatabase(paths.data), headers={host,origin:`http://${host}`};
    const bytes=await sharp({create:{width:1344,height:768,channels:3,background:'#345678'}}).png().toBuffer();
    db.prepare('INSERT INTO sequences(id,mode,created_at) VALUES (?,?,?)').run('sequence','sfw',new Date().toISOString());
    for(let i=0;i<3;i++) {
      writeFileSync(path.join(paths.data,`media/outputs/frame${i}.png`),bytes);
      db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('frame'+i,'image','Frame',`media/outputs/frame${i}.png`,JSON.stringify({width:1344,height:768}),new Date().toISOString());
      db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('sequence','frame'+i,i);
    }
    expect((await app.inject({url:'/api/v1/assets',headers:{host}})).json().items).toHaveLength(1);
    const preview=await app.inject({url:'/api/v1/assets/frame0/preview',headers:{host}});
    expect(preview.statusCode).toBe(200);expect((await sharp(preview.rawPayload).metadata()).width).toBe(384);
    expect((await app.inject({url:'/api/v1/assets/frame0/content',headers:{host}})).rawPayload).toEqual(bytes);
    expect((await app.inject({method:'DELETE',url:'/api/v1/assets/frame0',headers})).statusCode).toBe(409);
    const kept=await app.inject({method:'POST',url:'/api/v1/sequences/sequence/keep-only',headers,payload:{asset_ids:['frame1'],revision:0}});
    expect(kept.statusCode).toBe(200);expect(kept.json().frames.map((f:any)=>f.id)).toEqual(['frame1']);
    expect((await app.inject({url:'/api/v1/assets/frame0/content',headers:{host}})).statusCode).toBe(404);
    expect((await app.inject({method:'DELETE',url:'/api/v1/sequences/sequence',headers})).statusCode).toBe(204);
    expect((await app.inject({url:'/api/v1/assets',headers:{host}})).json().items).toHaveLength(0);
    db.close();
  });
  it('deletes a saved file and record, permits retry, and rejects paths outside storage', async () => {
    const paths = resolvePaths(root), db = openDatabase(paths.data);
    const file = path.join(paths.data, 'media/outputs/test.png'); writeFileSync(file, 'image');
    const insert = db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)');
    insert.run('test', 'image', 'Test image', 'media/outputs/test.png', '{}', new Date().toISOString());
    const headers = { host, origin: `http://${host}` };
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/assets/test', headers: { host } })).statusCode).toBe(403);
    expect(existsSync(file)).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/assets/test', headers })).statusCode).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(db.prepare('SELECT id FROM assets WHERE id=?').get('test')).toBeUndefined();
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/assets/test', headers })).statusCode).toBe(204);
    const outside = path.join(root, 'keep.txt'); writeFileSync(outside, 'keep');
    insert.run('outside', 'video', 'Outside', '../keep.txt', '{}', new Date().toISOString());
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/assets/outside', headers })).statusCode).toBe(409);
    expect(existsSync(outside)).toBe(true);
    db.close();
  });
  it('reports disconnected and unknown safety, never provider-off or ready', async () => {
    const result = await app.inject({ url: '/api/v1/studio', headers: { host } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ worker: { state: 'disconnected', stale: true }, safe_to_terminate: null, checked_at: null, queue: { paused: true }, implementation: { generation: true } });
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('rejects rebinding hosts, hostile origins and cross-site reads', async () => {
    for (const headers of [{ host: 'evil.test:4311' }, { host, origin: 'https://evil.test' }, { host, 'sec-fetch-site': 'cross-site' }]) {
      const result = await app.inject({ url: '/api/v1/assets', headers });
      expect(result.statusCode).toBe(403);
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('requires same origin for mutations and never resumes disconnected work', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/v1/queue/pause', payload: {}, headers: { host } });
    expect(missing.statusCode).toBe(403);
    const headers = { host, origin: `http://${host}` };
    const paused = await app.inject({ method: 'POST', url: '/api/v1/queue/pause', payload: {}, headers });
    expect(paused.json()).toEqual({ paused: true });
    const unexpected = await app.inject({ method: 'POST', url: '/api/v1/queue/pause', payload: { unexpected: true }, headers });
    expect(unexpected.statusCode).toBe(400);
    const resume = await app.inject({ method: 'POST', url: '/api/v1/queue/resume', payload: {}, headers });
    expect(resume.statusCode).toBe(409);
    expect(resume.json().error.code).toBe('worker_unavailable');
  });
  it('does not serve private config or disguise unknown APIs as HTML', async () => {
    for (const url of ['/api/v1/connection', '/server/db.ts']) {
      const response = await app.inject({ url, headers: { host } });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('not_found');
    }
    const secret = await app.inject({ url: '/.env', headers: { host } });
    expect(secret.statusCode).toBe(403);
    expect(secret.json().error.code).toBe('invalid_request');
  });
});
