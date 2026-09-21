import { useEffect, useRef, useState } from 'react';
import type { LoraPreview } from '../../shared/loras.js';
import { adminApi } from '../admin-api.js';

type State =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; preview: LoraPreview }
  | { status: 'error'; message: string };
export function useCivitaiPreview() {
  const [state, setState] = useState<State>({ status: 'idle' });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  function reset() {
    pending.current?.abort();
    setState({ status: 'idle' });
  }
  async function lookup(url: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: 'loading' });
    try {
      const preview = await adminApi<LoraPreview>(
        '/loras/inspect',
        'POST',
        { url },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setState({ status: 'ready', preview });
      return preview;
    } catch (error) {
      if (!controller.signal.aborted)
        setState({ status: 'error', message: (error as Error).message });
    }
  }
  return { state, lookup, reset };
}
