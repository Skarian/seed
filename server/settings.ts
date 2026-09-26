import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { StudioPaths } from './storage.js';
export type Settings = { host: string; port: number; publicOrigin?: string | null };
export function settings(paths: StudioPaths): Settings {
  try { return { host: '127.0.0.1', port: 4310, ...JSON.parse(readFileSync(path.join(paths.config, 'settings.json'), 'utf8')) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { host: '127.0.0.1', port: 4310 }; throw new Error('Cannot read seed settings; repair settings.json before continuing.'); }
}
export function saveSettings(paths: StudioPaths, value: Settings) {
  const file = path.join(paths.config, 'settings.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2)); renameSync(`${file}.tmp`, file);
}
