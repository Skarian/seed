import { setTimeout as delay } from 'node:timers/promises';

export async function waitFor(check, { timeout = 300000, interval = 5000, sleep = delay, now = Date.now, say = console.error } = {}) {
  const deadline = now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    if (now() >= deadline) break;
    say('Waiting for worker startup…');
    await sleep(Math.min(interval, deadline - now()));
  } while (now() <= deadline);
  throw new Error('Worker startup timed out. Inspect status; destroy the new rental if preparation cannot continue.');
}
