import { it, expect } from 'vitest';
import { jobPhase, jobActive, jobNeedsAttention, jobCanMove, jobStates, type JobRecord } from '../shared/jobs.js';
import { isFailed } from '../web/app/format.js';

const job = (state: string, more: Partial<JobRecord> = {}) => ({ state, ...more }) as JobRecord;

it('reads every stored job state as one phase', () => {
  expect(['queued', 'blocked', 'uploading', 'submitting', 'running', 'copying', 'cancel_requested', 'needs_attention', 'completed', 'failed', 'cancelled'].map(s => jobPhase(job(s)))).toEqual(
    ['queued', 'held', 'starting', 'starting', 'running', 'saving', 'cancelling', 'uncertain', 'completed', 'failed', 'cancelled'],
  );
});

it('counts a picture made on a GPU but not saved here as unsaved, never as failed', () => {
  const unsaved = job('copying', { recovery_blocked: true });
  expect(jobPhase(unsaved)).toBe('unsaved');
  expect(isFailed(unsaved)).toBe(false);
  expect(jobActive(unsaved)).toBe(false);
  expect(jobNeedsAttention(unsaved)).toBe(true);
  // A finished job keeps its outcome even if its acknowledgement could not be sent.
  expect(jobPhase(job('completed', { recovery_blocked: true }))).toBe('completed');
});

it('moves a job forward, or to a stop, and never changes a finished one', async () => {
  expect(jobCanMove('queued', 'uploading')).toBe(true);
  expect(jobCanMove('running', 'copying')).toBe(true);
  expect(jobCanMove('needs_attention', 'copying')).toBe(true);
  expect(jobCanMove('copying', 'failed')).toBe(true);
  expect(jobCanMove('submitting', 'queued')).toBe(false);
  expect(jobCanMove('copying', 'running')).toBe(false);
  for (const done of ['completed', 'failed', 'cancelled'] as const) expect(jobCanMove(done, 'queued')).toBe(false);
});

it('checks every pair of states: finished jobs never move, open jobs can always stop, unknown states never move', () => {
  const finished = ['completed', 'failed', 'cancelled'];
  for (const from of jobStates)
    for (const to of jobStates) {
      const allowed = jobCanMove(from, to);
      if (from === to) expect(allowed).toBe(true);
      else if (finished.includes(from)) expect(allowed, from + ' → ' + to).toBe(false);
      else if (['failed', 'cancelled', 'cancel_requested', 'needs_attention'].includes(to)) expect(allowed).toBe(true);
    }
  expect(jobCanMove('typo' as never, 'queued')).toBe(false);
  expect(jobCanMove('queued', 'typo' as never)).toBe(false);
  expect(jobPhase({ state: 'typo' as never })).toBe('uncertain');
});
