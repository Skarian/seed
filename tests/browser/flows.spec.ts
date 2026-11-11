import { test, expect, type Page } from '@playwright/test';

// Risky plan flows, driven through the scripted fake agent (scripts/offline-providers.mjs).
// Everything typed here is synthetic (AGENTS.md).

const BASE = 'http://127.0.0.1:4311';

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

/** Scripts the fake agent: what it drafts next, and how long each reply waits. */
const agent = (page: Page, mode: 'normal' | 'two_drafts' | 'revise', delay = 0) =>
  call(page, 'POST', '/__qa/scenario', { agent: mode, agent_delay_ms: delay });

test.afterEach(async ({ page }) => {
  await agent(page, 'normal');
});

const chat = (page: Page, id: string) => call(page, 'GET', `/api/v1/chats/${id}`);
const jobsOf = async (page: Page, id: string) => ((await chat(page, id)).jobs as any[]).filter(Boolean);
const userMessages = async (page: Page, id: string) => ((await chat(page, id)).messages as any[]).filter(m => m.role === 'user');

/** No cloud GPU is running or starting, so the next make asks for consent. */
async function releaseAllGpus(page: Page) {
  await call(page, 'POST', '/api/v1/pool/actions', { action: 'quit' });
  await expect
    .poll(async () => ((await call(page, 'GET', '/api/v1/pool')).workers as any[]).filter(w => w.state !== 'released').length, {
      timeout: 60_000,
    })
    .toBe(0);
}

async function openProject(page: Page) {
  const id: string = (await call(page, 'POST', '/api/v1/chats', { mode: 'sfw' })).id;
  await page.goto(`/projects/${id}`);
  await expect(page.getByText('What are we making?', { exact: true })).toBeVisible();
  return id;
}

async function sendToSeed(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message to Seed' });
  await box.click();
  await box.fill(text);
  await page.getByRole('button', { name: 'Send to Seed' }).click();
}

/** Leaves the message box, so a phone shows the make bar again. */
const leaveComposer = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** Asks Seed for a plan and waits until it can be made. */
async function plan(page: Page, text: string, drafts: number) {
  await sendToSeed(page, text);
  const card = page.getByRole('region', { name: `Plan, ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Stop reply' })).toHaveCount(0, { timeout: 30_000 });
  await leaveComposer(page);
  return card;
}

const consent = (page: Page) => page.getByRole('dialog', { name: /^This needs an? image GPU$/ });

/** Seed drafts "Lake at dawn" and "Lake at dusk". */
async function twoDrafts(page: Page) {
  await agent(page, 'two_drafts');
  const card = await plan(page, 'Two takes of a mountain lake, one at dawn and one at dusk', 2);
  await agent(page, 'normal');
  return card;
}

test('unticking a draft makes only the ticked one, and the other stays a draft to bring back', async ({ page }) => {
  await releaseAllGpus(page);
  const id = await openProject(page);
  const card = await twoDrafts(page);
  await card.getByRole('checkbox', { name: 'Include Lake at dusk' }).click();
  await expect(card.getByRole('checkbox', { name: 'Include Lake at dusk' })).not.toBeChecked();
  await page.getByRole('button', { name: /^Make 1 image$/ }).click();
  await expect(consent(page)).toBeVisible();
  await consent(page).getByRole('button', { name: /^Start GPU and make 1 image/ }).click();

  await expect.poll(async () => (await jobsOf(page, id)).map(j => j.state), { timeout: 90_000 }).toEqual(['completed']);
  const made = (await chat(page, id)).groups.flatMap((g: any) => g.cards.map((c: any) => [c.revisions.at(-1).request.title, c.revisions.at(-1).decision]));
  expect(made).toEqual([
    ['Lake at dawn', 'approved'],
    ['Lake at dusk', 'denied'],
  ]);
  await expect(page.getByText('Not run · kept as drafts:')).toBeVisible();

  await page.getByRole('button', { name: 'Bring back: Lake at dusk' }).click();
  const back = page.getByRole('region', { name: 'Plan, 1 draft' });
  await expect(back.getByRole('checkbox', { name: 'Include Lake at dusk' })).toBeChecked();
  expect((await jobsOf(page, id)).length).toBe(1);
});

test('a plan Seed revises while the GPU question is open is not made', async ({ page }) => {
  await releaseAllGpus(page);
  const id = await openProject(page);
  await twoDrafts(page);
  await page.getByRole('button', { name: /^Make 2 images$/ }).click();
  await expect(consent(page)).toBeVisible();

  // Seed revises the plan in the background (another tab, say) while the owner reads the GPU question.
  await agent(page, 'revise');
  const { version } = await chat(page, id);
  await call(page, 'POST', `/api/v1/chats/${id}/messages`, { version, text: 'Make the dawn lake calmer', assets: [] });
  await expect
    .poll(async () => {
      const c = await chat(page, id);
      return c.activity !== 'thinking' && c.activity !== 'preparing' && c.groups.at(-1).cards[0].revisions.length;
    }, { timeout: 30_000 })
    .toBe(2);
  // This page has the revision too (the plan shows the draft's history).
  await expect(page.locator('[aria-label="Earlier version of Lake at dawn"]')).toBeAttached();

  await consent(page).getByRole('button', { name: /^Start GPU and make 2 images/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Seed changed the plan while you were deciding' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  expect(await jobsOf(page, id)).toEqual([]);
  expect((await chat(page, id)).groups.at(-1).state).toBe('reviewing');
});

/** Sends one message, and while Seed's slow reply runs, queues a second one with Send next. */
async function queueDuringReply(page: Page, id: string, before: number) {
  await agent(page, 'normal', 4_000);
  await sendToSeed(page, 'A watercolor lake, please');
  const stop = page.getByRole('button', { name: 'Stop reply' });
  await expect(stop).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Message to Seed' });
  await box.click();
  await box.fill('Make it a little warmer');
  await page.getByRole('button', { name: 'Send next' }).click();
  await agent(page, 'normal');
  await expect(page.getByText('Your message below sends as soon as Seed finishes this reply.')).toBeVisible();
  expect((await userMessages(page, id)).length).toBe(before + 1);
  return { stop, box };
}

test('a message sent while Seed replies waits, then sends itself once', async ({ page }) => {
  const id = await openProject(page);
  // Seed has already chosen the kind of work.
  await plan(page, 'A first lake', 1);
  const { stop, box } = await queueDuringReply(page, id, 1);
  await expect.poll(async () => (await userMessages(page, id)).map(m => m.text), { timeout: 30_000 }).toEqual([
    'A first lake',
    'A watercolor lake, please',
    'Make it a little warmer',
  ]);
  await expect(page.getByText('Your message below sends as soon as Seed finishes this reply.')).toHaveCount(0);
  await expect(stop).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  expect((await userMessages(page, id)).length).toBe(3);
  await expect(box).toHaveValue('');
});

// Regression: in a project's first reply, choose_kind raises the project version mid-turn. The page used to take
// "reply ended" from the event stream before its debounced re-read landed, so the queued message sent against the old
// version and failed with "This project changed in another tab. Refresh and try again."
test('a message queued during a project\'s first reply sends itself once', async ({ page }) => {
  const id = await openProject(page);
  const { stop, box } = await queueDuringReply(page, id, 0);
  await expect.poll(async () => (await userMessages(page, id)).map(m => m.text), { timeout: 30_000 }).toEqual([
    'A watercolor lake, please',
    'Make it a little warmer',
  ]);
  await expect(page.getByText('Your message below sends as soon as Seed finishes this reply.')).toHaveCount(0);
  await expect(stop).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  expect((await userMessages(page, id)).length).toBe(2);
  await expect(box).toHaveValue('');
});

test('bringing back a kept draft while a plan is open sets that plan aside first', async ({ page }) => {
  const id = await openProject(page);
  const card = await twoDrafts(page);
  await card.getByRole('checkbox', { name: 'Include Lake at dusk' }).click();
  await page.getByRole('button', { name: /^Make 1 image$/ }).click();
  if (await consent(page).isVisible({ timeout: 5_000 }).catch(() => false))
    await consent(page).getByRole('button', { name: /^Start GPU and make 1 image/ }).click();
  await expect.poll(async () => (await jobsOf(page, id)).length, { timeout: 30_000 }).toBe(1);

  // A new plan opens; then the owner brings back the draft kept from the first one.
  await plan(page, 'Now a lake at noon', 1);
  const waiting = (await chat(page, id)).groups.at(-1).cards[0].revisions.at(-1).request.title as string;
  await page.getByRole('button', { name: 'Bring back: Lake at dusk' }).click();
  const ask = page.getByRole('dialog', { name: /^Keep “.+” for later\?$/ });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep them and continue' }).click();
  await expect(ask).toHaveCount(0);

  const back = page.getByRole('region', { name: 'Plan, 1 draft' });
  await expect(back.getByRole('checkbox', { name: 'Include Lake at dusk' })).toBeVisible();
  await expect(page.getByText('Make or stop the open plan first')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The plan that was waiting is kept as drafts, not made or deleted.
  const groups = (await chat(page, id)).groups as any[];
  const aside = groups.find(g => g.cards.some((c: any) => c.revisions.at(-1).request.title === waiting) && g.state !== 'reviewing');
  expect(aside.cards.map((c: any) => c.revisions.at(-1).decision)).toEqual(['denied']);
  expect(groups.at(-1).cards.map((c: any) => c.revisions.at(-1).request.title)).toEqual(['Lake at dusk']);
  expect((await jobsOf(page, id)).length).toBe(1);
});

test('closing the draft editor with changes asks first, and discarding leaves the draft as it was', async ({ page }) => {
  const id = await openProject(page);
  await twoDrafts(page);
  const before = (await chat(page, id)).groups.at(-1).cards[0].revisions;
  await page.getByRole('button', { name: 'Edit Lake at dawn' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Lake at dawn' });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Prompt' }).fill('A stormy sea at night');

  await editor.getByRole('button', { name: 'Close' }).click();
  const discard = editor.getByRole('alert').filter({ hasText: 'Discard your changes to this draft?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard changes' }).click();
  await expect(editor).toHaveCount(0);

  await expect(page.getByText('A stormy sea at night')).toHaveCount(0);
  expect((await chat(page, id)).groups.at(-1).cards[0].revisions).toEqual(before);
});
