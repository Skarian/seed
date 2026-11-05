import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/http.js';
import { openDatabase } from '../server/db.js';
import { resolvePaths } from '../server/storage.js';

it('saves a crop as a new image linked to its original, its job and its project', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/crops-')),
    paths = resolvePaths(root);
  const app = await createApp({ paths, port: 4312, webRoot: path.resolve('dist/web') }),
    db = openDatabase(paths.data);
  const headers = { host: '127.0.0.1:4312', origin: 'http://127.0.0.1:4312' };
  try {
    // A synthetic 400×200 image: left half red, right half blue.
    await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ff0000' } })
      .composite([
        { input: { create: { width: 200, height: 200, channels: 3, background: '#0000ff' } }, left: 200, top: 0 },
      ])
      .png()
      .toFile(path.join(paths.data, 'media/outputs/source.png'));
    const now = new Date().toISOString();
    db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)').run(
      'job-1',
      'text-to-image',
      'completed',
      JSON.stringify({ request: { title: 'Shot 2', prompt: 'synthetic lighthouse', count: 2 }, source: { chat_id: 'chat-1' }, submission_index: 0 }),
      now,
      now,
      'sub-1',
      0,
    );
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(
      'source',
      'image',
      'Shot 2.png',
      'media/outputs/source.png',
      JSON.stringify({ state: 'ready', mode: 'sfw', mime_type: 'image/png', job_id: 'job-1', width: 400, height: 200 }),
      now,
    );
    db.prepare('INSERT INTO asset_notes VALUES (?,?,0)').run('source', 'Synthetic note');
    const crop = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/v1/assets/source/crops', headers, payload });
    expect((await crop({ x: 300, y: 0, width: 200, height: 200 })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/v1/assets/source/crops', headers: { host: headers.host }, payload: { x: 0, y: 0, width: 100, height: 100 } })).statusCode).toBe(403);
    const blue = await crop({ x: 200, y: 0, width: 200, height: 200, shape: '1:1' });
    expect(blue.statusCode).toBe(200);
    expect(blue.json()).toMatchObject({ width: 200, height: 200, source_asset_id: 'source', crop: { x: 200, shape: '1:1' } });
    const bytes = (await app.inject({ url: '/api/v1/assets/' + blue.json().id + '/content', headers: { host: headers.host } })).rawPayload;
    const stats = await sharp(bytes).stats();
    expect(stats.channels[2]!.mean).toBeGreaterThan(240);
    expect(stats.channels[0]!.mean).toBeLessThan(10);
    expect((await crop({ x: 200, y: 0, width: 200, height: 200, shape: '1:1' })).json().id).toBe(blue.json().id);
    // The Library lists it as made in Seed, in the same project, searchable by the original's prompt and note.
    const made = (await app.inject({ url: '/api/v1/assets?mode=sfw&source=made&q=lighthouse', headers: { host: headers.host } })).json().items;
    const item = made.find((a: { id: string }) => a.id === blue.json().id);
    expect(item).toMatchObject({ source_asset_id: 'source', chat_id: 'chat-1', title: 'Shot 2', note: 'Synthetic note' });
    expect(item.job_id).toBeUndefined();
    expect(item.variant).toBeUndefined();
    const uploaded = (await app.inject({ url: '/api/v1/assets?mode=sfw&source=uploaded', headers: { host: headers.host } })).json().items;
    expect(uploaded).toEqual([]);
    // An edit made from this image has its own job: it is an ordinary result, not a crop of its source.
    db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)').run(
      'job-2',
      'image-to-image',
      'completed',
      JSON.stringify({ request: { title: 'Shot 3: Edited', prompt: 'synthetic edit', count: 1 }, source: { chat_id: 'chat-1' }, submission_index: 0 }),
      now,
      now,
      'sub-2',
      0,
    );
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(
      'edit-out',
      'image',
      'edit.png',
      'media/outputs/edit.png',
      JSON.stringify({ state: 'ready', mode: 'sfw', job_id: 'job-2', source_asset_id: 'source', width: 400, height: 200 }),
      now,
    );
    const all = (await app.inject({ url: '/api/v1/assets?mode=sfw', headers: { host: headers.host } })).json().items;
    const edit = all.find((a: { id: string }) => a.id === 'edit-out');
    expect(edit).toMatchObject({ job_id: 'job-2', title: 'Shot 3: Edited' });
    expect(edit.source_asset_id).toBeUndefined();
  } finally {
    db.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
