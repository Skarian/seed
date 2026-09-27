import { test, expect, type Page } from './fixtures.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const catalog = [
  ['931','Admin access','Remote address is optional; local access stays available'],
  ['932','Admin access','A long saved HTTPS address uses the full field width'],
  ['933','Admin access','Invalid address preserves the draft and saved setting'],
  ['934','Admin access','Failed save preserves the previous address and can be retried'],
] as const;
const root = path.resolve(process.env.SEED_ATLAS_ROOT ?? '.local/admin-access-atlas');
const localUrl = 'http://127.0.0.1:4311';
const headers = { Origin: localUrl };
const publicOrigin = 'https://seed-studio-with-a-long-remote-name.example.com';

async function capture(page: Page, device: string, id: string) {
  const [, surface, title] = catalog.find(row => row[0] === id)
    ?? ['935', 'Admin access', 'Narrow mobile keeps errors and both actions readable'];
  await mkdir(path.join(root, device), { recursive: true });
  await page.getByRole('heading', { name: 'Access', exact: true }).click();
  await page.evaluate(async () => { await document.fonts.ready; });
  const file = device + '/' + id + '.png';
  await page.screenshot({ path: path.join(root, file), animations: 'disabled', fullPage: true });
  await writeFile(path.join(root, device, id + '.json'), JSON.stringify({
    id, surface, title, device, file, viewport: page.viewportSize(), status: 'passed',
    run_id: process.env.SEED_ATLAS_RUN_ID,
  }));
}

for (const device of ['desktop', 'mobile'] as const) test.describe(device, () => {
  test.use({
    viewport: device === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
    hasTouch: device === 'mobile', isMobile: device === 'mobile',
  });

  test('remote address saves, validates, recovers from failure and removes without losing local access', async ({ page, request }) => {
    const reset = () => request.patch('/api/v1/admin/access', { headers, data: { publicOrigin: null } });
    expect((await reset()).ok()).toBe(true);
    try {
      await page.goto('/admin');
      await page.getByRole('button', { name: 'Access', exact: true }).click();
      await expect(page).toHaveURL(/\/admin\?section=access$/);
      const input = page.getByRole('textbox', { name: 'Remote URL', exact: true });
      const save = page.getByRole('button', { name: 'Save address', exact: true });
      await expect(input).toBeEnabled();
      await expect(input).toHaveValue('');
      await expect(save).toBeDisabled();
      await expect(page.getByRole('link', { name: 'Open Seed at its local address' })).toHaveAttribute('href', localUrl);
      await expect(page.getByRole('button', { name: 'Remove address', exact: true })).toHaveCount(0);
      const field = await input.boundingBox(), card = await page.locator('.admin-access-card').boundingBox();
      expect(field!.width).toBeGreaterThan(card!.width - 55);
      await capture(page, device, '931');

      await input.fill(publicOrigin.toUpperCase() + '/');
      await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
      await save.click();
      await expect(page.getByRole('status')).toHaveText('Address saved. No restart needed.');
      await expect(input).toHaveValue(publicOrigin);
      await expect(save).toBeDisabled();
      expect((await (await request.get('/api/v1/admin/access')).json()).publicOrigin).toBe(publicOrigin);
      await page.reload();
      await expect(input).toHaveValue(publicOrigin);
      await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
      await capture(page, device, '932');

      await input.fill('http://seed.example.com');
      await save.click();
      const alert = page.getByRole('region', { name: 'Access settings' }).getByRole('alert');
      await expect(alert).toContainText(/HTTPS/i);
      await expect(input).toHaveValue('http://seed.example.com');
      expect((await (await request.get('/api/v1/admin/access')).json()).publicOrigin).toBe(publicOrigin);
      await capture(page, device, '933');

      await input.fill('https://new-seed.example.com');
      let finishSave = () => {};
      const pendingSave = new Promise<void>(resolve => { finishSave = resolve; });
      await page.route('**/api/v1/admin/access', async route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        await pendingSave;
        return route.fulfill({ status: 503, json: { error: { code: 'admin_error', message: 'Could not save settings. Please try again.' } } });
      });
      await save.click();
      await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
      await expect(input).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Remove address', exact: true })).toBeDisabled();
      finishSave();
      await expect(alert).toHaveText('Could not save settings. Please try again.');
      await expect(input).toHaveValue('https://new-seed.example.com');
      await expect(save).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Remove address', exact: true })).toBeEnabled();
      expect((await (await request.get('/api/v1/admin/access')).json()).publicOrigin).toBe(publicOrigin);
      await capture(page, device, '934');
      if (device === 'mobile') {
        await page.setViewportSize({ width: 320, height: 700 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const buttons = page.locator('.admin-access-actions button');
        for (const button of await buttons.all()) {
          const bounds = (await button.boundingBox())!;
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
        }
        await capture(page, 'mobile-narrow', '935');
      }
      await page.unroute('**/api/v1/admin/access');
      await save.click();
      await expect(page.getByRole('status')).toHaveText('Address saved. No restart needed.');
      expect((await (await request.get('/api/v1/admin/access')).json()).publicOrigin).toBe('https://new-seed.example.com');
      await page.getByRole('button', { name: 'Remove address', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Address removed. Your local address still works.');
      await expect(input).toHaveValue('');
      await expect(save).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Remove address', exact: true })).toHaveCount(0);
      await page.reload();
      await expect(input).toHaveValue('');
      expect(await (await request.get('/api/v1/admin/access')).json()).toEqual({ localUrl, publicOrigin: null });
    } finally {
      await reset();
    }
  });

  test('access loading errors retry and late reads cannot replace another admin page', async ({ page, request }) => {
    expect((await request.patch('/api/v1/admin/access', { headers, data: { publicOrigin: null } })).ok()).toBe(true);
    let reads = 0, release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/admin/access', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      reads++;
      if (reads === 1) return route.fulfill({ status: 503, json: { error: { message: 'Access settings are temporarily unavailable.' } } });
      if (reads === 2) await held;
      return route.fallback();
    });
    await page.goto('/admin?section=access');
    await expect(page.getByRole('alert')).toHaveText('Access settings are temporarily unavailable.');
    await expect(page.getByRole('textbox', { name: 'Remote URL', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Loading access settings…');
    await page.getByRole('button', { name: 'Credentials', exact: true }).click();
    release();
    await expect(page.getByRole('heading', { name: 'Credentials', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Remote URL', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Remote URL', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
