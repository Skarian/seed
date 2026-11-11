import { it, expect, vi } from 'vitest';

const reads: Array<(value: unknown) => void> = [];
vi.mock('../web/app/api.js', async original => ({
  ...(await original<typeof import('../web/app/api.js')>()),
  projects: { get: () => new Promise(resolve => reads.push(resolve)) },
}));
const { currentProject, putProject, reloadProject } = await import('../web/app/data.js');

const copy = (as_of: string, state: string) => ({ id: 'p', version: 3, as_of, jobs: [{ id: 'j', state }] }) as any;

it('never lets an older copy of a project replace a newer one, even when a job save left the version alone', () => {
  putProject(copy('2026-01-01T00:00:02.000Z', 'completed'));
  putProject(copy('2026-01-01T00:00:01.000Z', 'running'));
  expect(currentProject('p')!.jobs[0]!.state).toBe('completed');
  putProject(copy('2026-01-01T00:00:03.000Z', 'completed'));
  expect(currentProject('p')!.as_of).toBe('2026-01-01T00:00:03.000Z');
});

it('reads a project once at a time, and once more for every burst of asks made meanwhile', async () => {
  void reloadProject('p');
  void reloadProject('p');
  void reloadProject('p');
  expect(reads).toHaveLength(1);
  reads.shift()!(copy('2026-01-01T00:00:04.000Z', 'completed'));
  await new Promise(r => setTimeout(r, 0));
  expect(reads).toHaveLength(1);
  reads.shift()!(copy('2026-01-01T00:00:05.000Z', 'completed'));
  await new Promise(r => setTimeout(r, 0));
  expect(reads).toHaveLength(0);
  expect(currentProject('p')!.as_of).toBe('2026-01-01T00:00:05.000Z');
});
