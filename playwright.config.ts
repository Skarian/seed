import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  testIgnore: process.env.SEED_VISUAL_ATLAS === '1' ? undefined : '**/worker-pool-atlas.spec.ts',
  use: { baseURL: 'http://127.0.0.1:4311', headless: true },
  // The fixture intentionally exercises one real, persistent application backend.
  workers: 1,
});
