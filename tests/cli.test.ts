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
  const env: NodeJS.ProcessEnv = { ...process.env, STUDIO_DEV_ROOT: root, RUNPOD_API_KEY: 'fixture-runpod-key', HF_TOKEN: 'fixture-hf-token', APPDATA: path.join(root, 'fake Windows profile') };
  const hook=path.join(root,'model-fixture.mjs');
  writeFileSync(hook, `import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,next){if(s==='./model-cache.js'&&c.parentURL?.endsWith('/cli.js')) return {url:'data:text/javascript,export async function prepareModels() {}',shortCircuit:true};return next(s,c);}});`);
  env.NODE_OPTIONS=`--import=${pathToFileURL(hook).href}`;
  delete env.STUDIO_PORT; delete env.STUDIO_PREVIEW_ADDRESS; delete env.SEED_MANAGED;
  const run = (...args: string[]) => exec(process.execPath, ['dist/server/cli.js', ...args], { env, timeout: 15000 });
  try {
    await run('setup', '--provider', 'runpod', '--port', String(port), '--no-startup');
    const original = path.join(root, 'data/media/originals/keep.txt'); writeFileSync(original, 'unique media');
    if (process.platform === 'win32') {
      await run('setup', '--startup'); await run('setup', '--startup');
      const startup = path.join(env.APPDATA!, 'Microsoft/Windows/Start Menu/Programs/Startup/seed.vbs');
      expect(existsSync(startup)).toBe(true);
      // Execute the actual generated entry, including the isolated profile path with spaces.
      await exec('cscript.exe', ['//Nologo', startup], { env, timeout: 15000 });
    }
    const starts = await Promise.all([run('start'), run('start')]);
    expect(starts[0].stdout).toContain(`http://127.0.0.1:${port}`);
    const before = JSON.parse(readFileSync(path.join(root, 'config/running.json'), 'utf8'));
    await run('start');
    expect(JSON.parse(readFileSync(path.join(root, 'config/running.json'), 'utf8')).pid).toBe(before.pid);
    expect((await fetch(`http://127.0.0.1:${before.port}/stop`, { method: 'POST' })).status).toBe(403);
    expect((await run('status')).stdout).toContain('Running:');
    await run('stop'); await run('stop');
    expect((await run('status')).stdout).toContain('stopped');
    await run('setup', '--no-startup');
    expect(existsSync(path.join(env.APPDATA!, 'Microsoft/Windows/Start Menu/Programs/Startup/seed.vbs'))).toBe(false);
    await run('start'); expect(readFileSync(original, 'utf8')).toBe('unique media');
    await run('stop');
    expect(readFileSync(original, 'utf8')).toBe('unique media');
  } finally { await run('stop'); }
}, 45000);



test('fresh Vast setup needs no RunPod key and remembers provider on rerun', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/cli-vast-'));
  const env: NodeJS.ProcessEnv = { ...process.env, STUDIO_DEV_ROOT: root, VAST_API_KEY: 'fixture-vast', HF_TOKEN: 'fixture-hf', APPDATA: path.join(root, 'profile') };
  const hook=path.join(root,'model-fixture.mjs');
  writeFileSync(hook, `import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,next){if(s==='./model-cache.js'&&c.parentURL?.endsWith('/cli.js')) return {url:'data:text/javascript,export async function prepareModels() {}',shortCircuit:true};return next(s,c);}});`);
  env.NODE_OPTIONS=`--import=${pathToFileURL(hook).href}`;
  delete env.RUNPOD_API_KEY;
  const run = (...args: string[]) => exec(process.execPath, ['dist/server/cli.js', ...args], { env, timeout: 15000 });
  const first = await run('setup', '--provider', 'vast', '--no-startup');
  expect(first.stdout).toContain('Vast and Hugging Face configured');
  expect(first.stdout).not.toContain('fixture-vast');
  expect((await run('setup', '--no-startup')).stdout).toContain('Vast and Hugging Face configured');
  expect(JSON.parse(readFileSync(path.join(root, 'config/credentials.json'), 'utf8')).runpodApiKey).toBeUndefined();
  await expect(run('setup', '--provider', 'unknown')).rejects.toThrow();
});
