import { test, expect } from './fixtures.js';

test('Admin owns credentials and leaves their values out of the browser', async ({ page }) => {
  await page.goto('/admin');
  for (const name of ['Vast', 'RunPod', 'OpenRouter', 'Civitai', 'Hugging Face']) await expect(page.getByLabel(name + ' API key', { exact: true })).toHaveValue('');
  await expect(page.getByText('Billing key', { exact: true })).toHaveCount(0);
  await expect(page.getByText('fal', { exact: true })).toHaveCount(0);
});

test('Generate submits without a price, queues without workers and opens the matching class', async ({ page }) => {
  const prices: string[] = []; page.on('request', request => { if (request.url().includes('/estimates')) prices.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Text to video', exact: true }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('A sailboat quietly crosses a pond');
  await expect(page.getByRole('button', { name: /^Create video/ })).toBeEnabled();
  const sent = page.waitForRequest(request => request.url().endsWith('/api/v1/jobs') && request.method() === 'POST');
  await page.getByRole('button', { name: /^Create video/ }).click();
  expect((await sent).headers()['x-seed-estimate']).toBeUndefined();
  await expect(page.getByRole('dialog', { name: 'GPU workers', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Video worker H3/ })).toHaveAttribute('aria-pressed', 'true');
  expect(prices).toHaveLength(0);
  await page.getByRole('button', { name: 'Close GPU workers', exact: true }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('A sailboat quietly crosses a pond');
});

test('Chat proposes named LoRAs and approves without generation pricing', async ({ page }) => {
  await page.goto('/chat');
  const editor = page.getByRole('combobox', { name: 'Chat message' });
  await editor.fill('/text-to-image A watercolor mountain lake'); await editor.press('Enter');
  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('.selected-loras').first()).toContainText('Watercolor study');
  await expect(page.locator('.cost-preview')).toHaveCount(0);
  const sent = page.waitForRequest(request => request.url().endsWith('/decision') && request.method() === 'POST');
  await approve.click();
  const body = (await sent).postDataJSON(); expect(body.decision).toBe('approved'); expect(body.estimate_id).toBeUndefined();
  await expect(approve).toHaveCount(0);
});
