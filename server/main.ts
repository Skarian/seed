import { createApp } from './http.js';
import { resolvePaths } from './storage.js';
import { settings } from './settings.js';
import { validateAddress } from './address.js';
import { startControl } from './lifecycle.js';
import type {WorkerPool} from './pool.js';

const paths = resolvePaths(process.env.STUDIO_DEV_ROOT);
const config = settings(paths);
const port = Number(process.env.STUDIO_PORT ?? config.port);
const host = config.host;
validateAddress(host, port);
const app = await createApp({ paths, port, host });
let closeControl: (() => Promise<void>) | undefined;
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await app.close(); await closeControl?.();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop(); });
try {
  await app.listen({ host, port });
  if (process.env.SEED_MANAGED === '1') closeControl = await startControl(paths, `http://${host}:${port}`, stop);
  console.log(`seed: http://${host}:${port}`);
} catch (error) {
  (app as typeof app & {seedPool:WorkerPool}).seedPool.diagnostics?.error('server.listen',error);
  await stop();
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Use the existing seed instance or choose another port.`);
  else console.error('seed could not start. Check its installation and data directory.');
  process.exitCode = 1;
}
