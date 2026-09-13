import { test, expect } from '@playwright/test';

test('both image modes submit selected settings and show saved output in preview and Library', async ({ page }) => {
  let job: any = null;
  await page.route('**/api/v1/studio', route => route.fulfill({ json: { worker: { state: 'ready', stale: false, connected: true }, queue: { paused: false, active: 0, waiting: 0 }, implementation: { generation: true } } }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { revision: 'test', workflows: { 'text-to-image': { enabled: true, modes: ['sfw', 'nsfw'] } } } }));
  await page.route('**/api/v1/jobs', route => {
    if (route.request().method() === 'POST') {
      const request = route.request().postDataJSON();
      expect(request.workflow).toBe('text-to-image');
      expect(route.request().headers()['idempotency-key']).toMatch(/^[a-f0-9]{32}$/);
      job = { id: 'job-' + request.mode, state: 'completed', outputs: ['asset-' + request.mode], error: null };
      return route.fulfill({ status: 202, json: { submission_id: 'submission', jobs: [job] } });
    }
    return route.fulfill({ json: { items: job ? [job] : [] } });
  });
  await page.route('**/api/v1/assets?*', route => route.fulfill({ json: { items: job?.outputs.length ? [{ id: job.outputs[0], kind: 'image', name: 'Saved image',mode:job.id.endsWith('nsfw')?'nsfw':'sfw' }] : [] } }));
  await page.route('**/api/v1/assets/*/content', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/');
  await page.getByLabel('Prompt', { exact: true }).fill('An illustrated landscape');
  for (const mode of ['SFW', 'NSFW']) {
    if (mode === 'NSFW') await page.getByRole('button', { name: 'Seed', exact: true }).click({ delay: 900 });
    const request = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/v1/jobs'));
    await page.getByRole('button', { name: 'Create image' }).click();
    expect((await request).postDataJSON().mode).toBe(mode.toLowerCase());
    await expect(page.getByRole('img', { name: 'Generated image', exact: true })).toBeVisible();
    await page.getByRole('img', { name: 'Generated image', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Saved image' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Saved image' })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/m3-results-mobile.png', fullPage: true });
  let deletes = 0;
  await page.route('**/api/v1/assets/asset-nsfw', route => { deletes++; job.outputs = []; return route.fulfill({ status: 204 }); });
  const remove = page.getByRole('button', { name: 'Delete generated image' });
  await remove.click();
  await page.getByRole('button', {name:'Cancel',exact:true}).click(); expect(deletes).toBe(0);
  await expect(page.getByRole('img', { name: 'Generated image', exact: true })).toBeVisible();
  await remove.click();
  await page.getByRole('button', {name:'Delete',exact:true}).click();
  await expect(page.getByRole('img', { name: 'Generated image', exact: true })).toHaveCount(0);
  expect(deletes).toBe(1);
  if(!await page.getByRole('button', { name: 'Library', exact: true }).isVisible())await page.getByRole('button',{name:'Toggle sidebar'}).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByText('No saved files yet.')).toBeVisible();
});
