import { it, expect, vi } from 'vitest';

const reads: Array<(value: unknown) => void> = [];
vi.mock('../web/app/api.js', async original => ({
  ...(await original<typeof import('../web/app/api.js')>()),
  projects: { get: () => new Promise(resolve => reads.push(resolve)) },
}));
const { currentProject, putProject, reloadProject } = await import('../web/app/data.js');

const copy = (revision: number, state: string, version = 3) => ({ id: 'p', version, revision, jobs: [{ id: 'j', state }] }) as any;

it('never lets an older copy of a project replace a newer one, even when a job save left the version alone', () => {
  putProject(copy(2, 'completed'));
  putProject(copy(1, 'running'));
  expect(currentProject('p')!.jobs[0]!.state).toBe('completed');
  putProject(copy(3, 'completed'));
  expect(currentProject('p')!.revision).toBe(3);
  // A response for an older version of the project never wins, whatever its revision.
  putProject(copy(9, 'running', 2));
  expect(currentProject('p')!.revision).toBe(3);
});

it('reads a project once at a time, and once more for every burst of asks made meanwhile', async () => {
  void reloadProject('p');
  void reloadProject('p');
  void reloadProject('p');
  expect(reads).toHaveLength(1);
  reads.shift()!(copy(4, 'completed'));
  await new Promise(r => setTimeout(r, 0));
  expect(reads).toHaveLength(1);
  reads.shift()!(copy(5, 'completed'));
  await new Promise(r => setTimeout(r, 0));
  expect(reads).toHaveLength(0);
  expect(currentProject('p')!.revision).toBe(5);
});
