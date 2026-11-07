import { defineConfig } from '@playwright/test';

// Offline browser tests against one fixture backend (fake GPUs, no outside network).
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://127.0.0.1:4311', headless: true },
  workers: 1,
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
