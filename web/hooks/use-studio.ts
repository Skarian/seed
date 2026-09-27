import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioSnapshot } from '../../shared/studio.js';
import type { JobRecord } from '../../shared/jobs.js';

type State = { studio: StudioSnapshot | null; jobs: JobRecord[]; error?: string };
export function useStudio() {
  const [state, setState] = useState<State>({ studio: null, jobs: [] });
  const [revision, setRevision] = useState(0);
  const deleted = useRef(new Set<string>());
  const generation = useRef(0);
  const loraRevision = useRef<number | undefined>(undefined);
  const refresh = useCallback(() => {
    generation.current++;
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function read() {
      if (running) return;
      running = true;
      const currentGeneration = generation.current;
      try {
        const responses = await Promise.all(
          ['/api/v1/studio', '/api/v1/jobs'].map((url) =>
            fetch(url, { signal: controller.signal }),
          ),
        );
        if (responses.some((response) => !response.ok)) throw Error('Seed is unavailable.');
        const [studio, history] = await Promise.all(responses.map((response) => response.json()));
        if (!controller.signal.aborted && currentGeneration === generation.current) {
          if (loraRevision.current !== undefined && studio.loras_revision !== loraRevision.current)
            window.dispatchEvent(new Event('seed:loras-changed'));
          loraRevision.current = studio.loras_revision;
          setState({
            studio,
            jobs: history.items.map((job: JobRecord) => ({
              ...job,
              outputs: job.outputs.filter((id) => !deleted.current.has(id)),
            })),
          });
        }
      } catch {
        if (!controller.signal.aborted && currentGeneration === generation.current)
          setState((current) => ({ ...current, error: 'Seed is unavailable. Reconnecting…' }));
      } finally {
        running = false;
      }
    }
    void read();
    const timer = setInterval(() => void read(), 3000);
    window.addEventListener('seed:credentials-changed', refresh);
    window.addEventListener('seed:activity-changed', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('seed:credentials-changed', refresh);
      window.removeEventListener('seed:activity-changed', refresh);
    };
  }, [revision, refresh]);
  const accept = useCallback(
    (jobs: JobRecord[]) => {
      setState((current) => ({
        ...current,
        jobs: [
          ...jobs,
          ...current.jobs.filter((job) => !jobs.some((fresh) => fresh.id === job.id)),
        ],
      }));
      refresh();
    },
    [refresh],
  );
  const removeAsset = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((job) => ({
          ...job,
          outputs: job.outputs.filter((output) => output !== id),
        })),
      }));
      refresh();
    },
    [refresh],
  );
  return { ...state, refresh, accept, removeAsset };
}
