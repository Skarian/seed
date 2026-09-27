import { test, expect, type APIRequestContext, type Page } from "./fixtures.js";
import { mkdir } from 'node:fs/promises';

test('worker controls remain reachable on narrow and short screens', async ({page, request}) => {
  await mkdir('.local/worker-pool-atlas/targeted', {recursive:true});
  for (const [width,height] of [[320,568],[844,390]]) {
    await reset(request);
    await page.setViewportSize({width:width!,height:height!});
    await page.goto('/');
    await open(page,true);
    const dialog=page.getByRole('dialog',{name:'GPU workers',exact:true});
    await expect(page.locator('.pool-offer').first()).toBeVisible();
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:`.local/worker-pool-atlas/targeted/${width}-offers.png`});
    await page.locator('.pool-offer input[type=checkbox]').last().check();
    await page.getByRole('button',{name:/^Start 1 worker/}).click();
    await expect(page.locator('.pool-worker .worker-state')).toHaveText('Ready',{timeout:15000});
    const quit=page.getByRole('button',{name:'Cancel jobs and quit now',exact:true});
    await quit.scrollIntoViewIfNeeded();
    await page.screenshot({path:`.local/worker-pool-atlas/targeted/${width}-quit.png`});
    await quit.click();
    const confirmation = page.getByRole('dialog', {name: 'Quit this worker now?', exact: true});
    expect(await confirmation.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await expect.poll(() => confirmation.evaluate(el => {
      const title = el.querySelector('h2:not(.sr-only)')!.getBoundingClientRect();
      const top = document.elementFromPoint(title.x + title.width / 2, title.y + title.height / 2);
      return el.contains(top) ? 'uncovered' : top?.className;
    })).toBe('uncovered');
    await page.screenshot({path:`.local/worker-pool-atlas/targeted/${width}-confirmation.png`});
    await confirmation.getByRole('button', {name: 'Quit now', exact: true}).click();
    await expect.poll(async()=>(await snapshot(request)).summary.active).toBe(0);
    await page.keyboard.press('Escape');
  }
});

test.use({ extraHTTPHeaders: { Origin: "http://127.0.0.1:4311" } });

async function configure(request: APIRequestContext, scenario: string) {
  expect(
    (await request.post("/__qa/scenario", { data: { scenario } })).ok(),
  ).toBeTruthy();
}
async function snapshot(request: APIRequestContext) {
  return (await request.get("/api/v1/pool")).json();
}
async function reset(request: APIRequestContext) {
  await configure(request, "normal");
  const jobs = await (await request.get("/api/v1/jobs")).json();
  for (const job of jobs.items ?? [])
    if (!["completed", "failed", "cancelled"].includes(job.state))
      await request.post("/api/v1/jobs/" + job.id + "/cancel", { data: {} });
  await request.post("/api/v1/pool/actions", { data: { action: "quit" } });
  await expect
    .poll(async () => (await snapshot(request)).summary.active)
    .toBe(0);
  for (const id of ["vastApiKey", "runpodApiKey"])
    await request.patch("/api/v1/admin/credentials/" + id, {
      data: { value: "offline-fixture" },
    });
}
async function open(page: Page, add = false) {
  if (
    !(await page
      .getByRole("button", { name: "GPU workers", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Toggle sidebar", exact: true })
      .click();
  await page.getByRole("button", { name: "GPU workers", exact: true }).click();
  if (add)
    await page
      .getByRole("button", { name: "Add workers", exact: true })
      .click();
}
async function startOne(page: Page) {
  await open(page, true);
  await page.locator(".pool-offer input[type=checkbox]").last().check();
  await page
    .getByRole("button", { name: "Start 1 worker", exact: false })
    .click();
  await expect(page.locator(".pool-worker")).toHaveCount(1);
}
test.beforeEach(async ({ request }) => reset(request));
test.afterEach(async ({ request }) => reset(request));

const shutdownCases = [
  { scope: 'single', action: 'finish', trigger: 'Finish jobs and quit', title: 'Finish jobs and quit?', confirm: 'Finish and quit' },
  { scope: 'single', action: 'quit', trigger: 'Cancel jobs and quit now', title: 'Quit this worker now?', confirm: 'Quit now' },
  { scope: 'all', action: 'finish', trigger: 'Finish jobs and quit all', title: 'Finish jobs and quit all?', confirm: 'Finish and quit all' },
  { scope: 'all', action: 'quit', trigger: 'Cancel jobs and quit all now', title: 'Quit all workers now?', confirm: 'Quit all now' },
] as const;

for (const width of [390, 1280]) for (const scenario of shutdownCases) {
  test(`${width}px ${scenario.scope} ${scenario.action} requires confirmation`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    await open(page, true);
    await page.getByRole('button', {name: 'RunPod', exact: true}).click();
    await page.locator('.pool-offer input[type=checkbox]').last().check();
    if (scenario.scope === 'all') await page.getByLabel(/Quantity for .*RunPod/).selectOption('2');
    await page.getByRole('button', {name: /^Start \d+ workers?/}).click();
    const count = scenario.scope === 'all' ? 2 : 1;
    await expect(page.locator('.pool-worker .worker-state')).toHaveText(Array(count).fill('Ready'));
    const workers = (await snapshot(request)).workers.filter((worker: any) => worker.state !== 'released');
    const calls: {path: string; action: string}[] = [];
    page.on('request', req => {
      if (req.method() === 'POST' && /\/pool\/(workers\/[^/]+\/)?actions$/.test(req.url())) {
        calls.push({path: new URL(req.url()).pathname, action: req.postDataJSON().action});
      }
    });
    const trigger = page.getByRole('button', {name: scenario.trigger, exact: true});
    const modal = page.getByRole('dialog', {name: scenario.title, exact: true});
    await trigger.click();
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Cancel', exact: true})).toBeFocused();
    await modal.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(calls).toEqual([]);
    expect((await snapshot(request)).summary.active).toBe(count);
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByRole('dialog', {name: 'GPU workers', exact: true})).toBeVisible();
    expect(calls).toEqual([]);
    await trigger.click();
    await expect(modal).toContainText(scenario.scope === 'all' ? 'all 2 workers' : workers[0].gpu);
    await expect(modal).toContainText('disk');
    expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const bounds = await modal.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({path: testInfo.outputPath('confirmation.png')});
    await modal.getByRole('button', {name: scenario.confirm, exact: true}).click();
    await expect(modal).toHaveCount(0);
    expect(calls).toEqual([{
      path: scenario.scope === 'all' ? '/api/v1/pool/actions' : `/api/v1/pool/workers/${workers[0].id}/actions`,
      action: scenario.action,
    }]);
    await expect.poll(async () => (await snapshot(request)).summary.active).toBe(0);
  });
}

test('shutdown errors stay in the confirmation and pending actions cannot be submitted twice', async ({page, request}, testInfo) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');
  await startOne(page);
  await expect(page.locator('.pool-worker .worker-state')).toHaveText('Ready');
  let attempts = 0;
  let respond!: () => void;
  const held = new Promise<void>(resolve => { respond = resolve; });
  await page.route('**/api/v1/pool/workers/*/actions', async route => {
    attempts++;
    if (attempts === 1) {
      await held;
      await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: {message: 'Provider unavailable. Worker is still running; try again.'}})});
    } else await route.continue();
  });
  await page.getByRole('button', {name: 'Cancel jobs and quit now', exact: true}).click();
  const modal = page.getByRole('dialog', {name: 'Quit this worker now?', exact: true});
  await modal.getByRole('button', {name: 'Quit now', exact: true}).click();
  await expect(modal.getByRole('button', {name: 'Working…', exact: true})).toBeDisabled();
  await expect(modal.getByRole('button', {name: 'Cancel', exact: true})).toBeDisabled();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  expect(attempts).toBe(1);
  respond();
  await expect(modal.getByRole('alert')).toContainText('Provider unavailable');
  expect((await snapshot(request)).summary.active).toBe(1);
  await page.screenshot({path: testInfo.outputPath('confirmation-error.png')});
  await modal.getByRole('button', {name: 'Quit now', exact: true}).click();
  await expect(modal).toHaveCount(0);
  expect(attempts).toBe(2);
  await expect.poll(async () => (await snapshot(request)).summary.active).toBe(0);
});

for (const scenario of ['acquiring', 'preparing', 'base_failure']) {
  test(`${scenario} workers also require confirmation before quitting`, async ({page, request}) => {
    await configure(request, scenario);
    await page.goto('/');
    await startOne(page);
    const trigger = page.getByRole('button', {name: 'Cancel jobs and quit now', exact: true});
    await trigger.click();
    const modal = page.getByRole('dialog', {name: 'Quit this worker now?', exact: true});
    await modal.getByRole('button', {name: 'Cancel', exact: true}).click();
    expect((await snapshot(request)).summary.active).toBe(1);
    await trigger.click();
    await modal.getByRole('button', {name: 'Quit now', exact: true}).click();
    await expect.poll(async () => (await snapshot(request)).summary.active).toBe(0);
  });
}

test("tablet launches from both providers, survives reload and releases explicitly", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto("/");
  await open(page, true);
  await page.locator(".pool-offer input[type=checkbox]").first().check();
  await page.getByRole('button', {name: 'RunPod', exact: true}).click();
  await page.locator(".pool-offer input[type=checkbox]").last().check();
  await page.getByLabel(/Quantity for .*RunPod/).selectOption("2");
  await expect(page.locator(".pool-launch-footer")).toContainText(
    "$3.40/hr added",
  );
  await page
    .getByRole("button", { name: "Start 3 workers", exact: false })
    .click();
  await expect(page.locator(".pool-worker")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.reload();
  await open(page);
  await expect(page.locator(".pool-worker")).toHaveCount(3);
  expect((await snapshot(request)).summary.active).toBe(3);
  await page
    .getByRole("button", { name: "Cancel jobs and quit all now", exact: true })
    .click();
  await page.getByRole('dialog', {name: 'Quit all workers now?', exact: true}).getByRole('button', {name: 'Quit all now', exact: true}).click();
  await expect(page.locator(".pool-worker")).toHaveCount(0);
  await expect
    .poll(async () => (await snapshot(request)).summary.active)
    .toBe(0);
});

test("optional adapter recovery supports retry and continuing without it", async ({
  page,
  request,
}) => {
  await configure(request, "lora_failure");
  await page.goto("/");
  await startOne(page);
  await expect(
    page.getByText("Some LoRAs could not be prepared"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry preparation", exact: true })
    .click();
  await expect(page.locator(".pool-worker .worker-state")).toHaveText("Ready");
  await page
    .getByRole("button", { name: "Cancel jobs and quit all now", exact: true })
    .click();
  await page.getByRole('dialog', {name: 'Quit all workers now?', exact: true}).getByRole('button', {name: 'Quit all now', exact: true}).click();
  await expect
    .poll(async () => (await snapshot(request)).summary.active)
    .toBe(0);
  await page.getByRole("button", { name: "Close GPU workers" }).click();
  await configure(request, "lora_failure");
  await startOne(page);
  await expect(
    page.getByText("Some LoRAs could not be prepared"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue without this LoRA", exact: true })
    .click();
  await expect(page.locator(".pool-worker .worker-state")).toHaveText("Ready");
  expect(
    (await snapshot(request)).workers.find(
      (worker: any) => worker.state === "ready",
    ).installed_loras,
  ).toHaveLength(0);
});

test("credentials round trip preserves both offer selection and the generation draft", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("Prompt", { exact: true }).fill("Keep this lake draft");
  await open(page, true);
  await page.locator(".pool-offer input[type=checkbox]").first().check();
  await request.patch("/api/v1/admin/credentials/runpodApiKey", {
    data: { value: null },
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole('button', {name: 'RunPod', exact: true}).click();
  await page
    .getByRole("button", { name: "Open Credentials", exact: true })
    .click();
  const credential = page.locator(".credential-card").filter({
    has: page.getByRole("heading", { name: "RunPod", exact: true }),
  });
  await credential.getByLabel("RunPod API key").fill("offline-fixture");
  await credential
    .getByRole("button", { name: "Save key", exact: true })
    .click();
  await expect(credential).toContainText("Key saved.");
  await page.getByRole("button", { name: /^Return to workers/ }).click();
  await expect(
    page.getByRole("button", { name: "Start 1 worker", exact: false }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close GPU workers" }).click();
  await page.goto("/");
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Keep this lake draft",
  );
});

test("finish jobs and quit saves the active result before releasing the worker", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await startOne(page);
  await expect(page.locator(".pool-worker .worker-state")).toHaveText("Ready");
  await page.getByRole("button", { name: "Close GPU workers" }).click();
  await configure(request, "generating");
  await page.getByLabel("Prompt", { exact: true }).fill("A lake at sunrise");
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/jobs") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Create image/ }).click();
  const id = (await (await accepted).json()).jobs[0].id;
  await expect
    .poll(
      async () =>
        (await snapshot(request)).workers.some(
          (worker: any) => worker.state === "generating",
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await open(page);
  await page
    .getByRole("button", { name: "Finish jobs and quit", exact: true })
    .click();
  await page.getByRole('dialog', {name: 'Finish jobs and quit?', exact: true}).getByRole('button', {name: 'Finish and quit', exact: true}).click();
  await expect(page.locator(".pool-worker .worker-state")).toHaveText(
    "Finishing",
  );
  await configure(request, "normal");
  await expect
    .poll(async () => (await snapshot(request)).summary.active, {
      timeout: 15000,
    })
    .toBe(0);
  const jobs = await (await request.get("/api/v1/jobs")).json();
  expect(jobs.items.find((job: any) => job.id === id)).toMatchObject({
    state: "completed",
    outputs: [expect.any(String)],
  });
});

test("failed base model offers the PC fallback and resumes preparation", async ({
  page,
  request,
}) => {
  await configure(request, "base_failure");
  await page.goto("/");
  await startOne(page);
  await expect(
    page.getByText(
      "Use this PC to download missing base models and transfer them to this worker. Adapters still download directly.",
    ),
  ).toBeVisible();
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/actions"),
  );
  await page
    .getByRole("button", { name: "Download through this PC", exact: true })
    .click();
  const response = await accepted;
  expect(response.ok(), JSON.stringify(await response.json())).toBe(true);
  await expect(page.locator(".pool-worker .worker-state")).toHaveText("Ready");
  const audit = await (await request.get("/__qa/status")).json();
  expect(
    audit.audit.filter((event: any) => event.kind === "local_fallback"),
  ).toHaveLength(1);
});

test("video worker output opens in preview and saves a picked frame", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await open(page, true);
  await page.getByRole("button", { name: /Video worker H3/ }).click();
  await page.locator(".pool-offer input[type=checkbox]").last().check();
  await page
    .getByRole("button", { name: "Start 1 worker", exact: false })
    .click();
  await expect(page.locator(".pool-worker .worker-state")).toHaveText("Ready");
  await page.getByRole("button", { name: "Close GPU workers" }).click();
  await page
    .getByRole("button", { name: "Text to video", exact: true })
    .click();
  await page
    .getByLabel("Prompt", { exact: true })
    .fill("A quiet mountain lake with birdsong");
  await page.getByRole("button", { name: /^Create video/ }).click();
  await expect(
    page.locator(".generation-thumbnails button").first(),
  ).toBeVisible({ timeout: 15000 });
  await page.locator(".generation-thumbnails button").first().click();
  await page.getByRole("button", { name: "Pick Frame", exact: true }).click();
  await page.getByRole("button", { name: "Save frame", exact: true }).click();
  await expect(
    page.getByText("Saved to Library", { exact: true }),
  ).toBeVisible();
  const assets = await (await request.get("/api/v1/assets?mode=sfw")).json();
  expect(assets.items.some((asset: any) => asset.kind === "video")).toBe(true);
  expect(assets.items.some((asset: any) => asset.kind === "image")).toBe(true);
});
