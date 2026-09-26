import { useCallback, useEffect, useState } from "react";
import type { OffersResponse, WorkerClass } from "../../shared/pool.js";

export function useWorkerOffers(workerClass: WorkerClass, enabled: boolean) {
  const [state, setState] = useState<{
    role?: WorkerClass;
    result?: OffersResponse;
    loading: boolean;
    error?: string;
  }>({ loading: false });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((value) => ({ ...value, loading: true, error: undefined }));
    void fetch("/api/v1/pool/offers?worker_class=" + workerClass, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw Error(body.error?.message ?? "Could not search for workers.");
        return body as OffersResponse;
      })
      .then((result) => {
        if (!controller.signal.aborted)
          setState({ role: workerClass, result, loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((value) => ({
            ...value,
            loading: false,
            error: error.message,
          }));
      });
    return () => controller.abort();
  }, [workerClass, enabled, revision]);
  useEffect(() => {
    window.addEventListener("seed:credentials-changed", refresh);
    return () =>
      window.removeEventListener("seed:credentials-changed", refresh);
  }, [refresh]);
  return {
    ...state,
    result: state.role === workerClass ? state.result : undefined,
    refresh,
  };
}
