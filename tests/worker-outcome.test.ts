import { expect, it } from 'vitest';
import { hasUndismissedLaunchFailure, isRejectedLaunch, workerStatusLabel } from '../shared/worker-outcome.js';
import type { PoolWorker } from '../shared/pool.js';

it('requires confirmed rejection and keeps dismissed failure labels in history', () => {
  const failed={state:'released',create_rejected:true} as PoolWorker;
  expect(isRejectedLaunch(failed)).toBe(true);
  expect(hasUndismissedLaunchFailure(failed)).toBe(true);
  expect(workerStatusLabel(failed)).toBe('Launch failed');
  expect(hasUndismissedLaunchFailure({...failed,launch_failure_dismissed_at:'2026-09-25T00:00:00Z'})).toBe(false);
  expect(workerStatusLabel({...failed,launch_failure_dismissed_at:'2026-09-25T00:00:00Z'})).toBe('Launch failed');
  for(const worker of [{state:'released'}, {state:'needs_attention',issue:{code:'launch_uncertain'}}, {state:'releasing',issue:{code:'termination_unconfirmed'}}, {...failed,provider_id:'allocated'}] as PoolWorker[])
    expect(isRejectedLaunch(worker)).toBe(false);
});
