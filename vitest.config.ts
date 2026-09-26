import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { maxWorkers: 3, include: ['tests/**/*.test.ts'] } });
