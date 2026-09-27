import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PoolAction,
  PoolSnapshot,
  WorkerClass,
} from "../../shared/pool.js";
import { useWorkerNotifications } from './use-worker-notifications.js';

export async function poolApi<T>(
  path = "",
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(
    "/api/v1/pool" + path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "Could not update workers. Try again.",
    );
  return result;
}
type PoolContextValue = {
  snapshot: PoolSnapshot | null;
  error: string;
  loaded: boolean;
  dialog: {
    open: boolean;
    tab: "workers" | "add";
    workerClass: WorkerClass;
    workerId?: string;
    selectionVersion: number;
  };
  open: (workerClass?: WorkerClass, workerId?: string) => void;
  findAnother: (workerClass: WorkerClass) => void;
  close: () => void;
  setTab: (tab: "workers" | "add") => void;
  setWorkerClass: (role: WorkerClass) => void;
  refresh: () => void;
  accept: (snapshot: PoolSnapshot) => void;
  hasCapacity: (
    role: WorkerClass,
    loras?: ReadonlyArray<{ id: string; revision: string }>,
    workflow?:string,
  ) => boolean;
  action: (
    action: PoolAction,
    workerId?: string,
    paths?: string[],
  ) => Promise<void>;
  pending: ReadonlySet<string>;
};
const PoolContext = createContext<PoolContextValue | null>(null);

/** A single mounted owner reads the server's pool. No browser-owned rental lifecycle. */
export function WorkerPoolProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  useWorkerNotifications(snapshot);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<PoolContextValue["dialog"]>({
    open: false,
    tab: "workers",
    workerClass: "image",
    selectionVersion: 0,
  });
  const epoch = useRef(0);
  const refresh = useCallback(() => {
    epoch.current++;
    setRevision((v) => v + 1);
  }, []);
  const accept = useCallback((value: PoolSnapshot) => {
    epoch.current++;
    setSnapshot(value);
    setError("");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    async function read() {
      if (reading) return;
      reading = true;
      const started = epoch.current;
      try {
        const response = await fetch("/api/v1/pool", {
          signal: controller.signal,
        });
        if (!response.ok) throw Error();
        const value: PoolSnapshot = await response.json();
        if (!controller.signal.aborted && started === epoch.current) {
          setSnapshot(value);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Worker status is unavailable. Reconnecting…");
      } finally {
        reading = false;
      }
    }
    void read();
    const timer = setInterval(() => void read(), 2000);
    window.addEventListener("seed:credentials-changed", refresh);
    window.addEventListener("seed:pool-changed", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("seed:credentials-changed", refresh);
      window.removeEventListener("seed:pool-changed", refresh);
    };
  }, [revision, refresh]);
  const action = useCallback(
    async (action: PoolAction, workerId?: string, paths?: string[]) => {
      const key = workerId ?? "pool";
      setPending((value) => new Set([...value, key]));
      try {
        accept(
          await poolApi<PoolSnapshot>(
            workerId
              ? "/workers/" + encodeURIComponent(workerId) + "/actions"
              : "/actions",
            { action, ...(paths ? { paths } : {}) },
          ),
        );
        window.dispatchEvent(new Event("seed:activity-changed"));
      } finally {
        setPending((value) => new Set([...value].filter((id) => id !== key)));
      }
    },
    [accept],
  );
  const open = useCallback((workerClass?: WorkerClass, workerId?: string) => {
    window.dispatchEvent(new Event("seed:workers-opened"));
    setDialog((value) => ({
      ...value,
      open: true,
      tab: workerClass && !workerId ? "add" : "workers",
      ...(workerClass ? { workerClass } : {}),
      workerId,
    }));
  }, []);
  const value = useMemo<PoolContextValue>(
    () => ({
      snapshot,
      error,
      loaded: !!snapshot,
      dialog,
      refresh,
      accept,
      action,
      pending,
      open,
      findAnother: workerClass => {
        window.dispatchEvent(new Event('seed:workers-opened'));
        setDialog(value => ({ ...value, open: true, tab: 'add', workerClass,
          workerId: undefined, selectionVersion: value.selectionVersion + 1 }));
      },
      close: () => setDialog((value) => ({ ...value, open: false })),
      setTab: (tab) => setDialog((value) => ({ ...value, tab })),
      setWorkerClass: (workerClass) =>
        setDialog((value) => ({ ...value, workerClass })),
      hasCapacity: (role, loras = [], workflow) =>
        !!snapshot?.workers.some(
          (worker) =>
            worker.worker_class === role &&
            (workflow!=='image-to-image'||worker.workflows?.includes(workflow)) &&
            !worker.quit_mode &&
            ["ready", "generating", "saving", "starting", "preparing"].includes(
              worker.state,
            ) &&
            (["starting", "preparing"].includes(worker.state) ||
              loras.every((lora) =>
                worker.installed_loras.some(
                  (installed) =>
                    installed.id === lora.id &&
                    installed.revision === lora.revision,
                ),
              )),
        ),
    }),
    [snapshot, error, dialog, refresh, accept, action, pending, open],
  );
  return <PoolContext.Provider value={value}>{children}</PoolContext.Provider>;
}
export function useWorkerPool() {
  const value = useContext(PoolContext);
  if (!value) throw Error("WorkerPoolProvider is missing.");
  return value;
}
