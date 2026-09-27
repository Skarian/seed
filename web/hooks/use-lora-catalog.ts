import { useCallback, useEffect, useState } from 'react';
import type { LoraGroup } from '../../shared/loras.js';
import { adminApi } from '../admin-api.js';

export function useLoraCatalog(mode: 'sfw' | 'nsfw') {
  const [state, setState] = useState<{ items?: LoraGroup[]; error?: string }>({});
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void adminApi<{ items: LoraGroup[] }>(
      '/loras?mode=' + mode,
      'GET',
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setState({ items: result.items });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((current) => ({ ...current, error: error.message }));
      });
    return () => controller.abort();
  }, [mode, revision]);
  useEffect(() => {
    window.addEventListener('seed:loras-changed', refresh);
    return () => window.removeEventListener('seed:loras-changed', refresh);
  }, [refresh]);
  return { ...state, refresh };
}
