// WinSW runs this entry point in the foreground under NT SERVICE\Seed.
// It deliberately uses Seed's authenticated stop API, never process.kill().
import {setTimeout as delay} from 'node:timers/promises';
import {resolvePaths} from '../dist/server/storage.js';
import {control, readRunning} from '../dist/server/lifecycle.js';

if (!process.env.STUDIO_DEV_ROOT) throw Error('The service requires an explicit STUDIO_DEV_ROOT.');
const paths = resolvePaths(process.env.STUDIO_DEV_ROOT);
const action = process.argv[2];
if (action === 'run') {
  process.env.SEED_MANAGED = '1';
  await import('../dist/server/main.js');
} else if (action === 'stop') {
  const before = readRunning(paths);
  if (before) {
    if (!await control(paths, 'stop')) throw Error('Seed did not acknowledge graceful shutdown.');
    const deadline = Date.now() + 150_000;
    while (readRunning(paths)?.token === before.token) {
      if (Date.now() >= deadline) throw Error('Seed is still stopping; inspect the service logs.');
      await delay(250);
    }
  }
} else {
  throw Error('Use run or stop.');
}
