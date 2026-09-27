import { test, expect } from './fixtures.js';

test('imports explicitly mapped H3 files as one LoRA, announces acceptance, and tracks it in Activity', async ({
  page,
}) => {
  await page.goto('/admin?section=loras');
  await page.getByRole('button', { name: '+ Add LoRA', exact: true }).click();
  await page
    .getByLabel('Civitai URL', { exact: true })
    .fill('https://civitai.com/models/6?modelVersionId=11');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  const importer = page.getByRole('region', { name: 'Import LoRA' });
  await expect(importer.getByText('MiniMax H3', { exact: true })).toBeVisible();
  const alpha = importer.getByRole('combobox', {
    name: 'Workflow mapping for tone-a.safetensors',
    exact: true,
  });
  const beta = importer.getByRole('combobox', {
    name: 'Workflow mapping for tone-b.safetensors',
    exact: true,
  });
  await expect(alpha).toHaveValue('');
  await expect(beta).toHaveValue('');
  await expect(
    importer.getByRole('combobox', { name: 'Workflow mapping for readme.txt', exact: true }),
  ).toBeDisabled();
  await expect(importer.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await alpha.selectOption('fl');
  await beta.selectOption('ref');
  await importer
    .getByLabel('Description & usage guidance')
    .fill('Subtle tonal contrast for landscapes.');
  await page.screenshot({ path: '.local/lora-file-mapping-desktop.png', fullPage: true });
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/loras/import') && response.request().method() === 'POST',
  );
  await importer.getByRole('button', { name: 'Apply', exact: true }).click();
  expect((await accepted).status()).toBe(202);
  await expect(
    page.getByText('LoRA request submitted · Track it in Activity', { exact: true }),
  ).toBeVisible();
  await expect(importer).toHaveCount(0);
  await expect(page.locator('main progress')).toHaveCount(0);
  await page.getByRole('button', { name: /^Activity/ }).click();
  const activity = page.getByRole('region', { name: 'LoRA import: Tonal study' }).first();
  await expect(activity).toContainText('tone-a.safetensors');
  await expect(activity).toContainText('tone-b.safetensors');
  await expect(activity.getByText('Ready', { exact: true })).toHaveCount(3, { timeout: 10000 });
  await page.screenshot({ path: '.local/lora-activity-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Close activity', exact: true }).click();
  const card = page
    .locator('.admin-lora-card')
    .filter({ has: page.getByRole('heading', { name: 'Tonal study v2' }) });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Text / frame-guided video');
  await expect(card).toContainText('Reference video');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    card.getByRole('combobox', { name: 'Workflow mapping for tone-a.safetensors', exact: true }),
  ).toHaveValue('fl');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/lora-file-mapping-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Text to video', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Tonal study v2', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Reference to video', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Tonal study v2', exact: true })).toHaveCount(1);
});

test('rejects unsupported model families before presenting mapping controls', async ({ page }) => {
  await page.goto('/admin?section=loras');
  await page.getByRole('button', { name: '+ Add LoRA', exact: true }).click();
  await page
    .getByLabel('Civitai URL', { exact: true })
    .fill('https://civitai.com/models/7?modelVersionId=13');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  const importer = page.getByRole('region', { name: 'Import LoRA' });
  await expect(importer.getByRole('alert')).toContainText('not supported');
  await expect(importer.getByRole('group', { name: 'File workflow mappings' })).toHaveCount(0);
  await expect(importer.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
});

test('import progress and retry live in Activity while Admin stays a catalog', async ({ page }) => {
  let failed = false,
    retried = false;
  const job = () => ({
    id: 'fixture-import',
    name: 'Recovery study',
    state: failed ? 'failed' : 'downloading',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    error: failed ? 'The Civitai download failed. Check your credentials and retry.' : undefined,
    files: [
      {
        name: 'weights.safetensors',
        route: 'ref',
        state: failed ? 'failed' : 'downloading',
        bytes: 5 * 1024 ** 2,
        total: 10 * 1024 ** 2,
      },
    ],
  });
  await page.route('**/api/v1/lora-imports?*', (route) =>
    route.fulfill({ json: { items: [job()] } }),
  );
  await page.route('**/api/v1/lora-imports/fixture-import/retry', (route) => {
    retried = true;
    failed = false;
    return route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto('/admin?section=loras');
  await expect(page.locator('main progress')).toHaveCount(0);
  await expect(page.getByText('Recovery study', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Activity/ }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Downloading weights.safetensors' }),
  ).toHaveAttribute('value', String(5 * 1024 ** 2));
  failed = true;
  await expect(page.getByText('The Civitai download failed. Check your credentials and retry.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry import', exact: true }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Downloading weights.safetensors' }),
  ).toBeVisible();
  expect(retried).toBe(true);
});
