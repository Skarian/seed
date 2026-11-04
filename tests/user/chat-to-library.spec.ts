import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';

// Realistic user test: live Gemma chat through OpenRouter (server side), fake
// GPU workers. The browser itself may only reach the local Seed server.
// All messages are synthetic and contain no user content (AGENTS.md).
const test = base.extend({
  page: async ({ page }, use) => {
    const blocked: string[] = [];
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      if (['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.protocol === 'data:') return route.continue();
      blocked.push(target.origin);
      return route.abort('blockedbyclient');
    });
    await use(page);
    expect(blocked, 'Browser must not make outside requests').toEqual([]);
  },
});

const turns = [
  'I would like one still image of a red paper kite above a calm beach at sunrise. Before you prepare a request, ask me one short question about the style.',
  'A soft watercolor style, wide framing. Please prepare the image request now.',
];

// A new chat keeps the /chat URL, so read its id from the creation response.
const chatIds = new WeakMap<Page, string>();
function trackChat(page: Page) {
  page.on('response', async response => {
    const url = new URL(response.url());
    if (response.request().method() === 'POST' && url.pathname === '/api/v1/chats' && response.ok() && !chatIds.has(page))
      chatIds.set(page, (await response.json()).id);
  });
}
const chatId = (page: Page) => chatIds.get(page) ?? null;
async function chat(request: APIRequestContext, id: string) {
  const response = await request.get('/api/v1/chats/' + id);
  expect(response.ok()).toBe(true);
  return response.json();
}
// Choose the workflow as a user does: type its slash command and pick it.
async function chooseTextToImage(page: Page) {
  await page.getByRole('combobox', { name: 'Chat message', exact: true }).fill('/text-to-image');
  await page.getByRole('listbox', { name: 'Commands', exact: true }).getByRole('option', { name: /\/text-to-image/ }).click();
  await expect(page.getByRole('listbox', { name: 'Commands', exact: true })).toHaveCount(0);
}
async function send(page: Page, text: string, prefix = '') {
  await page.getByRole('combobox', { name: 'Chat message', exact: true }).fill(prefix + text);
  await page.locator('.composer-actions').getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => chatId(page), { timeout: 30_000 }).toBeTruthy();
  // Wait for the live model to finish its turn.
  await expect.poll(async () => (await chat(page.request, chatId(page)!)).activity, { timeout: 240_000, intervals: [1000] }).toBe('idle');
  await expect(page.locator('.composer-actions [role=alert]')).toHaveCount(0);
}

test('a multi-turn Gemma chat request reaches the Library', async ({ page }, testInfo) => {
  trackChat(page);
  await page.goto('/chat');
  await expect(page.getByText('What shall we create today?', { exact: true })).toBeVisible();

  await chooseTextToImage(page);
  await send(page, turns[0]!, '/text-to-image ');
  expect((await chat(page.request, chatId(page)!)).workflow).toBe('text-to-image');
  await expect(page.locator('.chat-message.assistant').last()).not.toBeEmpty();
  await send(page, turns[1]!);
  await expect(page.locator('.chat-message.assistant')).not.toHaveCount(0);

  // Gemma may prepare one or more requests; approve each pending card.
  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve.first()).toBeVisible({ timeout: 60_000 });
  const pending = await approve.count();
  for (let i = 0; i < pending; i++) {
    await approve.first().scrollIntoViewIfNeeded();
    await approve.first().click();
    await expect(approve).toHaveCount(pending - i - 1);
  }

  // The first width rents a fake cloud worker; later widths reuse it.
  const workers = page.getByRole('dialog', { name: 'GPU workers', exact: true });
  await expect.poll(async () => await workers.isVisible() || (await chat(page.request, chatId(page)!)).jobs?.length > 0, { timeout: 30_000 }).toBe(true);
  if (await workers.isVisible()) {
    const ready = workers.locator('.pool-worker .worker-state', { hasText: 'Ready' });
    if (!await ready.count()) {
      await workers.locator('.pool-offer input[type=checkbox]').last().check();
      await workers.getByRole('button', { name: /^Start 1 worker/ }).click();
      await expect(ready.first()).toBeVisible({ timeout: 60_000 });
    }
    await page.keyboard.press('Escape');
    await expect(workers).toHaveCount(0);
  }

  // The fake worker completes the job and Seed saves its output.
  const id = chatId(page)!;
  let outputs: string[] = [];
  await expect.poll(async () => {
    const jobs = (await chat(page.request, id)).jobs ?? [];
    if (jobs.some((job: any) => ['failed', 'cancelled'].includes(job.state))) return 'failed';
    outputs = jobs.flatMap((job: any) => job.state === 'completed' ? job.outputs : []);
    return jobs.length && jobs.every((job: any) => job.state === 'completed') && outputs.length ? 'completed' : 'waiting';
  }, { timeout: 120_000, intervals: [1000] }).toBe('completed');
  await expect(page.locator('.job-output-tile').first()).toBeVisible();

  // Find each saved output in the Library by its asset name (metadata only).
  await page.goto('/library');
  await expect(page.locator('.library-grid')).toBeVisible();
  for (const asset of outputs) {
    const item = await (await page.request.get('/api/v1/assets/' + asset)).json();
    expect(item.kind).toBe('image');
    await expect(page.locator('.library-grid').getByRole('button', { name: item.name, exact: true }).first()).toBeVisible();
  }
  testInfo.annotations.push({ type: 'outputs', description: String(outputs.length) });
});
