import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { openDatabase } from '../server/db.js';
import path from 'node:path';
import { createApp } from '../server/http.js';
import { resolvePaths } from '../server/storage.js';
import sharp from 'sharp';
import {gunzipSync} from 'node:zlib';
import {workflowIds} from '../shared/studio.js';

let app: Awaited<ReturnType<typeof createApp>>;
let root: string;
const host = '127.0.0.1:4311';
beforeEach(async () => {
  mkdirSync('.local/tests', { recursive: true }); root = mkdtempSync(path.resolve('.local/tests/http-'));
  app = await createApp({ paths: resolvePaths(root), port: 4311, webRoot: path.resolve('dist/web') });
});
afterEach(async () => { await app.close(); await new Promise(resolve => setTimeout(resolve, 30)); rmSync(root, { recursive: true, force: true }); });

describe('local studio boundary', () => {
  it('reads only the saved startup record and keeps internal collection fields private', async () => {
    const db=openDatabase(resolvePaths(root).data);
    try {
      db.prepare('INSERT INTO worker_startup_logs VALUES (?,?)').run('fixture-worker',JSON.stringify({worker_id:'fixture-worker',revision:2,phase:'complete',collection:'sealed',availability:'available',truncated:false,
        cursor:'PRIVATE_CURSOR',resource_id:'PRIVATE_PROVIDER_ID',progress_key:'PRIVATE_HASH',provider_closed:true,sections:[{source:'Vast startup',captured_at:'2026-09-25T00:00:00Z',text:'Pull complete'}]}));
      const response=await app.inject({url:'/api/v1/pool/workers/fixture-worker/startup-logs',headers:{host}});
      expect(response.statusCode).toBe(200);expect(response.body).toContain('Pull complete');expect(response.body).not.toContain('PRIVATE_');
      expect((await app.inject({url:'/api/v1/pool/workers/missing/startup-logs',headers:{host}})).statusCode).toBe(404);
    } finally {db.close();}
  });
  it('accepts every shared workflow through the Chat settings API',async()=>{
    const headers={host,origin:`http://${host}`};
    let chat=(await app.inject({method:'POST',url:'/api/v1/chats',headers,payload:{mode:'sfw'}})).json();
    for(const workflow of workflowIds){const reply=await app.inject({method:'PATCH',url:'/api/v1/chats/'+chat.id,headers,payload:{version:chat.version,workflow}});expect(reply.statusCode,reply.body).toBe(200);chat=reply.json();expect(chat.workflow).toBe(workflow);}
  });
  it('serves the compressed entry page and caches hashed scripts', async () => {
    const response=await app.inject({url:'/',headers:{host,'accept-encoding':'gzip'}});
    expect(response.statusCode).toBe(200);expect(response.headers['content-encoding']).toBe('gzip');expect(response.headers['cache-control']).toBe('no-cache');
    const html=gunzipSync(response.rawPayload).toString(),script=html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    expect(script).toBeTruthy();const asset=await app.inject({url:script!,headers:{host,'accept-encoding':'gzip'}});
    expect(asset.statusCode).toBe(200);expect(asset.headers['content-encoding']).toBe('gzip');expect(asset.headers['cache-control']).toContain('immutable');
  });
  it('filters Spicy-only catalog entries and persists availability without exposing private files', async () => {
    const file=path.join(resolvePaths(root).config,'loras.json');
    writeFileSync(file,JSON.stringify([{id:'adapter',name:'Private adapter',revision:'sha',route:'image',availability:'spicy',file:'private-file',upload:{url:'private-url',expires_at:'2099-01-01'}}]));
    const standard=()=>app.inject({url:'/api/v1/loras',headers:{host}});
    expect((await standard()).json().items).toEqual([]);
    const spicy=(await app.inject({url:'/api/v1/loras?mode=nsfw',headers:{host}})).json();
    expect(spicy.items).toHaveLength(1);expect(spicy.items[0]).not.toHaveProperty('file');expect(spicy.items[0]).not.toHaveProperty('upload');
    expect((await app.inject({method:'PATCH',url:'/api/v1/loras/adapter',headers:{host},payload:{availability:'all'}})).statusCode).toBe(403);
    expect((await app.inject({method:'PATCH',url:'/api/v1/loras/adapter',headers:{host,origin:`http://${host}`},payload:{availability:'all'}})).statusCode).toBe(200);
    expect((await standard()).json().items[0]).toMatchObject({availability:'all'});
  });
  it('lists frames as images and deletes each through the ordinary asset endpoint', async () => {
    const paths=resolvePaths(root), db=openDatabase(paths.data), headers={host,origin:`http://${host}`};
    const bytes=await sharp({create:{width:1344,height:768,channels:3,background:'#345678'}}).png().toBuffer();
    db.prepare('INSERT INTO sequences(id,mode,created_at) VALUES (?,?,?)').run('sequence','sfw',new Date().toISOString());
    for(let i=0;i<3;i++) {
      writeFileSync(path.join(paths.data,`media/outputs/frame${i}.png`),bytes);
      db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('frame'+i,'image','Frame',`media/outputs/frame${i}.png`,JSON.stringify({width:1344,height:768}),new Date().toISOString());
      db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('sequence','frame'+i,i);
    }
    expect((await app.inject({url:'/api/v1/assets?kind=image',headers:{host}})).json().items).toHaveLength(3);
    const preview=await app.inject({url:'/api/v1/assets/frame0/preview',headers:{host}});
    expect(preview.statusCode).toBe(200);expect((await sharp(preview.rawPayload).metadata()).width).toBe(384);
    expect((await app.inject({url:'/api/v1/assets/frame0/content',headers:{host}})).rawPayload).toEqual(bytes);
    expect((await app.inject({method:'DELETE',url:'/api/v1/assets/frame0',headers})).statusCode).toBe(204);
    expect((await app.inject({url:'/api/v1/assets/frame0/content',headers:{host}})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/v1/assets/frame1/content',headers:{host}})).rawPayload).toEqual(bytes);
    expect((await app.inject({url:'/api/v1/assets?kind=image',headers:{host}})).json().items).toHaveLength(2);
    for(const id of ['frame1','frame2'])expect((await app.inject({method:'DELETE',url:'/api/v1/assets/'+id,headers})).statusCode).toBe(204);
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
  it('reports server-owned worker capacity and queue state', async () => {
    const result = await app.inject({ url: '/api/v1/studio', headers: { host } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ pool: {active:0,hourly:0,estimated_spend:0}, activity: {active:0,waiting:0,needs_attention:0} });
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('rejects rebinding hosts, hostile origins and cross-site reads', async () => {
    for (const headers of [{ host: 'evil.test:4311' }, { host, origin: 'https://evil.test' }, { host, 'sec-fetch-site': 'cross-site' }]) {
      const result = await app.inject({ url: '/api/v1/assets', headers });
      expect(result.statusCode).toBe(403);
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('requires same origin for recovery and removes global queue controls', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/v1/jobs/missing/continue', payload: {}, headers: { host } });
    expect(missing.statusCode).toBe(403);
    const headers = { host, origin: `http://${host}` };
    for(const action of ['pause','resume'])expect((await app.inject({method:'POST',url:'/api/v1/queue/'+action,payload:{},headers})).statusCode).toBe(404);
    const unexpected = await app.inject({ method: 'POST', url: '/api/v1/jobs/missing/continue', payload: { unexpected: true }, headers });
    expect(unexpected.statusCode).toBe(400);
    const resume = await app.inject({ method: 'POST', url: '/api/v1/jobs/missing/continue', payload: {}, headers });
    expect(resume.statusCode).toBe(409);
    expect(resume.json().error.code).toBe('recovery_failed');
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
