import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react';
import { projects, pool as poolApi, jobs as jobsApi, assets as assetsApi, type Project, type ProjectSummary, type PoolSnapshot, type JobRecord, type LibraryAsset, type AssetQuery } from './api.js';
import { jobActive } from '../../shared/jobs.js';

/* ---------- Routing ---------- */
export type Route =
  | { name: 'home' }
  | { name: 'projects' }
  | { name: 'project'; id: string; view: 'conversation' | 'results'; focus?: string }
  | { name: 'library' }
  | { name: 'gpus' }
  | { name: 'settings'; section?: string };

export function parseRoute(loc: { pathname: string; search: string } = location): Route {
  const params = new URLSearchParams(loc.search), path = loc.pathname.replace(/\/+$/, '') || '/';
  const project = path.match(/^\/projects\/([\w-]+)$/);
  if (project) return { name: 'project', id: project[1]!, view: params.get('view') === 'results' ? 'results' : 'conversation', ...(params.get('focus') ? { focus: params.get('focus')! } : {}) };
  if (path === '/chat' && params.get('chat')) return { name: 'project', id: params.get('chat')!, view: 'conversation' };
  if (path === '/projects' || path === '/chat') return { name: 'projects' };
  if (path === '/library') return { name: 'library' };
  if (path === '/gpus') return { name: 'gpus' };
  if (path === '/settings' || path === '/admin') return { name: 'settings', ...(params.get('section') ? { section: params.get('section')! } : {}) };
  return { name: 'home' };
}
export function routePath(route: Route) {
  switch (route.name) {
    case 'home': return '/';
    case 'projects': return '/projects';
    case 'project': { const q = new URLSearchParams(); if (route.view === 'results') q.set('view', 'results'); if (route.focus) q.set('focus', route.focus); return '/projects/' + route.id + (q.size ? '?' + q : ''); }
    case 'library': return '/library';
    case 'gpus': return '/gpus';
    case 'settings': return '/settings' + (route.section ? '?section=' + route.section : '');
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
    if (path !== location.pathname + location.search) (replace ? history.replaceState : history.pushState).call(history, null, '', path);
    setRoute(next);
  }, []);
  return { route, go };
}

/* ---------- Content mode (standard or spicy), kept per tab as before ---------- */
export type Mode = 'sfw' | 'nsfw';
export function useModeState() {
  const [mode, set] = useState<Mode>(() => { try { return sessionStorage.getItem('seed.spicy') === 'true' ? 'nsfw' : 'sfw'; } catch { return 'sfw'; } });
  const setMode = useCallback((value: Mode) => { set(value); try { sessionStorage.setItem('seed.spicy', String(value === 'nsfw')); } catch { /* memory only */ } }, []);
  return { mode, setMode };
}

/* ---------- Polling helper ---------- */
function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, interval: number, deps: unknown[]) {
  const [state, setState] = useState<{ value?: T; error?: string; loaded: boolean }>({ loaded: false });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let running = false, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (running) return; running = true;
      try { const value = await load(controller.signal); if (!controller.signal.aborted) setState({ value, loaded: true }); }
      catch (error) { if (!controller.signal.aborted) setState(s => ({ ...s, loaded: true, error: (error as Error).message })); }
      finally { running = false; if (!controller.signal.aborted) timer = setTimeout(read, document.hidden ? interval * 4 : interval); }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
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

/* ---------- One project, live ---------- */
type Live = { partial?: string; partial_reasoning?: string; activity?: Project['activity']; error?: string | null };
export function useProject(id: string | null) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState<Live>({});
  const version = useRef(-1), seen = useRef(0), current = useRef(id), pending = useRef<ReturnType<typeof setTimeout>>(undefined), lastActivity = useRef<string | undefined>(undefined);
  current.current = id;
  const accept = useCallback((value: Project) => {
    if (value.id !== current.current) return;
    // Responses can arrive out of order (a background read started before a send). Never go back in time.
    const at = Date.parse(value.updated_at) || 0;
    if (value.version < version.current || (value.version === version.current && at < seen.current)) return;
    version.current = value.version; seen.current = at; setProject(value); setError('');
  }, []);
  const reload = useCallback(async () => {
    const target = current.current; if (!target) return;
    try { const value = await projects.get(target); if (target === current.current) accept(value); }
    catch (e) { if (target === current.current) setError((e as Error).message); }
  }, [accept]);
  useEffect(() => {
    setProject(null); setLive({}); setError(''); version.current = -1; seen.current = 0;
    if (!id) return;
    let closed = false;
    void reload();
    const stream = new EventSource('/api/v1/chats/' + id + '/events');
    stream.onmessage = event => {
      if (closed) return;
      const value = JSON.parse(event.data);
      setLive({ partial: value.partial, partial_reasoning: value.partial_reasoning, activity: value.activity, error: value.error });
      if (value.stream_message) setProject(p => p && p.id === id ? { ...p, activity: value.activity ?? p.activity, messages: p.messages.some(m => m.id === value.stream_message.id) ? p.messages.map(m => m.id === value.stream_message.id ? value.stream_message : m) : [...p.messages, value.stream_message] } : p);
      // Saves during a turn keep the same version, so a change of activity also means "read the whole project again".
      const changed = (typeof value.version === 'number' && value.version !== version.current) || value.activity !== lastActivity.current || (value.stream_message?.transcript?.state && value.stream_message.transcript.state !== 'running');
      lastActivity.current = value.activity;
      if (changed) { clearTimeout(pending.current); pending.current = setTimeout(() => void reload(), 120); }
    };
    stream.onopen = () => void reload();
    // Job progress is not part of the chat stream, so refresh while anything renders.
    const timer = setInterval(() => { setProject(p => { if (p && (p.jobs.some(jobActive) || p.activity !== 'idle')) void reload(); return p; }); }, 1500);
    return () => { closed = true; stream.close(); clearInterval(timer); clearTimeout(pending.current); };
  }, [id, reload]);
  return { project, setProject: accept, reload, live, error };
}

/* ---------- Library ---------- */
export function useAssets(query: AssetQuery | null) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<{ items: LibraryAsset[]; cursor: string | null; loaded: boolean; loading: boolean; error?: string }>({ items: [], cursor: null, loaded: false, loading: false });
  const [tick, setTick] = useState(0);
  const expanded = useRef(false);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => { expanded.current = false; setState({ items: [], cursor: null, loaded: false, loading: false }); }, [key]);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const page = await assetsApi.list(query, controller.signal);
        if (controller.signal.aborted) return;
        setState(s => ({ ...s, loaded: true, error: undefined, items: expanded.current ? [...page.items, ...s.items.filter(a => !page.items.some(b => b.id === a.id))] : page.items, cursor: expanded.current ? s.cursor : page.next_cursor }));
      } catch (e) { if (!controller.signal.aborted) setState(s => ({ ...s, loaded: true, error: (e as Error).message })); }
      if (!controller.signal.aborted) timer = setTimeout(read, document.hidden ? 15000 : 4000);
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const more = useCallback(async () => {
    if (!query || !state.cursor || state.loading) return;
    setState(s => ({ ...s, loading: true }));
    try {
      const page = await assetsApi.list({ ...query, cursor: state.cursor });
      expanded.current = true;
      setState(s => ({ ...s, loading: false, items: [...s.items, ...page.items.filter(a => !s.items.some(b => b.id === a.id))], cursor: page.next_cursor }));
    } catch (e) { setState(s => ({ ...s, loading: false, error: (e as Error).message })); }
  }, [key, state.cursor, state.loading]);
  const remove = useCallback((id: string) => setState(s => ({ ...s, items: s.items.filter(a => a.id !== id) })), []);
  const patch = useCallback((id: string, change: Partial<LibraryAsset>) => setState(s => ({ ...s, items: s.items.map(a => a.id === id ? { ...a, ...change } : a) })), []);
  return { ...state, more, refresh, remove, patch };
}

/* ---------- App-wide context ---------- */
export type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
export type ViewerItem = { asset: string; kind: 'image' | 'video' | 'audio'; title: string; job?: JobRecord; project?: string };
export type AppContextValue = {
  route: Route; go: (r: Route, replace?: boolean) => void;
  mode: Mode; setMode: (m: Mode) => void;
  pool: PoolSnapshot | null; refreshPool: () => void;
  tasks: JobRecord[]; refreshTasks: () => void;
  projectList: ProjectSummary[]; refreshProjects: () => void;
  toast: (text: string, action?: Toast['action']) => void;
  openStatus: (tab?: 'tasks' | 'gpus') => void;
  inspect: (item: ViewerItem | null, siblings?: ViewerItem[]) => void;
  view: (item: ViewerItem, siblings?: ViewerItem[]) => void;
  compare: (a: ViewerItem, b: ViewerItem) => void;
  /** Hand a result to the composer of its project (Refine, Animate, Use as input). */
  useResult: (item: ViewerItem, intent: 'refine' | 'animate' | 'input') => void;
  pendingUse: { item: ViewerItem; intent: 'refine' | 'animate' | 'input'; nonce: number } | null;
  clearPendingUse: () => void;
  wide: boolean; narrow: boolean;
};
export const AppContext = createContext<AppContextValue | null>(null);
export const useApp = () => { const value = useContext(AppContext); if (!value) throw Error('Seed app context is missing.'); return value; };

export function useViewport() {
  const read = () => ({ wide: innerWidth >= 1100, narrow: innerWidth < 700 });
  const [size, setSize] = useState(read);
  useEffect(() => { const update = () => setSize(read()); addEventListener('resize', update); return () => removeEventListener('resize', update); }, []);
  return size;
}

/* ---------- Small helpers ---------- */
export function useNow(interval = 1000, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(t); }, [interval, active]);
  return now;
}
export function useStoredState<T>(key: string, initial: T) {
  const [value, set] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw === null ? initial : JSON.parse(raw); } catch { return initial; } });
  const update = useCallback((next: T) => { set(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ } }, [key]);
  return [value, update] as const;
}
