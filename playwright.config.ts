import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  use: { baseURL: 'http://127.0.0.1:4311', headless: true },
  webServer: {
    command: 'node dist/server/main.js',
    url: 'http://127.0.0.1:4311/api/v1/health',
    reuseExistingServer: false,
    env: { STUDIO_PORT: '4311', STUDIO_DEV_ROOT: '.local/browser-tests' },
  },
});
