import { test, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { prepareStorage, resolvePaths } from '../server/storage.js';
import { ensureCredentials, webServerEnvironment } from '../server/credentials.js';
function fixture() {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/credentials-'));
  const paths = resolvePaths(root); prepareStorage(paths);
  return { root, paths, file: path.join(paths.config, 'credentials.json') };
}
test('requires RunPod and HF, allows skipping Civitai, and preserves credentials on rerun', async () => {
  const { root, paths, file } = fixture();
  const prompt = vi.fn().mockResolvedValueOnce('fixture-runpod').mockResolvedValueOnce('fixture-hf').mockResolvedValueOnce('');
  const result = await ensureCredentials(paths, { interactive: true, env: {}, cwd: root, prompt });
  expect(prompt).toHaveBeenCalledTimes(3);
  expect(result.civitaiConfigured).toBe(false);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ runpodApiKey: 'fixture-runpod', huggingFaceToken: 'fixture-hf' });
  await ensureCredentials(paths, { interactive: false, env: {}, cwd: path.join(root, 'elsewhere'), prompt });
  expect(prompt).toHaveBeenCalledTimes(3);
  expect(existsSync(path.join(root, '.env'))).toBe(false);
});
test('imports supported credentials without modifying dotenv; explicit environment rotates a key', async () => {
  const { root, paths, file } = fixture();
  const source = 'RUNPOD_API_KEY=fixture-rp\nHF_TOKEN=fixture-hf\nCIVITAI_API_TOKEN=fixture-civitai\nUNRELATED_SECRET=not-copied\n';
  writeFileSync(path.join(root, '.env'), source);
  const result = await ensureCredentials(paths, { interactive: false, env: {}, cwd: root });
  expect(result.civitaiConfigured).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ runpodApiKey: 'fixture-rp', huggingFaceToken: 'fixture-hf', civitaiApiToken: 'fixture-civitai' });
  expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe(source);
  await ensureCredentials(paths, { interactive: false, env: { HF_TOKEN: 'fixture-new-hf' }, cwd: root });
  expect(JSON.parse(readFileSync(file, 'utf8')).huggingFaceToken).toBe('fixture-new-hf');
});
test('old RunPod-only config prompts for HF and optional Civitai without asking for RunPod again', async () => {
  const { root, paths, file } = fixture(); writeFileSync(file, JSON.stringify({ runpodApiKey: 'fixture-existing' }));
  const prompt = vi.fn().mockResolvedValueOnce('fixture-hf').mockResolvedValueOnce('fixture-civitai');
  await ensureCredentials(paths, { interactive: true, env: {}, cwd: root, prompt });
  expect(prompt.mock.calls.map(call => call[1])).toEqual([true, false]);
  expect(prompt.mock.calls[0]![0]).toContain('Hugging Face');
  expect(JSON.parse(readFileSync(file, 'utf8')).runpodApiKey).toBe('fixture-existing');
});
test('unattended missing HF fails and cancelling does not erase earlier credentials', async () => {
  const { root, paths, file } = fixture();
  await expect(ensureCredentials(paths, { interactive: false, env: { RUNPOD_API_KEY: 'fixture-rp' }, cwd: root })).rejects.toThrow('Hugging Face');
  await expect(ensureCredentials(paths, { interactive: true, env: {}, cwd: root, prompt: async () => { throw new Error('cancel'); } })).rejects.toThrow('Setup cancelled');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ runpodApiKey: 'fixture-rp' });
});
test('malformed config is preserved and all setup credentials are omitted from web environment', async () => {
  const { root, paths, file } = fixture(); writeFileSync(file, 'broken-json');
  await expect(ensureCredentials(paths, { interactive: false, env: {}, cwd: root })).rejects.toThrow('Cannot read seed credentials');
  expect(readFileSync(file, 'utf8')).toBe('broken-json');
  expect(webServerEnvironment({ RUNPOD_API_KEY: 'fixture', hf_token: 'fixture', CIVITAI_API_TOKEN: 'fixture', VAST_API_KEY: 'fixture', PATH: 'keep' })).toEqual({ PATH: 'keep' });
});


test('Vast onboarding collects only Vast, HF and optional Civitai, then switches without losing keys', async () => {
  const { root, paths, file } = fixture();
  const prompt = vi.fn().mockResolvedValueOnce('fixture-vast').mockResolvedValueOnce('fixture-hf').mockResolvedValueOnce('');
  await ensureCredentials(paths, { provider: 'vast', interactive: true, env: {}, cwd: root, prompt });
  expect(prompt.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['Vast API key']));
  expect(prompt.mock.calls.some(call => call[0].includes('RunPod'))).toBe(false);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ vastApiKey: 'fixture-vast', huggingFaceToken: 'fixture-hf' });
  await ensureCredentials(paths, { provider: 'runpod', interactive: false, env: { RUNPOD_API_KEY: 'fixture-rp' }, cwd: root });
  await ensureCredentials(paths, { provider: 'vast', interactive: false, env: {}, cwd: root });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ vastApiKey: 'fixture-vast', runpodApiKey: 'fixture-rp', huggingFaceToken: 'fixture-hf' });
});
