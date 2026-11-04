import { defineConfig } from '@playwright/test';

// Realistic user tests: live chat through OpenRouter, fake GPU workers.
// Run with `npm run test:user`, which starts a fresh isolated server.
export default defineConfig({
  testDir: 'tests/user',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  retries: 0,
  // One shared backend; widths run in sequence.
  workers: 1,
  use: { baseURL: process.env.SEED_USER_TEST_URL ?? 'http://127.0.0.1:4312', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
