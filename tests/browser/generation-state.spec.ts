import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/studio', (route) =>
    route.fulfill({
      json: {
        pool: { active: 0, ready: 0, busy: 0, preparing: 0, needs_attention: 0, hourly: 0, estimated_spend: 0, image: 0, video: 0 },
        activity: { active: 0, waiting: 0, needs_attention: 0 },
        outputs: { pending: 0 },
      },
    }),
  );
  await page.route('**/api/v1/jobs', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/loras*', (route) => route.fulfill({ json: { items: [] } }));
});

test('workflow drafts survive navigation and reload without waiting for prices', async ({
  page,
}) => {
  const prices: { count: number; workflow: string }[] = [];
  await page.route('**/api/v1/estimates', async (route) => {
    const input = route.request().postDataJSON();
    prices.push(input);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      json: {
        id: 'quote-' + input.workflow + '-' + input.count,
        total: 0.01 * input.count,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Prompt', { exact: true }).fill('An image draft');
  await expect(page.getByRole('button', { name: /^Create image/ })).toBeEnabled();
  await page.getByLabel('Quantity', { exact: true }).selectOption('4');
  await expect(page.getByRole('button', { name: /^Create 4 images/ })).toBeEnabled();
  await expect(page.locator('.cost-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Text to video', exact: true }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('A video draft');
  await page.getByLabel('Length', { exact: true }).selectOption('10');
  await expect(page.getByRole('button', { name: /^Create video/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.goBack();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('A video draft');
  await expect(page.getByLabel('Length', { exact: true })).toHaveValue('10');
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('An image draft');
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('4');
  await page.reload();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('An image draft');
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('4');
  await expect(page.getByRole('button', { name: /^Create 4 images/ })).toBeEnabled();
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/jobs'),
  );
  await page.route('**/api/v1/jobs', (route) => route.fulfill({ status: 202, json: { jobs: [] } }));
  await page.getByRole('button', { name: /^Create 4 images/ }).click();
  const request = await sent;
  expect(request.headers()['x-seed-estimate']).toBeUndefined();
  expect(request.postDataJSON()).toMatchObject({
    prompt: 'An image draft',
    count: 4,
    workflow: 'text-to-image',
  });
  expect(prices).toHaveLength(0);
});

test('a transport failure retries the same submission after workflow navigation', async ({
  page,
}) => {
  await page.route('**/api/v1/estimates', (route) =>
    route.fulfill({
      json: { id: 'quote', total: 0.01, expires_at: new Date(Date.now() + 600000).toISOString() },
    }),
  );
  const requests: { key: string; body: unknown }[] = [];
  await page.route('**/api/v1/jobs', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { items: [] } });
    requests.push({
      key: route.request().headers()['idempotency-key']!,
      body: route.request().postDataJSON(),
    });
    return requests.length === 1
      ? route.abort('failed')
      : route.fulfill({ status: 202, json: { jobs: [] } });
  });
  await page.goto('/');
  await page.getByLabel('Prompt', { exact: true }).fill('A landscape');
  await page.getByRole('button', { name: /^Create image/ }).click();
  await expect(page.getByText(/Retrying will check the same submission/)).toBeVisible();
  await page.getByRole('button', { name: 'Text to video', exact: true }).click();
  await expect(page.getByText(/Retrying will check the same submission/)).toHaveCount(0);
  await page.getByLabel('Prompt', { exact: true }).fill('An unrelated video');
  await page.getByRole('button', { name: /^Create video/ }).click();
  await expect(page.getByRole('button', { name: /^Create video/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await page.getByRole('button', { name: /^Create image/ }).click();
  await expect(page.getByText(/Retrying will check the same submission/)).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(requests[2]).toEqual(requests[0]);
  expect(requests[1]!.key).not.toBe(requests[0]!.key);
});
