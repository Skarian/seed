import { it, expect, vi, beforeEach, afterEach } from 'vitest';

// Synthetic fixtures only. `useProject` is driven without a DOM: effects run as soon as the hook calls them, and the
// store's snapshot is read on demand. Reads and the event stream are fakes the tests control.
const reads: Array<{ id: string; resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
const cleanups: Array<() => void> = [];
let snapshot: () => { project: any; error: string };
vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
  useSyncExternalStore: (_subscribe: unknown, get: () => any) => ((snapshot = get), get()),
}));
vi.mock('../web/app/api.js', async original => ({
  ...(await original<typeof import('../web/app/api.js')>()),
  projects: { get: (id: string) => new Promise((resolve, reject) => reads.push({ id, resolve, reject })) },
}));
class FakeStream {
  static open: FakeStream[] = [];
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  constructor(readonly url: string) {
    FakeStream.open.push(this);
  }
  send(value: unknown) {
    this.onmessage!({ data: JSON.stringify(value) });
  }
  close() {
    FakeStream.open = FakeStream.open.filter(s => s !== this);
  }
}
vi.stubGlobal('EventSource', FakeStream);
const { useProject } = await import('../web/app/data.js');

const copy = (id: string, revision: number, messages: unknown[] = []) =>
  ({ id, version: 1, revision, messages, jobs: [] }) as any;
/** Opens the project and answers its first read with `first`. */
async function watch(id: string, first = copy(id, 1)) {
  useProject(id);
  reads.shift()!.resolve(first);
  await vi.advanceTimersByTimeAsync(0);
  return FakeStream.open.at(-1)!;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.splice(0).forEach(c => c());
  reads.length = 0;
  vi.useRealTimers();
});

it('reads a project again after a failed read, with no save to prompt it', async () => {
  useProject('a');
  reads.shift()!.reject(new Error('Network error'));
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot().error).toBe('Network error');
  await vi.advanceTimersByTimeAsync(4_999);
  expect(reads).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(reads.map(r => r.id)).toEqual(['a']);
  reads.shift()!.resolve(copy('a', 2));
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot()).toMatchObject({ project: { revision: 2 }, error: '' });
  // Once a read succeeds, the page stops asking.
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads).toHaveLength(0);
});

it('keeps a streamed reply when an older read lands after it', async () => {
  const stream = await watch('b');
  stream.onopen!();
  expect(reads).toHaveLength(1);
  const reply = { id: 'm1', role: 'assistant', text: 'Drafting', transcript: { state: 'running' } };
  stream.send({ version: 1, revision: 3, activity: 'replying', stream_message: reply });
  expect(snapshot().project).toMatchObject({ revision: 3, messages: [reply] });
  // The read started before the patch answers with the project as it was then.
  reads.shift()!.resolve(copy('b', 2));
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot().project).toMatchObject({ revision: 3, messages: [reply] });
  // The change of activity asked for one more read, made after the one in flight.
  await vi.advanceTimersByTimeAsync(120);
  expect(reads.map(r => r.id)).toEqual(['b']);
});

it('reads the project again shortly after job progress', async () => {
  const stream = await watch('c');
  stream.send({ jobs: true });
  stream.send({ jobs: true });
  await vi.advanceTimersByTimeAsync(119);
  expect(reads).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(reads.map(r => r.id)).toEqual(['c']);
  reads.shift()!.resolve(copy('c', 4));
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot().project.revision).toBe(4);
});
