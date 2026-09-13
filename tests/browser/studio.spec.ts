import { test, expect } from '@playwright/test';

test('seed keeps drafts created before the rename', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('seed.drafts.v2');
    localStorage.setItem('studio.drafts.v2', JSON.stringify({
      'text-to-image': { prompt: 'A preserved idea', count: 3, randomSeed: false, seed: '42' },
    }));
  });
  await page.reload();
  await expect(page).toHaveTitle('seed');
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('A preserved idea');
  await expect(page.getByLabel('Generations', { exact: true })).toHaveValue('3');
  await page.getByLabel('Prompt', { exact: true }).fill('An updated idea');
  await page.reload();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('An updated idea');
});

test('workflow drafts persist, reset is scoped, and mode controls work', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Seed', exact: true }).click({ delay: 900 });
  await expect(page.getByRole('button', { name: 'Turn off Spicy mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Portrait 9:16' }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('An observatory above the clouds');
  await page.reload();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('An observatory above the clouds');
  await expect(page.getByRole('button', { name: 'Turn off Spicy mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Portrait 9:16' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByRole('slider', { name: 'Length', exact: true }).fill('15');
  await page.getByLabel('Prompt', { exact: true }).fill('A rolling cloud');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset form', exact: true }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('');
  await expect(page.getByRole('slider', {name:'Length',exact:true})).toHaveValue('5');
  await page.getByLabel('Workflow').selectOption('text-to-image');
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('An observatory above the clouds');
  await page.getByRole('button', { name: 'Reset form', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Turn off Spicy mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Landscape 16:9' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Output preview' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('generate-desktop.png'), fullPage: true });
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await expect(page.getByRole('button', { name: 'Turn off Spicy mode', exact: true })).toBeVisible();
  await expect(page.getByText('References', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile layout, popovers and prompt resize are usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByLabel('Workflow')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('generate-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: /^Pod connection:/ }).click();
  await expect(page.locator('#pod-details').getByText('Not connected', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pod-details').getByText('Not connected', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: /^Jobs/ }).click();
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close jobs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).not.toBeVisible();
  const before = await page.getByLabel('Prompt', { exact: true }).boundingBox();
  await page.getByRole('button', { name: 'Resize prompt', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  const after = await page.getByLabel('Prompt', { exact: true }).boundingBox();
  expect(after!.height).toBe(before!.height + 20);
  const handle = await page.getByRole('button', { name: 'Resize prompt', exact: true }).boundingBox();
  await page.mouse.move(handle!.x + 12, handle!.y + 12); await page.mouse.down();
  await page.mouse.move(handle!.x + 12, handle!.y + 72); await page.mouse.up();
  expect((await page.getByLabel('Prompt', { exact: true }).boundingBox())!.height).toBe(after!.height + 60);
  await page.getByRole('button', { name: 'Reset form', exact: true }).click();
  expect((await page.getByLabel('Prompt', { exact: true }).boundingBox())!.height).toBe(240);
});

test('batch and seed settings persist per workflow and validate the full seed range', async ({ page }) => {
  await page.goto('/');
  for (const workflow of ['text-to-image', 'text-to-video', 'reference-to-video']) {
    await page.getByLabel('Workflow').selectOption(workflow);
    await page.getByLabel('Generations', { exact: true }).selectOption('4');
    if (await page.getByRole('button', { name: 'Advanced', exact: false }).getAttribute('aria-expanded') === 'false') {
      await page.getByRole('button', { name: 'Advanced', exact: false }).click();
    }
    await page.getByLabel('Random seed', { exact: true }).uncheck();
    await page.getByLabel('Starting seed', { exact: true }).fill('42');
    await expect(page.getByRole('button', { name: /^Create 4/ })).toBeDisabled();
  }
  await page.reload();
  await expect(page.getByLabel('Generations', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Advanced', exact: false }).click();
  await expect(page.getByLabel('Starting seed', { exact: true })).toHaveValue('42');
  await page.getByLabel('Starting seed', { exact: true }).fill('9007199254740991');
  await expect(page.getByLabel('Starting seed', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Generations', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Starting seed', { exact: true })).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Reset form', exact: true }).click();
  await expect(page.getByLabel('Generations', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Advanced', exact: false })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Advanced', exact: false }).click();
  await expect(page.getByLabel('Random seed', { exact: true })).toBeChecked();
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await expect(page.getByLabel('Generations', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Advanced', exact: false }).click();
  await expect(page.getByLabel('Starting seed', { exact: true })).toHaveValue('42');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('batch-advanced-mobile.png'), fullPage: true });
});

test('thumbnail dropbox opens a reusable viewer with info, roles, download and deletion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await page.getByLabel('Choose reference files').setInputFiles([
    { name: 'scene.png', mimeType: 'image/png', buffer: image },
    { name: 'person.png', mimeType: 'image/png', buffer: image },
  ]);
  await page.getByRole('button',{name:'Done / Skip'}).click();
  await expect(page.getByText('max: 12', { exact: true })).not.toBeVisible();
  await page.getByLabel('Asset limits').click();
  await expect(page.getByText('max: 12', { exact: true })).toBeVisible();
  await page.getByLabel('Asset limits').click();
  await expect(page.getByText('scene.png', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview person.png' }).click();
  const viewer = page.getByRole('dialog', { name: 'Media preview' });
  await expect(viewer).toBeVisible();
  await expect(page.getByLabel('Role for person.png')).toHaveValue('reference');
  await page.getByLabel('File information').click();
  await expect(viewer.getByText('person.png', { exact: true })).toBeVisible();
  await expect(viewer.getByText('image/png', { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download file' }).click();
  expect((await downloaded).suggestedFilename()).toBe('person.png');
  await page.keyboard.press('Escape'); await expect(viewer).toHaveCount(0);
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await page.getByLabel('Choose reference files').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not media') });
  await expect(page.getByRole('alert')).toContainText('choose an image, video or audio');
  await page.getByLabel('Choose reference files').setInputFiles({ name: 'anchor.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('button',{name:'Done / Skip'}).click();
  await page.getByRole('button', { name: 'Preview anchor.png' }).click();
  await page.getByLabel('Role for anchor.png').selectOption('last_frame');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('button', { name: 'Preview anchor.png' }).click();
  await expect(page.getByLabel('Role for anchor.png')).toHaveValue('last_frame');
  await page.screenshot({ path: test.info().outputPath('viewer-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Delete file' }).click();
  await expect(viewer).toHaveCount(0);
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await expect(page.getByRole('button', { name: 'Preview person.png' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('thumbnail-dropbox-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reset form', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview person.png' })).toHaveCount(0);
});

test('audio and video previews expose source duration and editable clip ranges', async ({ page }) => {
  await page.goto('/');
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(24);
    const chunks: Blob[] = []; const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    recorder.ondataavailable = event => chunks.push(event.data);
    const finished = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    const draw = setInterval(() => { context.fillStyle = '#658542'; context.fillRect(0, 0, 320, 180); }, 40);
    await new Promise(resolve => setTimeout(resolve, 2500));
    recorder.stop(); await finished; clearInterval(draw); stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const samples = 8000 * 20; const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await page.getByLabel('Choose reference files').setInputFiles([
    { name: 'motion.webm', mimeType: 'video/webm', buffer: Buffer.from(videoBytes) },
    { name: 'sound.wav', mimeType: 'audio/wav', buffer: wav },
  ]);
  await page.getByRole('button',{name:'Done / Skip'}).click();
  await page.getByRole('button', { name: 'Preview motion.webm' }).click();
  await expect(page.locator('.viewer-canvas video')).toBeVisible();
  await page.locator('.viewer-canvas video').evaluate(element => (element as HTMLVideoElement).play());
  await expect.poll(() => page.locator('.viewer-canvas video').evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.locator('.viewer-canvas video').evaluate(element => (element as HTMLVideoElement).pause());
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'Preview sound.wav' }).click();
  await expect(page.locator('audio')).toBeVisible();
  await page.locator('audio').evaluate(element => (element as HTMLAudioElement).play());
  await expect.poll(() => page.locator('audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await page.locator('audio').evaluate(element => (element as HTMLAudioElement).pause());
  await expect(page.getByLabel('End for sound.wav')).toHaveValue('15');
  await page.getByLabel('Start for sound.wav').fill('10');
  await page.getByLabel('End for sound.wav').fill('20');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('End for sound.wav').fill('25');
  await expect(page.getByRole('alert')).toContainText('within the source');
  await page.getByLabel('End for sound.wav').fill('20');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('video-references-mobile.png'), fullPage: true });
});

test('connection form rejects invalid codes and clears them without browser persistence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Pod connection:/ }).click();
  await page.getByLabel('Connection code', { exact: true }).fill('studio1.invalid-connection-code');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid connection code');
  await expect(page.getByLabel('Connection code', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('studio1.');
});
