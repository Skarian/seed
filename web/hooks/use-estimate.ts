import { useCallback, useEffect, useState } from 'react';
import type { Estimate, PriceInput } from '../../shared/pricing.js';
import type { ProviderIssue } from '../../server/fal-errors.js';

type State =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; estimate: Estimate }
  | { status: 'error'; key: string; message: string; issue?: ProviderIssue };

export function useEstimate(input: PriceInput, enabled = true) {
  const key = JSON.stringify(input);
  const [state, setState] = useState<State>({ status: 'loading', key });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    setState((current) => ({ status: 'loading', key: current.key }));
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout>;
    setState({ status: 'loading', key });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/estimates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: key,
          signal: controller.signal,
        });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setState({
            status: 'error',
            key,
            message: body.error?.message ?? 'Cannot get a cost estimate.',
            issue: body.error,
          });
          return;
        }
        const estimate = body as Estimate;
        setState({ status: 'ready', key, estimate });
        expiry = setTimeout(
          refresh,
          Math.max(1000, Date.parse(estimate.expires_at) - Date.now() - 30000),
        );
      } catch (error) {
        if (!controller.signal.aborted)
          setState({ status: 'error', key, message: (error as Error).message });
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(expiry);
    };
  }, [key, enabled, revision, refresh]);
  useEffect(() => {
    const events = ['seed:estimate-invalidated', 'seed:credentials-changed', 'seed:loras-changed'];
    events.forEach((event) => window.addEventListener(event, refresh));
    return () => events.forEach((event) => window.removeEventListener(event, refresh));
  }, [refresh]);
  const current = enabled && state.key === key ? state : undefined;
  return {
    status: !enabled ? 'disabled' : (current?.status ?? 'loading'),
    estimate:
      current?.status === 'ready' && Date.parse(current.estimate.expires_at) > Date.now()
        ? current.estimate
        : undefined,
    error: current?.status === 'error' ? current.message : undefined,
    issue: current?.status === 'error' ? current.issue : undefined,
    enabled,
    refresh,
  };
}
export type CostEstimate = ReturnType<typeof useEstimate>;
