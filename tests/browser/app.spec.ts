import { test, expect, type Page } from '@playwright/test';

// Offline app tests: fake GPU providers and workers, no outside network, no chat model.
// Everything typed here is synthetic (AGENTS.md).

async function newProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await expect(page.getByText('What are we making?', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[\w-]+/);
}

test('every destination is one tap away and shows the status control', async ({ page }, info) => {
  await page.goto('/');
  for (const [name, heading] of [['Library', 'Library'], ['GPUs', 'GPUs'], ['Settings', 'Settings']] as const) {
    await page.getByRole('button', { name, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Activity and GPUs:/ })).toBeVisible();
  }
  if (info.project.name === 'phone') {
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  }
});

test('a direct make asks before renting, then results land in the project and the Library', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'Make now', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Prompt to make', exact: true });
  await prompt.fill('A paper lantern floating over a quiet harbor at dusk');
  // Enter never makes in Make mode.
  await prompt.press('Enter');
  await expect(page.getByRole('dialog', { name: /GPU$/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Make 1 image( from this prompt)?/ }).click();

  const consent = page.getByRole('dialog', { name: /^This needs an? (image|video) GPU$/ });
  if (await consent.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await expect(consent.getByText(/Nothing is rented until you press Start/)).toBeVisible();
    await expect(consent.getByRole('radio').first()).toBeVisible();
    await consent.getByRole('button', { name: /^Start GPU and make 1 image/ }).click();
  }
  const result = page.getByRole('button', { name: /^Open A paper lantern/ }).first();
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('textbox', { name: /Message to Seed|Prompt to make/ })).toBeEditable();

  // The result opens with its actions; favorite it.
  await result.click();
  const fav = page.getByRole('button', { name: 'Add to favorites' }).first();
  await expect(fav).toBeVisible();
  await fav.click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' }).first()).toBeVisible();
  // Crop a square copy on the device: no GPU, the copy lands in the Library.
  await page.getByRole('button', { name: 'More actions' }).last().click();
  await page.getByRole('menuitem', { name: /^Crop…/ }).click();
  const crop = page.getByRole('dialog', { name: /^Crop / });
  await crop.getByRole('button', { name: '1:1', exact: true }).click();
  await expect(crop.getByText(/^\d+ × \d+ from /)).toBeVisible();
  await crop.getByRole('button', { name: 'Save copy to Library' }).click();
  await expect(page.getByText('Saved a 1:1 copy to the Library')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Close/ }).first().click();

  // The Library finds it by its title.
  await page.goto('/library');
  await page.getByRole('searchbox', { name: 'Search the Library' }).fill('lantern');
  await expect(page.getByRole('button', { name: /^Open A paper lantern/ }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search the Library' }).fill('nothing-matches-this');
  await expect(page.getByText('Nothing matches')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible();
});

test('the GPU page shows the running rental, its rate and a release with stated consequences', async ({ page }) => {
  await page.goto('/gpus');
  await expect(page.getByRole('heading', { name: 'Cloud GPUs' })).toBeVisible();
  await expect(page.getByText(/Last 24 hours · estimated/)).toBeVisible();
  const release = page.getByRole('button', { name: 'Release…' }).first();
  if (await release.count()) {
    await release.click();
    await expect(page.getByRole('dialog', { name: /^Release the / })).toContainText('Billing stops when the provider confirms');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});

test('a GPU released from the Activity panel is actually released', async ({ page }) => {
  await page.goto('/gpus');
  await page.getByRole('button', { name: 'Start an image GPU' }).click();
  const sheet = page.getByRole('dialog', { name: /^Start an? image GPU$/ });
  await sheet.getByRole('button', { name: /^Start image GPU$/ }).click();
  await expect(sheet).toHaveCount(0, { timeout: 30_000 });
  const running = async () => (await (await page.request.get('/api/v1/pool')).json()).workers.filter((w: any) => w.state !== 'released' && !w.quit_mode).length;
  await expect.poll(running, { timeout: 30_000 }).toBeGreaterThan(0);
  const before = await running();

  await page.getByRole('button', { name: /^Activity and GPUs:/ }).click();
  const panel = page.getByRole('dialog', { name: 'Activity and GPUs' });
  await panel.getByRole('tab', { name: /^GPUs/ }).click();
  await panel.getByRole('button', { name: 'Release…' }).first().click();
  const confirm = page.getByRole('dialog', { name: /^Release the / });
  await confirm.getByRole('button', { name: /^(Release|Finish current work, then release)$/ }).click();
  await expect(confirm).toHaveCount(0);
  await expect.poll(running, { timeout: 30_000 }).toBe(before - 1);
});
