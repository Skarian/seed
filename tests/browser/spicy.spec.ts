import { test, expect } from '@playwright/test';

test('short clicks and canceled holds do not toggle; keyboard holds do', async ({ page }) => {
  await page.goto('/library');
  const logo = page.getByRole('button', { name: 'Seed', exact: true });
  const off = page.getByRole('button', { name: 'Turn off Spicy mode' });
  await logo.click();
  await expect(page.getByLabel('Workflow')).toBeVisible();
  await expect(off).toHaveCount(0);
  await logo.dispatchEvent('pointerdown', { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
  await logo.dispatchEvent('pointercancel');
  await page.waitForTimeout(900);
  await expect(off).toHaveCount(0);
  await logo.focus();
  await page.keyboard.down('Space');
  await expect(off).toBeVisible();
  await page.keyboard.up('Space');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await expect(off).toBeVisible();
  await page.getByLabel('Workflow').selectOption('reference-to-video');
  await expect(off).toBeVisible();
  await logo.click({ delay: 900 });
  await expect(off).toHaveCount(0);
});

test('touch hold shows a toast and pepper without leaving Library', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const cspErrors: string[] = [];
  page.on('console', message => { if (message.text().includes('Content Security Policy')) cspErrors.push(message.text()); });
  await page.goto('http://127.0.0.1:4311/library');
  const logo = page.getByRole('button', { name: 'Seed', exact: true });
  const box = (await logo.boundingBox())!;
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 15, y: box.y + 15 }] });
  await expect(page.getByText('Spicy mode on', { exact: true })).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off Spicy mode' })).toBeVisible();
  await expect(page.locator('.mode-toast')).toHaveCSS('display', 'flex');
  expect(cspErrors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('spicy-mobile.png') });
  const fresh = await context.newPage();
  await fresh.goto('http://127.0.0.1:4311/');
  await expect(fresh.getByRole('button', { name: 'Turn off Spicy mode' })).toHaveCount(0);
  await context.close();
});

test('a submitted job retains its mode after Spicy is turned off', async ({ page }) => {
  await page.route('**/api/v1/studio', r => r.fulfill({ json: { worker: { state: 'ready', connected: true, stale: false }, queue: { active: 0, waiting: 0 } } }));
  await page.route('**/api/v1/capabilities', r => r.fulfill({ json: { revision: 'test', workflows: { 'text-to-image': { enabled: true, modes: ['sfw', 'nsfw'] } } } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let submitted: any;
  await page.route('**/api/v1/jobs', async r => {
    if (r.request().method() === 'POST') {
      submitted = r.request().postDataJSON();
      await gate;
      await r.fulfill({ json: { submission_id: 'test', jobs: [] } });
    } else await r.fulfill({ json: { items: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Seed', exact: true }).click({ delay: 900 });
  await page.getByLabel('Prompt', { exact: true }).fill('A mountain');
  await page.getByRole('button', { name: 'Create image' }).click();
  await expect.poll(() => submitted?.mode).toBe('nsfw');
  await page.getByRole('button', { name: 'Turn off Spicy mode' }).click();
  release();
  expect(submitted.mode).toBe('nsfw');
});

