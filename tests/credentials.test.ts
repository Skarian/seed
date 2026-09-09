import { test, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { prepareStorage, resolvePaths } from '../server/storage.js';
import { ensureRunpodKey, webServerEnvironment } from '../server/credentials.js';
function fixture() {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/credentials-'));
  const paths = resolvePaths(root); prepareStorage(paths);
  return { root, paths, file: path.join(paths.config, 'credentials.json') };
}
test('missing credential prompts once and survives setup from another directory', async () => {
  const { root, paths, file } = fixture();
  const prompt = vi.fn(async () => ' fixture-runpod-key ');
  await ensureRunpodKey(paths, { interactive: true, env: {}, cwd: root, prompt });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ runpodApiKey: 'fixture-runpod-key' });
  await ensureRunpodKey(paths, { interactive: false, env: {}, cwd: path.join(root, 'other'), prompt });
  expect(prompt).toHaveBeenCalledTimes(1);
});
test('imports only the RunPod credential from dotenv and allows explicit environment rotation', async () => {
  const { root, paths, file } = fixture();
  writeFileSync(path.join(root, '.env'), 'RUNPOD_API_KEY="fixture-from-dotenv"\nUNRELATED_SECRET=do-not-copy\n');
  await ensureRunpodKey(paths, { interactive: false, env: {}, cwd: root });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ runpodApiKey: 'fixture-from-dotenv' });
  await ensureRunpodKey(paths, { interactive: false, env: { RUNPOD_API_KEY: 'fixture-rotated' }, cwd: root });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ runpodApiKey: 'fixture-rotated' });
});
test('missing noninteractive key and cancelled prompt do not save a credential', async () => {
  const { root, paths, file } = fixture();
  await expect(ensureRunpodKey(paths, { interactive: false, env: {}, cwd: root })).rejects.toThrow('RunPod API key is missing');
  await expect(ensureRunpodKey(paths, { interactive: true, env: {}, cwd: root, prompt: async () => { throw new Error('cancel'); } })).rejects.toThrow('Setup cancelled');
  expect(existsSync(file)).toBe(false);
});
test('malformed stored configuration is preserved and operator key is omitted from web process environment', async () => {
  const { root, paths, file } = fixture(); writeFileSync(file, 'broken-json');
  await expect(ensureRunpodKey(paths, { interactive: false, env: {}, cwd: root })).rejects.toThrow('Cannot read seed credentials');
  expect(readFileSync(file, 'utf8')).toBe('broken-json');
  expect(webServerEnvironment({ RUNPOD_API_KEY: 'fixture', runpod_api_key: 'fixture', PATH: 'keep' })).toEqual({ PATH: 'keep' });
});
