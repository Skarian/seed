import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/operations', { recursive: true });
await cp('operations', 'dist/operations', { recursive: true });
