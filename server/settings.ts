import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { StudioPaths } from './storage.js';
export type Settings = { host: string; port: number; startup: boolean; provider?: 'vast' | 'runpod' };
export function settings(paths: StudioPaths): Settings {
  try { return { host: '127.0.0.1', port: 4310, startup: false, ...JSON.parse(readFileSync(path.join(paths.config, 'settings.json'), 'utf8')) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { host: '127.0.0.1', port: 4310, startup: false }; throw new Error('Cannot read seed settings; repair settings.json before continuing.'); }
}
export function saveSettings(paths: StudioPaths, value: Settings) {
  const file = path.join(paths.config, 'settings.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2)); renameSync(`${file}.tmp`, file);
}
export function windowsStartup(enabled: boolean, node: string, cli: string, appData = process.env.APPDATA!, developmentRoot = process.env.STUDIO_DEV_ROOT) {
  if (!appData) throw new Error('Windows APPDATA is unavailable.');
  const folder = path.join(appData, 'Microsoft/Windows/Start Menu/Programs/Startup');
  const file = path.join(folder, 'seed.vbs');
  if (!enabled) { rmSync(file, { force: true }); return file; }
  const literal = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  // WScript.Run invokes Node directly, not cmd.exe. Quote paths including spaces.
  const command = `"${node}" "${cli}" start --quiet`;
  const env = developmentRoot ? `shell.Environment("PROCESS")("STUDIO_DEV_ROOT") = ${literal(path.resolve(developmentRoot))}\r\n` : '';
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, `Set shell = CreateObject("WScript.Shell")\r\n${env}shell.Run ${literal(command)}, 0, False\r\n`);
  return file;
}
