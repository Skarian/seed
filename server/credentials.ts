import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import password from '@inquirer/password';
import type { StudioPaths } from './storage.js';

export async function ensureRunpodKey(paths: StudioPaths, options: {
  interactive: boolean; env?: NodeJS.ProcessEnv; cwd?: string;
  prompt?: () => Promise<string>;
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
  let key = env.RUNPOD_API_KEY?.trim() || (typeof saved.runpodApiKey === 'string' ? saved.runpodApiKey.trim() : '');
  if (!key) {
    try { key = parseEnv(readFileSync(path.join(options.cwd ?? process.cwd(), '.env'), 'utf8')).RUNPOD_API_KEY?.trim() ?? ''; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read the local .env file. Check access before running setup.'); }
  }
  if (!key) {
    if (!options.interactive) throw new Error('RunPod API key is missing. Run seed setup in an interactive terminal, or set RUNPOD_API_KEY in your environment or local .env.');
    try {
      key = (await (options.prompt ?? (() => password({ message: 'RunPod API key (hidden):', mask: true, validate: value => value.trim() && !/\s/.test(value.trim()) ? true : 'Enter a non-empty API key without whitespace.' })))()).trim();
    } catch { throw new Error('Setup cancelled. No RunPod key was saved.'); }
  }
  if (!key || /\s/.test(key)) throw new Error('Enter a non-empty RunPod API key without whitespace.');
  if (key !== saved.runpodApiKey) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ ...saved, runpodApiKey: key }, null, 2), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } catch {
      rmSync(temporary, { force: true }); throw new Error('Could not save RunPod credentials in the seed config directory.');
    }
  }
}

export function webServerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Operator credentials belong to setup, not the long-running web process.
  return Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== 'RUNPOD_API_KEY'));
}
