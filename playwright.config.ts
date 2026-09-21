import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  use: { baseURL: 'http://127.0.0.1:4311', headless: true },
  workers: 2,
});
