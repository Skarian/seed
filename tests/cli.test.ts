import { test, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:net';
import {pathToFileURL} from 'node:url';
const exec = promisify(execFile);

test('CLI setup, concurrent start, authenticated stop, restart and data preservation', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/cli-'));
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const env: NodeJS.ProcessEnv = { ...process.env, STUDIO_DEV_ROOT: root, APPDATA: path.join(root, 'fake Windows profile') };
  delete env.STUDIO_PORT; delete env.SEED_MANAGED;
  const run = (...args: string[]) => exec(process.execPath, ['dist/server/cli.js', ...args], { env, timeout: 15000 });
  try {
    await run('setup', '--port', String(port));
    const original = path.join(root, 'data/media/originals/keep.txt'); writeFileSync(original, 'unique media');
    const starts = await Promise.all([run('start'), run('start')]);
    expect(starts[0].stdout).toContain(`http://127.0.0.1:${port}`);
    const before = JSON.parse(readFileSync(path.join(root, 'config/running.json'), 'utf8'));
    await run('start');
    expect(JSON.parse(readFileSync(path.join(root, 'config/running.json'), 'utf8')).pid).toBe(before.pid);
    expect((await fetch(`http://127.0.0.1:${before.port}/stop`, { method: 'POST' })).status).toBe(403);
    expect((await run('status')).stdout).toContain('Running:');
    await run('stop'); await run('stop');
    expect((await run('status')).stdout).toContain('stopped');
    const settingsFile = path.join(root, 'config/settings.json');
    const remoteSettings = {...JSON.parse(readFileSync(settingsFile, 'utf8')), publicOrigin: 'https://seed.example.com'};
    writeFileSync(settingsFile, JSON.stringify(remoteSettings));
    await run('setup');
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual(remoteSettings);
    await run('start'); expect(readFileSync(original, 'utf8')).toBe('unique media');
    await run('stop');
    expect(readFileSync(original, 'utf8')).toBe('unique media');
  } finally { await run('stop'); }
}, 45000);
