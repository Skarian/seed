import envPaths from 'env-paths';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface StudioPaths {
  data: string; config: string; cache: string; log: string; temp: string;
}

export function resolvePaths(developmentRoot?: string): StudioPaths {
  if (!developmentRoot) return envPaths('Seed', { suffix: '' });
  if(developmentRoot.startsWith('profile:')){
    const name=developmentRoot.slice(8);if(!/^[a-z0-9-]{1,40}$/.test(name))throw Error('Use a simple profile name.');
    return Object.fromEntries(Object.entries(envPaths('Seed',{suffix:''})).map(([kind,folder])=>[kind,path.join(folder,'profiles',name)])) as unknown as StudioPaths;
  }
  const root = path.resolve(developmentRoot);
  return {
    data: path.join(root, 'data'), config: path.join(root, 'config'),
    cache: path.join(root, 'cache'), log: path.join(root, 'log'), temp: path.join(root, 'temp'),
  };
}

export function prepareStorage(paths: StudioPaths): void {
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true });
  for (const directory of ['media/originals', 'media/prepared', 'media/outputs']) {
    mkdirSync(path.join(paths.data, directory), { recursive: true });
  }
}
