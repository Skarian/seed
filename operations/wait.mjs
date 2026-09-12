import { setTimeout as delay } from 'node:timers/promises';

export async function waitFor(check, { timeout = Infinity, interval = 5000, sleep = delay, now = Date.now, say = console.error } = {}) {
  const started = now(), deadline = started + timeout;
  let reported = -Infinity;
  do {
    const result = await check();
    if (result) return result;
    if (now() >= deadline) break;
    if(now()-reported>=30000) {say(`Waiting for worker startup (${Math.round((now()-started)/1000)}s elapsed)…`);reported=now();}
    await sleep(Math.min(interval, deadline - now()));
  } while (now() <= deadline);
  throw new Error('Worker startup timed out. Inspect status; destroy the new rental if preparation cannot continue.');
}
