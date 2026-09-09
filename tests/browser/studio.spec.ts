import { test, expect } from '@playwright/test';

test('drafts survive reload and workflows expose their own controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('No pod connected')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('generate-desktop.png'), fullPage: true });
  await page.getByLabel('Prompt', { exact: false }).fill('An observatory above the clouds');
  await page.reload();
  await expect(page.getByLabel('Prompt', { exact: false })).toHaveValue('An observatory above the clouds');
  await page.getByLabel('Workflow').selectOption('text-to-video');
  await expect(page.getByLabel('Length')).toBeVisible();
  await page.getByLabel('Length').selectOption('15');
  await expect(page.getByRole('button', { name: 'Create video' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'NSFW' })).toBeDisabled();
  await page.getByLabel('Workflow').selectOption('image-to-image');
  await expect(page.getByRole('button', { name: 'NSFW' })).toHaveCount(0);
  await expect(page.getByText('Source image', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Library is ready.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your Library is ready.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile shell fits the viewport and navigation remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByLabel('Workflow')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('generate-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Library is ready.' })).toBeVisible();
});
