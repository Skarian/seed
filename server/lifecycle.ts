import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { StudioPaths } from './storage.js';

export type Running = { port: number; token: string; url: string; pid: number };
const stateFile = (paths: StudioPaths) => path.join(paths.config, 'running.json');
export function readRunning(paths: StudioPaths): Running | null {
  try { return JSON.parse(readFileSync(stateFile(paths), 'utf8')); } catch { return null; }
}
export async function control(paths: StudioPaths, action: 'status' | 'stop'): Promise<Running | null> {
  const state = readRunning(paths);
  if (!state || !Number.isInteger(state.port) || typeof state.token !== 'string') return null;
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/${action}`, {
      method: 'POST', headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const result = await response.json() as { token: string };
    return result.token === state.token ? state : null;
  } catch { return null; }
}
export async function startControl(paths: StudioPaths, url: string, stop: () => Promise<void>) {
  const token = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.headers.origin || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end(); return;
    }
    if (request.url !== '/status' && request.url !== '/stop') { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ token }));
    if (request.url === '/stop') setImmediate(() => { void stop(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as import('node:net').AddressInfo).port;
  const state: Running = { token, port, url, pid: process.pid };
  const file = stateFile(paths);
  writeFileSync(`${file}.${process.pid}`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${file}.${process.pid}`, file);
  return async () => {
    if (readRunning(paths)?.token === token) unlinkSync(file);
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
}
