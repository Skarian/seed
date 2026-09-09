import { createApp } from './http.js';
import { resolvePaths } from './storage.js';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';

const port = Number(process.env.STUDIO_PORT ?? '4310');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('STUDIO_PORT must be an integer from 1024 to 65535.');
// LAN preview is an explicit opt-in using isolated development data, not public hosting.
const host = process.env.STUDIO_PREVIEW_ADDRESS ?? '127.0.0.1';
if (host !== '127.0.0.1') {
  const octets = host.split('.').map(Number);
  const privateAddress = octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31);
  const assigned = Object.values(networkInterfaces()).flat().some(address => address?.address === host);
  if (!process.env.STUDIO_DEV_ROOT || isIP(host) !== 4 || !privateAddress || !assigned) {
    throw new Error('LAN preview requires an assigned private IPv4 address and isolated STUDIO_DEV_ROOT.');
  }
}
const app = await createApp({ paths: resolvePaths(process.env.STUDIO_DEV_ROOT), port, host });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
try {
  await app.listen({ host, port });
  console.log(`Runpod Studio: http://${host}:${port}`);
} catch (error) {
  await app.close();
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Use the existing studio or choose another port.`);
  else console.error('The studio could not start. Check its installation and data directory.');
  process.exitCode = 1;
}
