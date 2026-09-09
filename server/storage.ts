import envPaths from 'env-paths';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface StudioPaths {
  data: string; config: string; cache: string; log: string; temp: string;
}

export function resolvePaths(developmentRoot?: string): StudioPaths {
  if (!developmentRoot) return envPaths('RunpodStudio', { suffix: '' });
  const root = path.resolve(developmentRoot);
  return {
    data: path.join(root, 'data'), config: path.join(root, 'config'),
    cache: path.join(root, 'cache'), log: path.join(root, 'log'), temp: path.join(root, 'temp'),
  };
}

export function prepareStorage(paths: StudioPaths): void {
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true });
  for (const directory of ['media/originals', 'media/prepared', 'media/outputs', 'transfers']) {
    mkdirSync(path.join(paths.data, directory), { recursive: true });
  }
}
