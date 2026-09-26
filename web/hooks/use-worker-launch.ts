import { useRef, useState } from "react";
import type { LaunchRequest, PoolSnapshot } from "../../shared/pool.js";
import { poolApi, useWorkerPool } from "./use-worker-pool.js";

export function useWorkerLaunch() {
  const pool = useWorkerPool();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({
    busy: false,
  });
  const attempts = useRef(new Map<string, string>()),
    busy = useRef(false);
  async function launch(request: LaunchRequest) {
    if (busy.current) return false;
    busy.current = true;
    setState({ busy: true });
    const identity = JSON.stringify(request);
    if (!attempts.current.has(identity))
      attempts.current.set(
        identity,
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join(""),
      );
    try {
      pool.accept(
        await poolApi<PoolSnapshot>(
          "/launch",
          request,
          attempts.current.get(identity),
        ),
      );
      attempts.current.delete(identity);
      setState({ busy: false });
      pool.setTab("workers");
      window.dispatchEvent(new Event("seed:activity-changed"));
      return true;
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
      return false;
    } finally {
      busy.current = false;
    }
  }
  return { ...state, launch };
}
