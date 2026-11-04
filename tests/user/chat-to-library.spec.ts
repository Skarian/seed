import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';

// Realistic user test: live Gemma chat through OpenRouter (server side), fake
// GPU workers. The browser itself may only reach the local Seed server.
// All messages are synthetic and contain no user content (AGENTS.md).
const test = base.extend({
  page: async ({ page }, use) => {
    const blocked: string[] = [];
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      if (['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
      blocked.push(target.origin);
      return route.abort('blockedbyclient');
    });
    await use(page);
    expect(blocked, 'Browser must not make outside requests').toEqual([]);
  },
});

// No slash command: Seed has to choose the kind of work itself.
const turns = [
  'I would like one still image of a red paper kite above a calm beach at sunrise. Before you prepare anything, ask me one short question about the style.',
  'A soft watercolor style, wide framing. Please prepare the image now.',
];

const projectId = (page: Page) => new URL(page.url()).pathname.match(/^\/projects\/([\w-]+)/)?.[1] ?? null;
async function project(request: APIRequestContext, id: string) {
  const response = await request.get('/api/v1/chats/' + id);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message to Seed', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send to Seed', exact: true }).click();
  await expect.poll(() => projectId(page)).toBeTruthy();
  // Wait for the live model to finish its turn.
  await expect.poll(async () => (await project(page.request, projectId(page)!)).activity, { timeout: 240_000, intervals: [1000] }).toBe('idle');
}

test('a multi-turn Gemma conversation becomes a plan, then results in the Library', async ({ page }, testInfo) => {
  await page.goto('/');
  // Phones open the project list; larger screens open the most recent project.
  if (testInfo.project.name === 'phone') await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).first().click();
  await expect(page.getByText('What are we making?', { exact: true })).toBeVisible();

  await send(page, turns[0]!);
  await expect(page.locator('.msg-seed').last()).not.toBeEmpty();
  await send(page, turns[1]!);

  // Seed chose the kind and prepared at least one titled draft in one plan.
  const id = projectId(page)!;
  await expect.poll(async () => (await project(page.request, id)).workflow, { timeout: 30_000 }).toBe('text-to-image');
  const plan = page.getByRole('region', { name: /^Plan, \d+ drafts?$/ });
  await expect(plan).toBeVisible({ timeout: 60_000 });
  expect(await plan.getByRole('checkbox', { name: /^Include / }).count()).toBeGreaterThan(0);

  // Make the whole plan. The first width consents to a fake cloud GPU; later widths reuse it.
  await page.getByRole('button', { name: /^Make (selected|anyway|as it is|this earlier version)$/ }).click();
  const consent = page.getByRole('dialog', { name: /^This needs an? (image|video) GPU$/ });
  await expect.poll(async () => await consent.isVisible() || (await project(page.request, id)).jobs?.length > 0, { timeout: 30_000 }).toBe(true);
  if (await consent.isVisible()) {
    await expect(consent.getByText(/Nothing is rented until you press Start/)).toBeVisible();
    await consent.getByRole('button', { name: /^Start GPU and make / }).click();
    await expect(consent).toHaveCount(0, { timeout: 30_000 });
  }

  // The fake worker completes the jobs and Seed saves their outputs.
  let outputs: string[] = [];
  await expect.poll(async () => {
    const jobs = (await project(page.request, id)).jobs ?? [];
    if (jobs.some((job: any) => ['failed', 'cancelled'].includes(job.state))) return 'failed';
    outputs = jobs.flatMap((job: any) => job.state === 'completed' ? job.outputs : []);
    return jobs.length && jobs.every((job: any) => job.state === 'completed') && outputs.length ? 'completed' : 'waiting';
  }, { timeout: 120_000, intervals: [1000] }).toBe('completed');
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible({ timeout: 20_000 });

  // The conversation never locked: the composer still takes a message.
  await expect(page.getByRole('textbox', { name: 'Message to Seed', exact: true })).toBeEditable();

  // Each saved output is in the Library and remembers the job that made it (metadata only).
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  for (const asset of outputs) {
    const item = await (await page.request.get('/api/v1/assets/' + asset)).json();
    expect(item.kind).toBe('image');
    expect(item.job_id).toBeTruthy();
  }
  await expect.poll(() => page.getByRole('button', { name: /^Open / }).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(outputs.length);
  testInfo.annotations.push({ type: 'outputs', description: String(outputs.length) });
});
