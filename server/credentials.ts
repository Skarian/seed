import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import password from '@inquirer/password';
import type { StudioPaths } from './storage.js';
export type GpuProvider = 'vast' | 'runpod';
const providers = [
  { field: 'vastApiKey', env: 'VAST_API_KEY', label: 'Vast API key', required: true },
  { field: 'runpodApiKey', env: 'RUNPOD_API_KEY', label: 'RunPod API key', required: true },
  { field: 'huggingFaceToken', env: 'HF_TOKEN', label: 'Hugging Face token (base models and other HF assets)', required: true },
  { field: 'civitaiApiToken', env: 'CIVITAI_API_TOKEN', label: 'Civitai API token (optional; Enter to skip)', required: false },
] as const;
export async function ensureCredentials(paths: StudioPaths, options: {
  interactive: boolean; provider?: GpuProvider; env?: NodeJS.ProcessEnv; cwd?: string;
  prompt?: (label: string, required: boolean) => Promise<string>;
}) {
  const file = path.join(paths.config, 'credentials.json');
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read seed credentials.json; repair it before running setup.');
  }
  const env = options.env ?? process.env;
  let dotenv: Record<string, string | undefined> | undefined;
  for (const provider of providers) {
    const selected = options.provider ?? 'runpod';
    if ((provider.field === 'vastApiKey' && selected !== 'vast') || (provider.field === 'runpodApiKey' && selected !== 'runpod')) continue;
    let key = env[provider.env]?.trim() || (typeof saved[provider.field] === 'string' ? (saved[provider.field] as string).trim() : '');
    if (!key) {
      if (!dotenv) {
        try { dotenv = parseEnv(readFileSync(path.join(options.cwd ?? process.cwd(), '.env'), 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read the local .env file. Check access before running setup.'); dotenv = {}; }
      }
      key = dotenv?.[provider.env]?.trim() ?? '';
    }
    if (!key) {
      if (!options.interactive) {
        if (!provider.required) continue;
        throw new Error(`${provider.label} is missing. Run seed setup in an interactive terminal, or set ${provider.env} in your environment or local .env.`);
      }
      try {
        key = (await (options.prompt ? options.prompt(provider.label, provider.required) : password({ message: `${provider.label}:`, mask: true, validate: value => (!provider.required || Boolean(value.trim())) && !/\s/.test(value.trim()) ? true : 'Enter a token without whitespace.' }))).trim();
      } catch { throw new Error('Setup cancelled. Credentials entered earlier remain saved.'); }
    }
    if (!key && !provider.required) continue;
    if (!key || /\s/.test(key)) throw new Error(`Enter ${provider.label} without whitespace.`);
    if (key !== saved[provider.field]) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        saved[provider.field] = key;
        writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, file);
      } catch { rmSync(temporary, { force: true }); throw new Error('Could not save credentials in the seed config directory.'); }
    }
  }
  return { file, civitaiConfigured: Boolean(saved.civitaiApiToken) };
}
export function webServerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !providers.some(provider => provider.env === name.toUpperCase()) && !/^(TAILSCALE_|TS_)/i.test(name)));
}
