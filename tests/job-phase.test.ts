import { it, expect } from 'vitest';
import { jobPhase, jobActive, jobNeedsAttention, type JobRecord } from '../shared/jobs.js';
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
