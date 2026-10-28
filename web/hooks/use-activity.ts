import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobRecord } from '../../shared/jobs.js';
import type { LoraImportActivity } from '../../shared/loras.js';
import { emptyClearedActivity, visibleActivityJob, visibleActivityImport, type ClearedActivity } from '../../shared/activity.js';

export function useActivity(mode: string) {
  const [state, setState] = useState<{
    jobs: JobRecord[];
    imports: LoraImportActivity[];
    cleared: ClearedActivity;
    loaded: boolean;
    error?: string;
  }>({ jobs: [], imports: [], cleared: emptyClearedActivity(), loaded: false });
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    async function read() {
      if (reading) return;
      reading = true;
      const current = generation.current;
      try {
        const responses = await Promise.all(
          ['jobs', 'lora-imports', 'activity/cleared'].map((path) =>
            fetch('/api/v1/' + path + '?mode=' + mode, { signal: controller.signal }),
          ),
        );
        if (responses.some((response) => !response.ok))
          throw Error('Could not load Activity. Retrying…');
        const [jobs, imports, cleared] = await Promise.all(responses.map((response) => response.json()));
        if (!controller.signal.aborted && generation.current === current)
          setState({ jobs: jobs.items, imports: imports.items, cleared, loaded: true });
      } catch (error) {
        if (!controller.signal.aborted && generation.current === current)
          setState((current) => ({ ...current, error: (error as Error).message }));
      } finally {
        reading = false;
      }
    }
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [mode, revision]);
  async function clear() {
    generation.current++;
    try {
      const response = await fetch('/api/v1/activity/clear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({mode}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.message ?? 'Could not clear activity. Try again.');
      generation.current++;
      setState(current => ({ ...current, cleared: data }));
      window.dispatchEvent(new Event('seed:activity-changed'));
    } finally { refresh(); }
  }
  return { ...state,
    jobs: state.jobs.filter(job => visibleActivityJob(job,state.cleared)),
    imports: state.imports.filter(job => visibleActivityImport(job,state.cleared)),
    refresh, clear,
  };
}
