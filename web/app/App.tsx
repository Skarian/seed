import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext, useApp, useModeState, usePoolSnapshot, useProjectList, useRouter, useTasks, useViewport, useStoredState, type AppContextValue, type Toast, type ViewerItem } from './data.js';
import { projects as projectsApi } from './api.js';
import { Icon } from './icons.js';
import { rate } from './format.js';
import { jobActive } from '../../shared/jobs.js';
import { ProjectPage } from './project/ProjectPage.js';
import { LibraryPage } from './library/LibraryPage.js';
import { GpusPage } from './gpus/GpusPage.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { StatusPanel } from './status/StatusPanel.js';
import { Viewer, Compare, Inspector } from './viewer/Viewer.js';
import { ProjectsList } from './project/ProjectsList.js';

export function App() {
  const { route, go } = useRouter();
  const { mode, setMode } = useModeState();
  const { wide, narrow } = useViewport();
  const pool = usePoolSnapshot();
  const tasks = useTasks(mode);
  const list = useProjectList(mode);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [status, setStatus] = useState<null | 'tasks' | 'gpus'>(null);
  const [inspected, setInspected] = useState<{ item: ViewerItem; siblings: ViewerItem[] } | null>(null);
  const [viewing, setViewing] = useState<{ item: ViewerItem; siblings: ViewerItem[]; opener: Element | null } | null>(null);
  const [comparing, setComparing] = useState<{ a: ViewerItem; b: ViewerItem } | null>(null);
  const [pendingUse, setPendingUse] = useState<AppContextValue['pendingUse']>(null);
  const [lastProject, setLastProject] = useStoredState<string>('seed.lastProject.' + mode, '');
  const toastId = useRef(0);
  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 6000 : 3200);
  }, []);
  // Completion notices for work in other projects; never steals navigation.
  const finished = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!tasks.loaded) return;
    const done = new Set(tasks.jobs.filter(j => j.state === 'completed').map(j => j.id));
    if (finished.current) {
      const fresh = tasks.jobs.filter(j => done.has(j.id) && !finished.current!.has(j.id));
      const elsewhere = fresh.filter(j => !(route.name === 'project' && j.source?.chat_id === route.id));
      if (elsewhere.length) {
        const chat = elsewhere[0]!.source?.chat_id, title = list.items.find(p => p.id === chat)?.title;
        toast(`${elsewhere.length} ${elsewhere.length === 1 ? 'result' : 'results'} done${title ? ' · ' + title : ''}`, chat ? { label: 'Show', run: () => go({ name: 'project', id: chat, view: 'conversation' }) } : undefined);
      }
    }
    finished.current = done;
  }, [tasks.jobs]);
  useEffect(() => { if (route.name === 'project') setLastProject(route.id); }, [route]);
  useEffect(() => { setInspected(null); }, [route.name, route.name === 'project' ? route.id : '']);

  // Home: the most recent project on larger screens; the project list on phones.
  useEffect(() => {
    if (route.name !== 'home' || !list.loaded) return;
    if (narrow) { go({ name: 'projects' }, true); return; }
    const recent = list.items.find(p => p.id === lastProject) ?? list.items[0];
    if (recent) go({ name: 'project', id: recent.id, view: 'conversation' }, true);
    else void projectsApi.create(mode).then(p => { list.refresh(); go({ name: 'project', id: p.id, view: 'conversation' }, true); });
  }, [route.name, list.loaded, narrow]);
  useEffect(() => { if (route.name === 'projects' && !narrow) go({ name: 'home' }, true); }, [route.name, narrow]);

  const value: AppContextValue = {
    route, go, mode, setMode,
    pool: pool.snapshot, refreshPool: pool.refresh,
    tasks: tasks.jobs, refreshTasks: tasks.refresh,
    projectList: list.items, refreshProjects: list.refresh,
    toast,
    openStatus: tab => setStatus(tab ?? 'tasks'),
    inspect: (item, siblings = []) => item ? (wide ? setInspected({ item, siblings }) : setViewing({ item, siblings, opener: document.activeElement })) : setInspected(null),
    view: (item, siblings = []) => setViewing({ item, siblings, opener: document.activeElement }),
    compare: (a, b) => setComparing({ a, b }),
    useResult: (item, intent) => {
      setViewing(null); setComparing(null);
      setPendingUse({ item, intent, nonce: Date.now() });
      if (item.project && !(route.name === 'project' && route.id === item.project)) go({ name: 'project', id: item.project, view: 'conversation' });
      else if (route.name === 'project' && route.view !== 'conversation') go({ ...route, view: 'conversation' });
      else if (route.name !== 'project') { const target = lastProject || list.items[0]?.id; if (target) go({ name: 'project', id: target, view: 'conversation' }); }
    },
    pendingUse, clearPendingUse: () => setPendingUse(null),
    wide, narrow,
  };
  const top = route.name !== 'project';
  return <AppContext.Provider value={value}>
    <div className={`shell ${top ? 'top' : ''} ${inspected && wide ? 'with-inspector' : ''}`}>
      <Rail />
      <div className="main">
        {route.name === 'project' && <ProjectPage key={route.id} id={route.id} view={route.view} focus={route.focus} />}
        {route.name === 'projects' && <ProjectsList />}
        {route.name === 'home' && <div className="scroll" aria-busy="true" />}
        {route.name === 'library' && <LibraryPage />}
        {route.name === 'gpus' && <GpusPage />}
        {route.name === 'settings' && <SettingsPage section={route.section} />}
        {top && <TabBar />}
      </div>
      {inspected && wide && <Inspector item={inspected.item} siblings={inspected.siblings} onClose={() => setInspected(null)} onPick={item => setInspected(s => s && { ...s, item })} />}
    </div>
    {status && <StatusPanel tab={status} onTab={setStatus} onClose={() => setStatus(null)} />}
    {viewing && <Viewer item={viewing.item} siblings={viewing.siblings} onPick={item => setViewing(v => v && { ...v, item })} onClose={() => { const opener = viewing.opener as HTMLElement | null; setViewing(null); requestAnimationFrame(() => opener?.focus?.()); }} />}
    {comparing && <Compare a={comparing.a} b={comparing.b} onClose={() => setComparing(null)} />}
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(t => <div className="toast" key={t.id}>{t.text}{t.action && <button className="btn small" onClick={() => { t.action!.run(); setToasts(x => x.filter(y => y.id !== t.id)); }}>{t.action.label}</button>}</div>)}
    </div>
  </AppContext.Provider>;
}

/** The status control: active work and the running rental rate, in every header. */
export function StatusControl() {
  const { tasks, pool, openStatus } = useApp();
  const making = tasks.filter(jobActive).length;
  const hourly = pool?.summary.hourly ?? 0, attention = (pool?.summary.needs_attention ?? 0) + tasks.filter(j => ['failed', 'needs_attention'].includes(j.state) && !j.uncertainty_acknowledged && Date.now() - Date.parse(j.updated_at) < 3600_000).length;
  const label = [making ? making + ' making' : '', hourly ? rate(hourly) + ' GPU' : ''].filter(Boolean).join(', ') || 'Nothing running';
  return <button className="status" onClick={() => openStatus(making || !hourly ? 'tasks' : 'gpus')} aria-label={'Activity and GPUs: ' + label} aria-haspopup="dialog">
    <span className={`dot ${making ? 'live' : attention ? 'amber' : hourly ? '' : 'off'}`} />
    <span className={making ? '' : 'label'}>{making ? making + ' making' : attention ? 'Needs you' : hourly ? 'GPU on' : 'Idle'}</span>
    {hourly > 0 && <span className="rate">· {rate(hourly)}</span>}
  </button>;
}

function Rail() {
  const { route, go, projectList, mode, refreshProjects, pool, tasks } = useApp();
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState(false);
  const shown = useMemo(() => projectList.filter(p => p.title.toLowerCase().includes(query.trim().toLowerCase())), [projectList, query]);
  const activeChats = new Set(tasks.filter(jobActive).map(j => j.source?.chat_id));
  async function create() { const p = await projectsApi.create(mode); refreshProjects(); go({ name: 'project', id: p.id, view: 'conversation' }); }
  const hourly = pool?.summary.hourly ?? 0, active = pool?.summary.active ?? 0;
  return <nav className="rail" aria-label="Seed">
    <div className="brand serif"><Icon.Seed /><span>seed</span></div>
    <button className="nav new" onClick={() => void create()} title="New project"><Icon.Plus /><span className="txt">New project</span></button>
    <button className="nav tablet-only" aria-current={route.name === 'project' ? 'page' : undefined} title="Projects" aria-expanded={drawer} onClick={() => setDrawer(true)}><Icon.Projects /><span className="txt">Projects</span></button>
    <div className="section">Projects</div>
    {projectList.length > 6 && <div className="search"><label className="search-box"><Icon.Search /><input placeholder="Find a project" aria-label="Find a project" value={query} onChange={e => setQuery(e.target.value)} /></label></div>}
    <div className="projects">
      {shown.map(p => <button key={p.id} className="nav" aria-current={route.name === 'project' && route.id === p.id ? 'page' : undefined} onClick={() => go({ name: 'project', id: p.id, view: 'conversation' })} title={p.title}>
        <span className="txt">{p.title}</span>
        {activeChats.has(p.id) || p.activity !== 'idle' ? <span className="dot live" aria-label="Working" /> : p.status === 'Failed' ? <span className="dot red" aria-label="Has a failed result" /> : null}
      </button>)}
      {!shown.length && query && <p className="faint" style={{ padding: '6px 10px', margin: 0, fontSize: 13 }}>No project titles match.</p>}
    </div>
    {drawer && <div className="backdrop drawer" onClick={() => setDrawer(false)} onKeyDown={e => e.key === 'Escape' && setDrawer(false)}>
      <div className="drawer-panel" role="dialog" aria-label="Projects" onClick={e => e.stopPropagation()}>
        <div className="dialog-head"><h2>Projects</h2><button className="icon-btn" aria-label="Close" onClick={() => setDrawer(false)} autoFocus><Icon.Close /></button></div>
        <ProjectsList compact onChosen={() => setDrawer(false)} />
      </div>
    </div>}
    <button className="nav" aria-current={route.name === 'library' ? 'page' : undefined} onClick={() => go({ name: 'library' })} title="Library"><Icon.Library /><span className="txt">Library</span></button>
    <div className="spacer" />
    <div className="foot">
      <button className="nav" aria-current={route.name === 'gpus' ? 'page' : undefined} onClick={() => go({ name: 'gpus' })} title="GPUs"><Icon.Gpu /><span className="txt">GPUs{active ? ` · ${active} on · ${rate(hourly)}` : ''}</span></button>
      <button className="nav" aria-current={route.name === 'settings' ? 'page' : undefined} onClick={() => go({ name: 'settings' })} title="Settings"><Icon.Settings /><span className="txt">Settings</span></button>
    </div>
  </nav>;
}
function TabBar() {
  const { route, go } = useApp();
  const tabs = [['projects', 'Projects', Icon.Projects], ['library', 'Library', Icon.Library], ['gpus', 'GPUs', Icon.Gpu], ['settings', 'Settings', Icon.Settings]] as const;
  return <nav className="tabbar" aria-label="Seed">
    {tabs.map(([name, label, I]) => <button key={name} aria-current={route.name === name ? 'page' : undefined} onClick={() => go({ name } as never)}><I />{label}</button>)}
  </nav>;
}
