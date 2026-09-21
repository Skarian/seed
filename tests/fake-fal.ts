import { vi } from 'vitest';
import sharp from 'sharp';
import { statSync } from 'node:fs';
import type { FalTransport } from '../server/fal.js';
export function fakeFal() {
  return {
    configured: true,
    submit: vi.fn(async () => ({ request_id:'fal-request',status_url:'https://queue.fal.run/test/status',response_url:'https://queue.fal.run/test/result',cancel_url:'https://queue.fal.run/test/cancel' })),
    status: vi.fn(async () => ({ status: 'COMPLETED' })),
    result: vi.fn(async () => ({ images: [{ url: 'https://v3b.fal.media/files/b/test/output.png' }] })),
    cancel: vi.fn(async () => ({ status: 'CANCELLED' })),
    upload: vi.fn(async () => 'https://v3b.fal.media/files/b/test/input'),
    sign: vi.fn(async (url: string) => url + '?identity=fixture'),
    download: vi.fn(async (_url: string, file: string) => { await sharp({ create: { width: 64, height: 64, channels: 3, background: '#b06e39' } }).png().toFile(file); return { size: statSync(file).size, sha256: 'a'.repeat(64) }; }),
  } satisfies FalTransport;
}
