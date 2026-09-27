import { useCallback, useEffect, useState } from 'react';
import type { JobRecord } from '../../shared/jobs.js';
import type { LoraImportActivity } from '../../shared/loras.js';

export function useActivity(mode: string) {
  const [state, setState] = useState<{
    jobs: JobRecord[];
    imports: LoraImportActivity[];
    loaded: boolean;
    error?: string;
  }>({ jobs: [], imports: [], loaded: false });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    async function read() {
      if (reading) return;
      reading = true;
      try {
        const responses = await Promise.all(
          ['jobs', 'lora-imports'].map((path) =>
            fetch('/api/v1/' + path + '?mode=' + mode, { signal: controller.signal }),
          ),
        );
        if (responses.some((response) => !response.ok))
          throw Error('Could not load Activity. Retrying…');
        const [jobs, imports] = await Promise.all(responses.map((response) => response.json()));
        if (!controller.signal.aborted)
          setState({ jobs: jobs.items, imports: imports.items, loaded: true });
      } catch (error) {
        if (!controller.signal.aborted)
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
  return { ...state, refresh };
}
