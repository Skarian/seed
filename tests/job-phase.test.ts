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

it('allows exactly these moves between different states, and no others', () => {
  // Written out by hand, independently of the table in shared/jobs.ts. Staying in a state is always allowed.
  const stop = 'failed cancelled cancel_requested needs_attention';
  const allowed: Record<string, string> = {
    blocked: 'queued ' + stop,
    queued: 'uploading submitting running copying completed ' + stop,
    uploading: 'queued submitting running copying completed ' + stop,
    submitting: 'running copying completed ' + stop,
    running: 'copying completed ' + stop,
    copying: 'completed ' + stop,
    cancel_requested: 'queued uploading submitting running copying completed ' + stop,
    needs_attention: 'queued uploading submitting running copying completed ' + stop,
    completed: '',
    failed: '',
    cancelled: '',
  };
  expect(Object.keys(allowed).sort()).toEqual([...jobStates].sort());
  for (const from of jobStates)
    for (const to of jobStates)
      expect(jobCanMove(from, to), from + ' → ' + to).toBe(from === to || allowed[from]!.split(' ').includes(to));
  // Unknown names, including ones every object inherits, are never states.
  for (const name of ['typo', 'toString', 'constructor']) {
    expect(jobCanMove(name as never, 'queued')).toBe(false);
    expect(jobCanMove('queued', name as never)).toBe(false);
    expect(jobPhase({ state: name as never })).toBe('uncertain');
  }
});
