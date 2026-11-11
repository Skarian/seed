import { it, expect } from 'vitest';
import { canRun, gpuNeed, localCanRun, rentalState, type PoolSnapshot, type PoolWorker } from '../shared/pool.js';
import { readiness } from '../web/app/project/readiness.js';
import type { ImageRequest } from '../shared/generation.js';

const style = { id: 'ink', revision: 'r1' };
const installed = { ...style, route: 'image' as const, name: 'Ink', filename: 'ink.safetensors', sha256: 'x' };
const gpu = (over: Partial<PoolWorker & { ready: boolean; finish_before: string; requested_loras: (typeof installed)[]; adapters_frozen: boolean }> = {}) =>
  ({ worker_class: 'image', state: 'ready', ready: true, ready_at: 't', installed_loras: [], ...over }) as PoolWorker & { ready?: boolean };
const draft = gpuNeed({ workflow: 'text-to-image' }, [style]);

it('claims only a prepared, free GPU that already has the styles', () => {
  const need = gpuNeed({ workflow: 'text-to-image' }, [style], '2026-01-01');
  expect(canRun(gpu({ installed_loras: [installed] }), need, 'claim')).toBe(true);
  expect(canRun(gpu({ installed_loras: [installed], current_job_id: 'busy' }), need, 'claim')).toBe(false);
  expect(canRun(gpu({ installed_loras: [installed], ready: false }), need, 'claim')).toBe(false);
  expect(canRun(gpu(), need, 'claim')).toBe(false);
  expect(canRun(gpu({ installed_loras: [installed] }), gpuNeed({ workflow: 'text-to-video' }, [style], '2026-01-01'), 'claim')).toBe(false);
});

it('lets work wait for a GPU that will get its styles, and for a finishing GPU only if asked for before the cutoff', () => {
  // The server sees the launch plan; the browser trusts a GPU that is still starting.
  expect(canRun(gpu({ state: 'preparing', ready: false, ready_at: undefined, requested_loras: [installed] }), draft, 'wait')).toBe(true);
  expect(canRun(gpu({ state: 'preparing', ready: false, ready_at: undefined, requested_loras: [] }), draft, 'wait')).toBe(false);
  expect(canRun(gpu({ state: 'starting', ready_at: undefined }), draft, 'wait')).toBe(true);
  expect(canRun(gpu({ adapters_frozen: true, requested_loras: [installed] }), draft, 'wait')).toBe(false);
  const finishing = gpu({ quit_mode: 'finish', finish_before: '2026-01-02', installed_loras: [installed] });
  expect(canRun(finishing, gpuNeed({ workflow: 'text-to-image' }, [style], '2026-01-01'), 'wait')).toBe(true);
  expect(canRun(finishing, gpuNeed({ workflow: 'text-to-image' }, [style], '2026-01-03'), 'wait')).toBe(false);
  expect(canRun(finishing, draft, 'wait')).toBe(false);
  // An edit needs a GPU that says it can edit, once that GPU has been ready.
  expect(canRun(gpu(), gpuNeed({ workflow: 'image-to-image' }), 'wait')).toBe(false);
  expect(canRun(gpu({ workflows: ['image-to-image'] }), gpuNeed({ workflow: 'image-to-image' }), 'claim')).toBe(true);
});

it('shows finishing from the quit mode while keeping the real state', () => {
  expect(rentalState({ state: 'ready', quit_mode: 'finish' })).toBe('finishing');
  expect(rentalState({ state: 'generating', quit_mode: 'finish', current_job_id: 'job' })).toBe('generating');
  expect(rentalState({ state: 'needs_attention', quit_mode: 'finish' })).toBe('needs_attention');
  expect(rentalState({ state: 'ready' })).toBe('ready');
});

it('matches a Klein edit by the server rule on Seed PC and on cloud, and never offers a GPU that could not take it', () => {
  const edit = { workflow: 'image-to-image', engine: 'klein', target: 'auto' } as unknown as ImageRequest;
  const local = (workflows: string[], over = {}) => ({ enabled: true, paused: false, workflows, ...over });
  const pool = (seedPc: object | null, cloud: string[]) =>
    ({ workers: [], local: seedPc, cloud_workflows: cloud }) as unknown as PoolSnapshot;
  const basic = ['text-to-image', 'image-to-image'],
    klein = [...basic, 'image-to-image:klein'];
  expect(localCanRun(local(basic), edit, [], () => true)).toBe(false);
  expect(localCanRun(local(klein), edit, [], () => true)).toBe(true);
  // Seed PC without Klein is not ready, and with no cloud GPU that has it, nothing is rented.
  expect(readiness(edit, pool(local(basic), basic), [])).toMatchObject({
    blocked: true,
    label: expect.stringContaining('No GPU here can run FLUX 3 Image Klein'),
  });
  expect(readiness({ ...edit, target: 'local' }, pool(local(basic), klein), [])).toMatchObject({
    blocked: true,
    label: expect.stringContaining("FLUX 3 Image Klein isn't installed"),
  });
  expect(readiness(edit, pool(local(klein), basic), [])).toMatchObject({ where: 'local', tone: 'ok' });
  // Cloud: blocked without the capability, offered with it.
  expect(readiness({ ...edit, target: 'cloud' }, pool(null, basic), [])).toMatchObject({ where: 'cloud', blocked: true });
  expect(readiness({ ...edit, target: 'cloud' }, pool(local(klein), basic), [])).toMatchObject({
    label: expect.stringContaining('choose Runs on: Seed PC'),
  });
  expect(readiness({ ...edit, target: 'cloud' }, pool(null, klein), [])).toMatchObject({ where: 'cloud', needs: 'image' });
  // A paused Seed PC, or one that needs attention, is named before anything says ready.
  expect(readiness(edit, pool(local(klein, { paused: true }), basic), [])).toMatchObject({
    blocked: true,
    label: 'Seed PC is paused · resume it in GPUs',
  });
  expect(
    readiness({ ...edit, target: 'local' }, pool(local(klein, { issue: { code: 'x', message: 'x' } }), klein), []),
  ).toMatchObject({ blocked: true, label: 'Seed PC needs attention · open GPUs to see why' });
  expect(readiness(edit, pool(local(klein, { paused: true }), klein), [])).toMatchObject({ where: 'cloud', needs: 'image' });
});

it('says where a draft runs without the caller reading its label', () => {
  const request = { workflow: 'text-to-image', loras: [{ ...style, scale: 1 }] } as unknown as ImageRequest;
  const pool = (workers: PoolWorker[]) =>
    ({ workers, local: { enabled: true, paused: false, workflows: ['text-to-image'] } }) as unknown as PoolSnapshot;
  const styled = gpu({ installed_loras: [installed], hourly: 1 } as Partial<PoolWorker>);
  expect(readiness(request, pool([styled]), [])).toMatchObject({ where: 'either', billing: true });
  // A running GPU without the draft's style would never take it, so Seed PC runs it.
  expect(readiness(request, pool([gpu({ hourly: 1 } as Partial<PoolWorker>)]), [])).toMatchObject({ where: 'local' });
  expect(readiness({ ...request, target: 'cloud' }, pool([gpu()]), [])).toMatchObject({ where: 'cloud', needs: 'image' });
  expect(readiness({ ...request, target: 'cloud' }, pool([styled]), [])).toMatchObject({ where: 'cloud', label: 'Image GPU ready' });
});
