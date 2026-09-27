import {useCallback, useEffect, useState} from 'react';
import type {StartupLogSnapshot} from '../../shared/startup-logs.js';

export function useWorkerStartupLogs(workerId: string, enabled: boolean, state: string) {
  const [saved, setSaved] = useState<StartupLogSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      setLoading(true);
      let sealed = false;
      try {
        const response = await fetch(`/api/v1/pool/workers/${encodeURIComponent(workerId)}/startup-logs`, {signal: controller.signal});
        if (!response.ok) throw Error();
        const record: StartupLogSnapshot = await response.json();
        if (controller.signal.aborted || record.worker_id !== workerId) return;
        setSaved(record); setError(''); sealed = record.collection === 'sealed';
      } catch {
        if (!controller.signal.aborted) setError('Could not refresh startup logs.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (!sealed) timer = setTimeout(() => void read(), 5000);
        }
      }
    }
    setError(''); void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [workerId, enabled, state, revision]);
  return {record: saved?.worker_id === workerId ? saved : null, error, loading, refresh};
}
