import { test, expect } from '@playwright/test';

test('Forget connection sends a valid request to the real API and returns to pairing', async ({ page }) => {
  let forgotten = false;
  await page.route('**/api/v1/studio', async route => {
    if (forgotten) return route.continue();
    return route.fulfill({ json: { worker: { state: 'ready', connected: true, stale: false }, queue: { active: 0, waiting: 0, paused: true } } });
  });
  await page.route('**/api/v1/connection', async route => {
    const response = await route.fetch();
    forgotten = response.ok();
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Pod connection: Ready', exact: true }).click();
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/connection') && r.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Forget connection', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Pod connection: Not connected', exact: true })).toBeVisible();
  await expect(page.getByLabel('Connection code', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pod connection: Not connected', exact: true })).toBeVisible();
});

test('connection states stay truthful and pairing controls stay out of the ready view', async ({ page }) => {
  let worker = { state: 'ready', connected: true, stale: false, preparation: { phase: 'starting engine', error: null as null | { message: string } } };
  await page.route('**/api/v1/studio', route => route.fulfill({ json: { worker, queue: { active: 0, waiting: 0, paused: true } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Pod connection: Ready', exact: true }).click();
  await expect(page.getByLabel('Connection code', { exact: true })).toHaveCount(0);
  await expect(page.getByText('starting engine', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.local/connection-ready.png' });
  await expect(page.getByRole('button', { name: /Connect (another|a) pod/ })).toHaveCount(0);
  for (const [state, connected, stale, label, tone, message] of [
    ['preparing', true, false, 'Working', 'activity', null],
    ['preparing', true, false, 'Error', 'error', 'Model download failed. Try again later.'],
    ['ready', true, true, 'Not connected', 'attention', null],
    ['disconnected', false, true, 'Not connected', 'attention', null],
  ] as const) {
    worker = { state, connected, stale, preparation: { phase: 'Preparing models…', error: message ? { message } : null } };
    await page.reload();
    const badge = page.getByRole('button', { name: `Pod connection: ${label}`, exact: true });
    await expect(badge).toHaveAttribute('data-tone', tone);
    await badge.click();
    if (message) await expect(page.getByText(message, { exact: true })).toBeVisible();
    if (tone === 'attention' && connected) {
      await page.getByRole('button', { name: 'Connect a pod', exact: true }).click();
      await expect(page.getByLabel('Connection code', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else {
      await expect(page.getByRole('button', { name: /Connect (another|a) pod/ })).toHaveCount(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/connection-${tone}-${connected}.png` });
  }
});
