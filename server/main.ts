import { createApp } from './http.js';
import { resolvePaths } from './storage.js';

const port = Number(process.env.STUDIO_PORT ?? '4310');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('STUDIO_PORT must be an integer from 1024 to 65535.');
const app = await createApp({ paths: resolvePaths(process.env.STUDIO_DEV_ROOT), port });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`Runpod Studio: http://127.0.0.1:${port}`);
} catch (error) {
  await app.close();
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Use the existing studio or choose another port.`);
  else console.error('The studio could not start. Check its installation and data directory.');
  process.exitCode = 1;
}
