import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import type {PoolWorker} from '../shared/pool.js';
import {WorkerPreparation} from '../web/worker-preparation.js';

const serverTime = '2026-09-25T12:00:00.000Z';
const preparation: NonNullable<PoolWorker['preparation']> = {
  phase: 'Downloading models', stage: 'downloading', bytes_done: 400, bytes_total: 1000,
  bytes_per_second: 100, eta_seconds: 6, files: [],
  last_transfer_update_at: '2026-09-25T11:59:58.000Z',
};
function view(prep: Partial<typeof preparation> = {}, worker: Partial<PoolWorker> = {}) {
  return renderToStaticMarkup(React.createElement(WorkerPreparation, {
    worker: {state:'preparing',worker_class:'image',preparation:{...preparation,...prep},...worker} as PoolWorker,
    serverTime,
  }));
}
it('keeps bytes visible across fresh, stale and resumed transfer reports without inventing zero throughput', () => {
  expect(view()).toContain('100 B/s');
  expect(view()).toContain('Last transfer update just now');
  const stale = view({stalled:true,last_transfer_update_at:'2026-09-25T11:59:15.000Z'});
  expect(stale).toContain('400 B of 1,000 B');
  expect(stale).toContain('Rate unavailable');
  expect(stale).toContain('Last transfer update 45s ago');
  expect(stale).not.toContain('downloads left');
  expect(stale).not.toContain('100 B/s');
  expect(view({bytes_done:700,bytes_per_second:150})).toContain('150 B/s');
});
it('omits unknown reporting ages and keeps verification separate from transfer stalls', () => {
  const legacy = view({bytes_per_second:undefined,last_transfer_update_at:undefined});
  expect(legacy).toContain('Rate unavailable');
  expect(legacy).not.toContain('Last transfer update');
  expect(legacy).not.toContain('downloads left');
  expect(legacy).toContain('Transfer speed is not reported.');
  expect(legacy).not.toContain('Measuring download speed');
  const checking = view({stage:'verifying',bytes_done:1000,stalled:true});
  expect(checking).toContain('Checking model files');
  expect(checking).not.toContain('Rate unavailable');
  expect(checking).not.toContain('Last transfer update');
  expect(checking).not.toContain('Waiting for transfer updates');
});
it('shows engine startup without a download progress bar or stale transfer information', () => {
  const engine = view({stage:'starting_engine',bytes_done:1000});
  expect(engine).toContain('Starting generation engine');
  expect(engine).not.toContain('<progress');
  expect(engine).not.toContain('Last transfer update');
});
it('uses bounded provider startup categories and falls back honestly when absent', () => {
  expect(view({}, {preparation:undefined,startup_stage:'downloading_container'})).toContain('Downloading worker container');
  expect(view({}, {preparation:undefined,startup_stage:'verifying_container'})).toContain('Verifying worker container');
  expect(view({}, {preparation:undefined,startup_stage:'retrying_container'})).toContain('Provider retrying container startup');
  expect(view({}, {preparation:undefined})).toContain('Starting your worker');
});
