import { useCallback, useEffect, useRef, useState, useSyncExternalStore, createContext, useContext } from 'react';
import {
  projects,
  pool as poolApi,
  jobs as jobsApi,
  assets as assetsApi,
  onAssetsChanged,
  type Project,
  type ProjectSummary,
  type PoolSnapshot,
  type JobRecord,
  type LibraryAsset,
  type AssetQuery,
} from './api.js';

/* ---------- Routing ---------- */
export type Route =
  | { name: 'home' }
  | { name: 'projects' }
  | { name: 'project'; id: string; view: 'conversation' | 'results'; focus?: string }
  | { name: 'library'; collection?: string; project?: string }
  | { name: 'gpus' }
  | { name: 'settings'; section?: string };

export function parseRoute(loc: { pathname: string; search: string } = location): Route {
  const params = new URLSearchParams(loc.search),
    path = loc.pathname.replace(/\/+$/, '') || '/';
  const project = path.match(/^\/projects\/([\w-]+)$/);
  if (project)
    return {
      name: 'project',
      id: project[1]!,
      view: params.get('view') === 'results' ? 'results' : 'conversation',
      ...(params.get('focus') ? { focus: params.get('focus')! } : {}),
    };
  if (path === '/chat' && params.get('chat')) return { name: 'project', id: params.get('chat')!, view: 'conversation' };
  if (path === '/projects' || path === '/chat') return { name: 'projects' };
  if (path === '/library')
    return {
      name: 'library',
      ...(params.get('collection') ? { collection: params.get('collection')! } : {}),
      ...(params.get('project') ? { project: params.get('project')! } : {}),
    };
  if (path === '/gpus') return { name: 'gpus' };
  if (path === '/settings' || path === '/admin')
    return { name: 'settings', ...(params.get('section') ? { section: params.get('section')! } : {}) };
  return { name: 'home' };
}
export function routePath(route: Route) {
  switch (route.name) {
    case 'home':
      return '/';
    case 'projects':
      return '/projects';
    case 'project': {
      const q = new URLSearchParams();
      if (route.view === 'results') q.set('view', 'results');
      if (route.focus) q.set('focus', route.focus);
      return '/projects/' + route.id + (q.size ? '?' + q : '');
    }
    case 'library':
      return (
        '/library' +
        (route.collection
          ? '?collection=' + encodeURIComponent(route.collection)
          : route.project
            ? '?project=' + encodeURIComponent(route.project)
            : '')
      );
    case 'gpus':
      return '/gpus';
    case 'settings':
      return '/settings' + (route.section ? '?section=' + route.section : '');
  }
}
export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  useEffect(() => {
    const change = () => setRoute(parseRoute());
    addEventListener('popstate', change);
    return () => removeEventListener('popstate', change);
  }, []);
  const go = useCallback((next: Route, replace = false) => {
    const path = routePath(next);
    if (path !== location.pathname + location.search)
      (replace ? history.replaceState : history.pushState).call(history, null, '', path);
    setRoute(next);
  }, []);
  return { route, go };
}

/* ---------- Content mode (standard or spicy), kept per tab as before ---------- */
export type Mode = 'sfw' | 'nsfw';
export function useModeState() {
  const [mode, set] = useState<Mode>(() => {
    try {
      return sessionStorage.getItem('seed.spicy') === 'true' ? 'nsfw' : 'sfw';
    } catch {
      return 'sfw';
    }
  });
  const setMode = useCallback((value: Mode) => {
    set(value);
    try {
      sessionStorage.setItem('seed.spicy', String(value === 'nsfw'));
    } catch {
      /* memory only */
    }
  }, []);
  return { mode, setMode };
}

/* ---------- Polling helper ---------- */
function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, interval: number, deps: unknown[]) {
  const [state, setState] = useState<{ value?: T; error?: string; loaded: boolean }>({ loaded: false });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let running = false,
      timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (running) return;
      running = true;
      try {
        const value = await load(controller.signal);
        if (!controller.signal.aborted) setState({ value, loaded: true });
      } catch (error) {
        if (!controller.signal.aborted) setState(s => ({ ...s, loaded: true, error: (error as Error).message }));
      } finally {
        running = false;
        if (!controller.signal.aborted) timer = setTimeout(read, document.hidden ? interval * 4 : interval);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, refresh };
}

export function useProjectList(mode: Mode) {
  const result = usePoll(() => projects.list(mode), 2500, [mode]);
  return { items: result.value ?? [], loaded: result.loaded, error: result.error, refresh: result.refresh };
}
export function usePoolSnapshot() {
  const result = usePoll(signal => poolApi.snapshot(signal), 2000, []);
  return { snapshot: result.value ?? null, error: result.error, refresh: result.refresh };
}
export function useTasks(mode: Mode) {
  const result = usePoll(() => jobsApi.list(mode), 3000, [mode]);
  return { jobs: result.value ?? [], loaded: result.value !== undefined, refresh: result.refresh };
}

/* ---------- Projects: one shared copy of each, kept live ---------- */
type Held = { project: Project | null; error: string };
const held = new Map<string, Held>(),
  watchers = new Set<() => void>(),
  none: Held = { project: null, error: '' };
const hold = (id: string, next: Held) => {
  held.set(id, next);
  watchers.forEach(w => w());
};
const watch = (w: () => void) => (watchers.add(w), () => void watchers.delete(w));
/** The newest copy of a project, for actions that must send against it. */
export const currentProject = (id: string) => held.get(id)?.project ?? null;
/** Takes a project from any response. Responses can arrive out of order, so an older copy never replaces a newer one. */
export function putProject(value: Project) {
  const now = currentProject(value.id);
  if (now?.as_of && value.as_of && value.as_of < now.as_of) return;
  hold(value.id, { project: value, error: '' });
}
/** One read of a project at a time; asks made meanwhile become one more read after it. */
const reading = new Map<string, { again: boolean }>();
export async function reloadProject(id: string) {
  const busy = reading.get(id);
  if (busy) return void (busy.again = true);
  const read = { again: false };
  reading.set(id, read);
  try {
    putProject(await projects.get(id));
  } catch (e) {
    hold(id, { ...(held.get(id) ?? none), error: (e as Error).message });
  } finally {
    reading.delete(id);
    if (read.again) void reloadProject(id);
  }
}
/** The project's chat stream reports replies as they are written, saves, and job progress (as `{ jobs: true }`). */
export function useProject(id: string | null) {
  const value = useSyncExternalStore(watch, () => (id && held.get(id)) || none);
  useEffect(() => {
    if (!id) return;
    let pending: ReturnType<typeof setTimeout> | undefined, activity: string | undefined;
    const later = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void reloadProject(id), 120);
    };
    const stream = new EventSource('/api/v1/chats/' + id + '/events');
    stream.onmessage = event => {
      const value = JSON.parse(event.data),
        p = currentProject(id);
      if (value.jobs) return later();
      const message = value.stream_message;
      if (message && p)
        hold(id, {
          project: {
            ...p,
            as_of: value.as_of > (p.as_of ?? '') ? value.as_of : p.as_of,
            activity: value.activity ?? p.activity,
            messages: p.messages.some(m => m.id === message.id)
              ? p.messages.map(m => (m.id === message.id ? message : m))
              : [...p.messages, message],
          },
          error: '',
        });
      // Saves during a turn keep the same version, so a change of activity also means "read the whole project again".
      if (
        (typeof value.version === 'number' && value.version !== p?.version) ||
        value.activity !== activity ||
        (message?.transcript?.state && message.transcript.state !== 'running')
      )
        later();
      activity = value.activity;
    };
    stream.onopen = () => void reloadProject(id);
    return () => {
      stream.close();
      clearTimeout(pending);
    };
  }, [id]);
  return value;
}
/** The owner plans to deliver this project at this shape: results show its guides and Crop starts there. */
export async function chooseFrame(id: string, frame: string) {
  const p = currentProject(id) ?? (await projects.get(id));
  if (p.frame !== frame) putProject(await projects.setFrame(p, frame));
}

/** A change made in one part of the app that another part, with no shared parent, must see. */
function signal<T = void>() {
  const watchers = new Set<(value: T) => void>();
  return {
    send: (value: T) => watchers.forEach(w => w(value)),
    useHear(hear: (value: T) => void, deps: unknown[]) {
      useEffect(() => {
        watchers.add(hear);
        return () => void watchers.delete(hear);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
    },
  };
}
/** A result's collections changed (in its Details). */
export const collectionsChanged = signal();
/** One open editor saved an asset's note; the others take its text and revision. */
export const noteSaved = signal<{ asset: string; note: { note: string; revision: number } }>();
/** The list of styles may have changed (Settings, or another tab). */
export const stylesChanged = signal();

/* ---------- Library ---------- */
/** Re-reads after any asset change made here. `live`: a value that changes whenever the list may have otherwise
 * (new takes); given one, the list re-reads then instead of polling. */
export function useAssets(query: AssetQuery | null, live?: unknown) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<{
    items: LibraryAsset[];
    cursor: string | null;
    loaded: boolean;
    loading: boolean;
    error?: string;
  }>({ items: [], cursor: null, loaded: false, loading: false });
  const [tick, setTick] = useState(0);
  const expanded = useRef(false);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => onAssetsChanged(refresh), [refresh]);
  useEffect(() => {
    expanded.current = false;
    setState({ items: [], cursor: null, loaded: false, loading: false });
  }, [key]);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const page = await assetsApi.list(query, controller.signal);
        if (controller.signal.aborted) return;
        setState(s => ({
          ...s,
          loaded: true,
          error: undefined,
          items: expanded.current
            ? [...page.items, ...s.items.filter(a => !page.items.some(b => b.id === a.id))]
            : page.items,
          cursor: expanded.current ? s.cursor : page.next_cursor,
        }));
      } catch (e) {
        if (!controller.signal.aborted) setState(s => ({ ...s, loaded: true, error: (e as Error).message }));
      }
      if (!controller.signal.aborted && live === undefined) timer = setTimeout(read, document.hidden ? 15000 : 4000);
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, live]);
  const more = useCallback(async () => {
    if (!query || !state.cursor || state.loading) return;
    setState(s => ({ ...s, loading: true }));
    try {
      const page = await assetsApi.list({ ...query, cursor: state.cursor });
      expanded.current = true;
      setState(s => ({
        ...s,
        loading: false,
        items: [...s.items, ...page.items.filter(a => !s.items.some(b => b.id === a.id))],
        cursor: page.next_cursor,
      }));
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, [key, state.cursor, state.loading]);
  const remove = useCallback((id: string) => setState(s => ({ ...s, items: s.items.filter(a => a.id !== id) })), []);
  const patch = useCallback(
    (id: string, change: Partial<LibraryAsset>) =>
      setState(s => ({ ...s, items: s.items.map(a => (a.id === id ? { ...a, ...change } : a)) })),
    [],
  );
  return { ...state, more, refresh, remove, patch };
}

/* ---------- App-wide context ---------- */
export type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
/** `sequence`: part of a play-in-order run, so the viewer moves to the next clip when one ends. */
export type ViewerItem = {
  asset: string;
  kind: 'image' | 'video' | 'audio';
  title: string;
  job?: JobRecord;
  project?: string;
  sequence?: boolean;
};
export type AppContextValue = {
  route: Route;
  go: (r: Route, replace?: boolean) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  pool: PoolSnapshot | null;
  refreshPool: () => void;
  tasks: JobRecord[];
  refreshTasks: () => void;
  projectList: ProjectSummary[];
  refreshProjects: () => void;
  toast: (text: string, action?: Toast['action']) => void;
  openStatus: (tab?: 'tasks' | 'gpus') => void;
  inspect: (item: ViewerItem | null, siblings?: ViewerItem[]) => void;
  syncSiblings: (list: ViewerItem[]) => void;
  view: (item: ViewerItem, siblings?: ViewerItem[]) => void;
  compare: (a: ViewerItem, b: ViewerItem) => void;
  /** Hand a result to the composer of its project (Refine, Animate, Use as input). */
  useResult: (item: ViewerItem, intent: 'refine' | 'animate' | 'input' | 'more' | 'reuse' | 'check') => void;
  pendingUse: {
    item: ViewerItem;
    intent: 'refine' | 'animate' | 'input' | 'more' | 'reuse' | 'check';
    nonce: number;
  } | null;
  clearPendingUse: () => void;
  wide: boolean;
  narrow: boolean;
  /** Room for the conversation and the project board side by side. */ split: boolean;
};
export const AppContext = createContext<AppContextValue | null>(null);
export const useApp = () => {
  const value = useContext(AppContext);
  if (!value) throw Error('Seed app context is missing.');
  return value;
};

export function useViewport() {
  const read = () => ({ wide: innerWidth >= 1100, narrow: innerWidth < 700, split: innerWidth >= 1280 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(read());
    addEventListener('resize', update);
    return () => removeEventListener('resize', update);
  }, []);
  return size;
}

/* ---------- Small helpers ---------- */
export function useNow(interval = 1000, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval, active]);
  return now;
}
export function useStoredState<T>(key: string, initial: T) {
  const [value, set] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      set(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* memory only */
      }
    },
    [key],
  );
  return [value, update] as const;
}
