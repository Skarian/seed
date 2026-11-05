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

/* ---------- Regression tests for recently fixed behaviour. State comes from the HTTP API; all text is synthetic. ---------- */

const BASE = 'http://127.0.0.1:4311';
const word = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6).padEnd(6, 'q');

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const response = await page.request.fetch(BASE + path, {
    method,
    headers: method === 'GET' ? {} : { Origin: BASE, 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' },
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw Error(`${method} ${path} -> ${response.status()}: ${JSON.stringify(body)}`);
  return body;
}

const imageWorkers = async (page: Page) =>
  ((await call(page, 'GET', '/api/v1/pool')).workers as any[]).filter(w => w.worker_class === 'image' && w.state !== 'released' && !w.quit_mode);

/** An image GPU that is ready and idle, rented through the API if none is running. */
async function ensureIdleImageGpu(page: Page) {
  if (!(await imageWorkers(page)).length) {
    const offers = await call(page, 'GET', '/api/v1/pool/offers?worker_class=image');
    const offer = offers.items.find((o: any) => o.available);
    await call(page, 'POST', '/api/v1/pool/launch', { selections: [{ offer_id: offer.id, quantity: 1 }], max_hourly: offer.hourly, idle_release_minutes: 15, max_minutes: 60 });
  }
  await expect.poll(async () => (await imageWorkers(page)).some(w => w.state === 'ready' && !w.current_job_id), { timeout: 60_000 }).toBe(true);
}

async function apiProject(page: Page): Promise<string> {
  return (await call(page, 'POST', '/api/v1/chats', { mode: 'sfw' })).id;
}

async function makeImages(page: Page, project: string, title: string, prompt: string, count = 1) {
  await call(page, 'POST', `/api/v1/chats/${project}/requests`, {
    request: { workflow: 'text-to-image', title, prompt, output: { aspect: '1:1', size: 'image-768' }, count, seed: 'random' },
    client_request_id: crypto.randomUUID(),
  });
}

const projectJobs = async (page: Page, project: string) => (await call(page, 'GET', `/api/v1/chats/${project}`)).jobs.filter(Boolean) as any[];

async function allCompleted(page: Page, project: string, count: number) {
  await expect.poll(async () => (await projectJobs(page, project)).filter(j => j.state === 'completed').length, { timeout: 90_000 }).toBe(count);
}

test('Library search matches every word in any order and shows the prompt excerpt', async ({ page }) => {
  await ensureIdleImageGpu(page);
  const a = word(), b = word(), project = await apiProject(page);
  await makeImages(page, project, 'Search heron', `A grey heron ${a} wading beside ${b} stone steps`);
  await makeImages(page, project, 'Search lantern', `A paper lantern ${a} over still water`);
  await allCompleted(page, project, 2);

  await page.goto('/library');
  await page.getByRole('searchbox', { name: 'Search the Library' }).fill(`${b} ${a}`);
  const results = page.getByRole('button', { name: /^Open / });
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveAccessibleName(/^Open Search heron/);
  await expect(page.getByText(new RegExp(`^Prompt: .*${a}.*${b}`))).toBeVisible();
});

test('Results by shot lists shots in story order, not the order they were made', async ({ page }) => {
  await ensureIdleImageGpu(page);
  const project = await apiProject(page);
  for (const [title, scene] of [['Shot 3: C', 'a bridge'], ['Shot 1: A', 'a field'], ['Shot 2: B', 'a road']] as const) {
    await makeImages(page, project, title, `Synthetic test frame of ${scene}`);
  }
  await allCompleted(page, project, 3);

  await page.goto(`/projects/${project}?view=results`);
  await page.getByRole('group', { name: 'Arrange' }).getByRole('button', { name: 'By shot' }).click();
  const rows = page.getByRole('region', { name: /^Shot \d+: / });
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll(els => els.map(e => e.getAttribute('aria-label')))).toEqual(['Shot 1: A', 'Shot 2: B', 'Shot 3: C']);
});

test('choosing a take for a shot is saved with the project and shown on the film board', async ({ page }) => {
  await ensureIdleImageGpu(page);
  const project = await apiProject(page);
  for (const [title, scene] of [['Shot 1: A', 'a field'], ['Shot 2: B', 'a road']] as const) {
    await makeImages(page, project, title, `Synthetic test frame of ${scene}`);
  }
  await allCompleted(page, project, 2);

  await page.goto(`/projects/${project}?view=results`);
  await page.getByRole('group', { name: 'Arrange' }).getByRole('button', { name: 'By shot' }).click();
  const board = page.getByRole('region', { name: 'The film, shot by shot' });
  await expect(board.getByRole('button', { name: /^Shot 2: B\. Made · nothing chosen/ })).toBeVisible();
  await page.getByRole('button', { name: 'Use Keyframe for Shot 2' }).click();
  await expect(board.getByRole('button', { name: /^Shot 2: B\. Keyframe chosen/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /is chosen for Shot 2/ })).toHaveAttribute('aria-pressed', 'true');
});

test('making a cancelled take again starts exactly one job', async ({ page }) => {
  await ensureIdleImageGpu(page);
  const project = await apiProject(page);
  // Hold jobs in "generating" so one of the batch can be cancelled before it finishes.
  await call(page, 'POST', '/__qa/scenario', { scenario: 'generating' });
  try {
    await makeImages(page, project, 'Cancel batch', 'Synthetic test frame of a quiet pier', 2);
    await expect.poll(async () => (await projectJobs(page, project)).length).toBe(2);
    const [, second] = await projectJobs(page, project);
    await call(page, 'POST', `/api/v1/jobs/${second.id}/cancel`, {});
    await expect.poll(async () => (await projectJobs(page, project)).find(j => j.id === second.id)?.state).toBe('cancelled');
  } finally {
    await call(page, 'POST', '/__qa/scenario', { scenario: 'normal' });
  }
  await allCompleted(page, project, 1);

  await page.goto(`/projects/${project}`);
  await page.getByRole('button', { name: 'Make that one again' }).click();
  const consent = page.getByRole('dialog', { name: /^This needs an? image GPU$/ });
  if (await consent.isVisible({ timeout: 3_000 }).catch(() => false)) await consent.getByRole('button', { name: /^Start GPU and / }).click();
  await expect.poll(async () => (await projectJobs(page, project)).length).toBe(3);
  await allCompleted(page, project, 2);
  // Nothing else arrives afterwards.
  await page.waitForTimeout(1_500);
  expect((await projectJobs(page, project)).length).toBe(3);
});

test('starting a video GPU does not release the idle image GPU unless asked', async ({ page }) => {
  await ensureIdleImageGpu(page);
  await page.goto('/gpus');
  await page.getByRole('button', { name: 'Start a video GPU' }).click();
  const sheet = page.getByRole('dialog', { name: 'Start a video GPU' });
  const release = sheet.getByRole('checkbox', { name: /^Release the idle image GPU when this starts/ });
  await expect(release).toBeVisible();
  await expect(release).not.toBeChecked();
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
});

test('the project options menu works from the keyboard', async ({ page }) => {
  const project = await apiProject(page);
  await page.goto(`/projects/${project}`);
  const button = page.getByRole('button', { name: 'Project options' });
  await button.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('the full-screen viewer follows the shots in order and answers the arrow keys and Escape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'keyboard test');
  await ensureIdleImageGpu(page);
  const project = await apiProject(page);
  for (const [title, scene] of [['Shot 2: B', 'a road'], ['Shot 1: A', 'a field']] as const) {
    await makeImages(page, project, title, `Synthetic test frame of ${scene}`);
  }
  await allCompleted(page, project, 2);
  await page.goto(`/projects/${project}?view=results`);
  await page.getByRole('group', { name: 'Arrange' }).getByRole('button', { name: 'By shot' }).click();
  await page.getByRole('button', { name: /^Open Shot 1: A/ }).click();
  await page.getByRole('button', { name: /^Open Shot 1: A.* full screen$/ }).click();
  const viewer = page.getByRole('dialog', { name: /^Shot 1: A/ });
  await expect(viewer).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: /^Shot 2: B/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^Shot 2: B/ })).toHaveCount(0);
});

test('the Library picker fits a phone screen and its Attach button is reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await newProject(page);
  await page.getByRole('button', { name: /Attach/ }).first().click();
  await page.getByRole('menuitem', { name: /Library/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const attach = dialog.getByRole('button', { name: /^Attach/ });
  const a = await attach.boundingBox();
  expect(a!.x + a!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
