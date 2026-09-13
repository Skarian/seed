import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

async function readyVideo(page: Page, high = true, native = true) {
  await page.route('**/api/v1/studio', route => route.fulfill({ json: { worker: { state: 'ready', stale: false, connected: true }, queue: { paused: false, active: 0, waiting: 0 }, implementation: { generation: true } } }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { revision: 'video-test', workflows: Object.fromEntries(['text-to-image', 'text-to-video', 'reference-to-video'].map(id => [id, { enabled: true, modes: ['sfw', 'nsfw'], qualities: high ? ['fast', 'high'] : ['fast'], native_export: native }])) } }));
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
    if (mode === 'NSFW') await page.getByRole('button', { name: 'Seed', exact: true }).click({ delay: 900 });
    await page.getByRole('combobox', { name: 'Audio', exact: true }).selectOption(audio!);
    const sent = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/v1/jobs'));
    await page.getByRole('button', { name: 'Create 2 videos' }).click();
    const request = await sent;
    expect(request.postDataJSON()).toEqual({ workflow: 'text-to-video', capabilities_revision: 'video-test', prompt: 'A sailboat crossing a garden pond', mode: mode!.toLowerCase(), quality: 'fast', output: { aspect: '9:16', size: 'native', duration_seconds: 10 }, seed: '142', count: 2, audio: { output: audio } });
    expect(request.headers()['idempotency-key']).toMatch(/^[a-f0-9]{32}$/);
  }
});

test('High Quality defaults off, persists across video workflows and Spicy, and never enters image requests', async ({ page }) => {
  await readyVideo(page);
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  const quality = page.getByRole('checkbox', { name: 'High Quality', exact: true });
  await expect(quality).not.toBeChecked();
  await quality.check();
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await expect(quality).toBeChecked();
  await page.getByRole('button', { name: 'Seed', exact: true }).click({ delay: 900 });
  await expect(quality).toBeChecked();
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByLabel('Prompt', { exact: true }).fill('A natural conversation');
  const high = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/v1/jobs'));
  await page.getByRole('button', { name: 'Create video' }).click();
  expect((await high).postDataJSON()).toMatchObject({ quality: 'high', mode: 'nsfw', output: { size: 'native' } });
  await page.reload();
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await expect(quality).toBeChecked();
  await page.getByLabel('Workflow').selectOption('text-to-image');
  await expect(quality).toHaveCount(0);
  await page.getByLabel('Prompt', { exact: true }).fill('A garden');
  const image = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/v1/jobs'));
  await page.getByRole('button', { name: /^Create image/ }).click();
  const body = (await image).postDataJSON();
  expect(body).not.toHaveProperty('quality');
  expect(body.output.size).toBe('1mp');
});

test('unsupported High Quality stays selected and blocks submission instead of falling back', async ({ page }) => {
  await readyVideo(page, false);
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByLabel('Prompt', { exact: true }).fill('A natural conversation');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'High Quality' }).check();
  await expect(page.getByText('Update the worker to use High Quality.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create video' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'High Quality' })).toBeChecked();
});

test('legacy workers cannot silently downsize new video submissions', async ({ page }) => {
  await readyVideo(page, false, false);
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByLabel('Prompt', { exact: true }).fill('A natural conversation');
  await expect(page.getByText('Update the worker to preserve native video quality.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create video' })).toBeDisabled();
});

test('a worker without Turbo requires selecting its available High Quality profile', async ({ page }) => {
  await readyVideo(page);
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { revision: 'high-only', workflows: { 'text-to-video': { enabled: true, modes: ['sfw'], qualities: ['high'], native_export: true } } } }));
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByLabel('Prompt', { exact: true }).fill('A natural conversation');
  await expect(page.getByText('Fast video is unavailable. Turn on High Quality to continue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create video' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'High Quality' }).check();
  await expect(page.getByRole('button', { name: 'Create video' })).toBeEnabled();
});

test('the single quality checkbox fits desktop and mobile video forms', async ({ page }) => {
  await readyVideo(page);
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByRole('checkbox', { name: 'High Quality', exact: true }).check();
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('checkbox', { name: 'High Quality', exact: true })).toHaveCount(1);
    await expect(page.getByRole('checkbox', { name: 'High Quality', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`high-quality-${name}.png`), fullPage: true });
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
  await page.getByRole('button',{name:'Done',exact:true}).click();
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

test('deleting and reclassifying images leaves prompt text untouched and flags invalid tags', async ({ page }) => {
  await readyVideo(page);
  const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toBuffer();
  await page.goto('/');
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await page.getByLabel('Choose reference files').setInputFiles(['one.png', 'two.png', 'three.png'].map(name => ({ name, mimeType: 'image/png', buffer })));
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button', { name: 'Preview one.png' }).click();
  await page.getByLabel('Role for one.png').selectOption('reference');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('<Picture 1> then <Picture 2> then <Picture 3>');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeEnabled();
  await page.getByRole('button', { name: 'Preview one.png' }).click();
  await page.getByRole('button', { name: 'Delete file' }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('<Picture 1> then <Picture 2> then <Picture 3>');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('missing reference');
  await page.getByLabel('Prompt', { exact: true }).fill('<Picture 1> then <Picture 2>');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeEnabled();
  await page.getByRole('button', { name: 'Preview two.png' }).click();
  await page.getByLabel('Role for two.png').selectOption('first_frame');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('<Picture 1> then <Picture 2>');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeDisabled();
  await page.getByLabel('Prompt', { exact: true }).fill('Continue toward <Picture 1>');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeEnabled();
});
