import { expect, it } from 'vitest';
import type { PoolWorker } from '../shared/pool.js';
import { poolStatusText, downloadTime } from '../web/worker-status.js';
it('distinguishes preparation, available capacity, busy jobs and shutdown', () => {
  const workers = ['starting', 'preparing', 'ready', 'generating', 'saving', 'needs_attention', 'released'].map(state => ({state}) as PoolWorker);
  expect(poolStatusText(workers)).toBe('2 preparing · 1 ready · 2 busy · 1 need attention');
  expect(poolStatusText([{state:'generating',quit_mode:'finish'} as PoolWorker])).toBe('1 finishing');
  expect(poolStatusText([])).toBe('No workers running');
});
it('labels approximate download time without implying total readiness time', () => {
  expect(downloadTime(24)).toBe('Less than a minute of downloads left');
  expect(downloadTime(121)).toBe('About 3 min of downloads left');
  expect(downloadTime(3720)).toBe('About 1h 2m of downloads left');
});
