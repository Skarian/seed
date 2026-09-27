import { test as base, expect } from './fixtures.js';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

// Each screenshot journey gets its own process, clock and profile. No reset API
// exists in production, and later scenarios cannot inherit earlier user data.
export const test = base.extend<{ isolatedAtlas: void }>({
  isolatedAtlas: [async ({}, use) => {
    await mkdir('.local', { recursive: true });
    const root = await mkdtemp(path.resolve('.local/atlas-case-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key)));
    const child = spawn(process.execPath, ['scripts/browser-server.mjs'], {
      windowsHide: true, env: { ...env, STUDIO_DEV_ROOT: root,
        ...(process.env.SEED_QA_WEB_ROOT?{SEED_QA_WEB_ROOT:process.env.SEED_QA_WEB_ROOT}:{}),
        ...(process.env.SEED_QA_SERVER_ROOT?{SEED_QA_SERVER_ROOT:process.env.SEED_QA_SERVER_ROOT}:{}) },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const closed = new Promise(resolve => child.once('exit', resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Atlas fixture startup timed out.')), 25000);
        child.once('message', () => { clearTimeout(timeout); resolve(); });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', () => { clearTimeout(timeout); reject(Error('Atlas fixture exited.')); });
      });
      await use();
      const audit = await (await fetch('http://127.0.0.1:4311/__qa/status')).json();
      expect(audit.external_calls).toBe(0);
      expect(audit.blocked_external_attempts).toEqual([]);
    } finally {
      if (child.connected) child.send('stop');
      await closed;
    }
  }, { auto: true }],
});
export { expect };
export type { Page, APIRequestContext } from './fixtures.js';
