import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

async function readyVideo(page: Page) {
  await page.route('**/api/v1/studio', route => route.fulfill({ json: { worker: { state: 'ready', stale: false, connected: true }, queue: { paused: false, active: 0, waiting: 0 }, implementation: { generation: true } } }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { revision: 'video-test', workflows: Object.fromEntries(['text-to-video', 'reference-to-video'].map(id => [id, { enabled: true, modes: ['sfw', 'nsfw'] }])) } }));
  await page.route('**/api/v1/jobs', route => route.fulfill({ status: route.request().method() === 'POST' ? 202 : 200, json: route.request().method() === 'POST' ? { submission_id: 'test', jobs: [] } : { items: [] } }));
}

test('video submission preserves selected mode, soundtrack, duration, batch and seed', async ({ page }) => {
  await readyVideo(page);
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByLabel('Prompt', { exact: true }).fill('A sailboat crossing a garden pond');
  await page.getByRole('button', { name: 'Portrait 9:16' }).click();
  await page.getByRole('button', { name: '10s', exact: true }).click();
  await page.getByLabel('Generations', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Advanced', exact: false }).click();
  await page.getByLabel('Random seed', { exact: true }).uncheck();
  await page.getByLabel('Starting seed', { exact: true }).fill('142');
  for (const [mode, audio] of [['SFW', 'generated'], ['NSFW', 'silent']]) {
    await page.getByRole('button', { name: mode!, exact: true }).click();
    await page.getByRole('combobox', { name: 'Audio', exact: true }).selectOption(audio!);
    const sent = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/v1/jobs'));
    await page.getByRole('button', { name: 'Create 2 videos' }).click();
    const request = await sent;
    expect(request.postDataJSON()).toEqual({ workflow: 'text-to-video', capabilities_revision: 'video-test', prompt: 'A sailboat crossing a garden pond', mode: mode!.toLowerCase(), output: { aspect: '9:16', size: '720p', duration_seconds: 10 }, seed: '142', count: 2, audio: { output: audio } });
    expect(request.headers()['idempotency-key']).toMatch(/^[a-f0-9]{32}$/);
  }
});

test('reference video uses real tus upload and verified asset IDs with inserted native labels', async ({ page }) => {
  await readyVideo(page);
  const pixels = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f05020' } }).png().toBuffer();
  let uploadCreates = 0, uploadPatches = 0;
  page.on('request', request => { if (request.url().includes('/api/v1/uploads')) { if (request.method() === 'POST') uploadCreates++; if (request.method() === 'PATCH') uploadPatches++; } });
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await page.getByLabel('Choose reference files').setInputFiles({ name: 'video-test-reference.png', mimeType: 'image/png', buffer: pixels });
  await page.getByRole('button', { name: 'Preview video-test-reference.png' }).click();
  await page.getByLabel('Role for video-test-reference.png').selectOption('reference');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('Animate');
  await page.getByRole('button', { name: '<Picture 1>', exact: true }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('Animate <Picture 1> ');
  const sent = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/v1/jobs'));
  await page.getByRole('button', { name: 'Create video' }).click();
  const body = (await sent).postDataJSON();
  expect(body.references).toHaveLength(1);
  expect(body.references[0]).toMatchObject({ kind: 'image', role: 'reference', framing: 'fit' });
  expect(body.references[0].asset_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(body.prompt).toBe('Animate <Picture 1> ');
  expect(uploadCreates).toBe(1);
  expect(uploadPatches).toBeGreaterThan(0);
  const verified = await page.request.get('/api/v1/assets/' + body.references[0].asset_id);
  expect(verified.ok()).toBe(true);
  expect(await verified.json()).toMatchObject({ state: 'ready', kind: 'image', width: 64, height: 48, mime_type: 'image/png' });
  const content = await page.request.get('/api/v1/assets/' + body.references[0].asset_id + '/content');
  expect(await content.body()).toEqual(pixels);
  // Reuse the exact selected file without reuploading it when only the prompt changes.
  await page.getByLabel('Prompt', { exact: true }).fill('Another view of <Picture 1>');
  const again = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/v1/jobs'));
  await page.getByRole('button', { name: 'Create video' }).click();
  expect((await again).postDataJSON().references[0].asset_id).toBe(body.references[0].asset_id);
  expect(uploadCreates).toBe(1);
});
