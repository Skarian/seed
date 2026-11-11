import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppContext,
  useApp,
  useModeState,
  usePoolSnapshot,
  useProjectList,
  useRouter,
  useTasks,
  useViewport,
  useStoredState,
  type AppContextValue,
  type Toast,
  type ViewerItem,
} from './data.js';
import { projects as projectsApi } from './api.js';
import { Icon } from './icons.js';
import { rate } from './format.js';
import { jobActive, jobNeedsAttention, jobPhase, type JobRecord } from '../../shared/jobs.js';
import { approvedReferences } from '../../shared/choices.js';
import { ProjectPage } from './project/ProjectPage.js';
import { LibraryPage } from './library/LibraryPage.js';
import { GpusPage } from './gpus/GpusPage.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { StatusPanel } from './status/StatusPanel.js';
import { Viewer, Inspector } from './viewer/Viewer.js';
import { Compare } from './viewer/Compare.js';
import { ProjectsList } from './project/ProjectsList.js';
import { Dialog, Overlay } from './ui.js';

export function App() {
  const { route, go } = useRouter();
  const { mode, setMode } = useModeState();
  const { wide, narrow, split } = useViewport();
  const pool = usePoolSnapshot();
  const tasks = useTasks(mode);
  const list = useProjectList(mode);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [status, setStatus] = useState<null | 'tasks' | 'gpus'>(null);
  const [inspected, setInspected] = useState<{ item: ViewerItem; siblings: ViewerItem[] } | null>(null);
  const [viewing, setViewing] = useState<{ item: ViewerItem; siblings: ViewerItem[]; opener: Element | null } | null>(
    null,
  );
  const [comparing, setComparing] = useState<{ a: ViewerItem; b: ViewerItem; opener?: Element | null } | null>(null);
  const [pendingUse, setPendingUse] = useState<AppContextValue['pendingUse']>(null);
  const [destination, setDestination] = useState<{
    item: ViewerItem;
    intent: NonNullable<AppContextValue['pendingUse']>['intent'];
  } | null>(null);
  const [lastProject, setLastProject] = useStoredState<string>('seed.lastProject.' + mode, '');
  const toastId = useRef(0);
  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = ++toastId.current;
    // One notice at a time: a newer one replaces it, so notices never stack over the page.
    setToasts([{ id, text, action }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 6000 : 3200);
  }, []);
  // Completion notices for work in other projects; never steals navigation. Inside a project they stay quiet (the
  // status pill counts work elsewhere), so a toast never covers the composer or the plan you are deciding on.
  const finished = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!tasks.loaded) return;
    const done = new Set(tasks.jobs.filter(j => jobPhase(j) === 'completed').map(j => j.id));
    if (finished.current) {
      const fresh = tasks.jobs.filter(j => done.has(j.id) && !finished.current!.has(j.id));
      const elsewhere = fresh.filter(j => !(route.name === 'project' && j.source?.chat_id === route.id));
      if (elsewhere.length && route.name !== 'project') {
        const chat = elsewhere[0]!.source?.chat_id,
          title = list.items.find(p => p.id === chat)?.title;
        toast(
          `${elsewhere.length} ${elsewhere.length === 1 ? 'result' : 'results'} done${title ? ' · ' + title : ''}`,
          chat ? { label: 'Show', run: () => go({ name: 'project', id: chat, view: 'conversation' }) } : undefined,
        );
      }
    }
    finished.current = done;
  }, [tasks.jobs, route, list.items]);
  useEffect(() => {
    if (route.name === 'project') setLastProject(route.id);
  }, [route]);
  useEffect(() => {
    setInspected(null);
  }, [route.name, route.name === 'project' ? route.id : '']);
  // Every page has its own title (tabs, history and screen readers say where you are).
  const projectTitle = route.name === 'project' ? list.items.find(p => p.id === route.id)?.title : undefined;
  useEffect(() => {
    const page =
      route.name === 'project'
        ? (projectTitle ?? 'Project') + (route.view === 'results' ? ' · Results' : '')
        : route.name === 'library'
          ? 'Library'
          : route.name === 'gpus'
            ? 'GPUs'
            : route.name === 'settings'
              ? 'Settings'
              : route.name === 'projects'
                ? 'Projects'
                : '';
    document.title = page ? `${page} · Seed` : 'Seed';
  }, [route, projectTitle]);

  // Home: the most recent project on larger screens; the project list on phones.
  useEffect(() => {
    if (route.name !== 'home' || !list.loaded) return;
    if (narrow) {
      go({ name: 'projects' }, true);
      return;
    }
    const recent = list.items.find(p => p.id === lastProject) ?? list.items[0];
    if (recent) go({ name: 'project', id: recent.id, view: 'conversation' }, true);
    else
      void projectsApi.create(mode).then(p => {
        list.refresh();
        go({ name: 'project', id: p.id, view: 'conversation' }, true);
      });
  }, [route.name, list.loaded, narrow]);
  useEffect(() => {
    if (route.name === 'projects' && !narrow) go({ name: 'home' }, true);
  }, [route.name, narrow]);

  const value: AppContextValue = {
    route,
    go,
    mode,
    setMode,
    pool: pool.snapshot,
    refreshPool: pool.refresh,
    tasks: tasks.jobs,
    refreshTasks: tasks.refresh,
    projectList: list.items,
    refreshProjects: list.refresh,
    toast,
    openStatus: tab => setStatus(tab ?? 'tasks'),
    inspect: (item, siblings = []) =>
      item
        ? wide
          ? setInspected({ item, siblings })
          : setViewing({ item, siblings, opener: document.activeElement })
        : setInspected(null),
    view: (item, siblings = []) => setViewing({ item, siblings, opener: document.activeElement }),
    // The list behind an open result changed (a search settled): browse only what is shown now.
    syncSiblings: list => {
      const fit = <T extends { item: ViewerItem; siblings: ViewerItem[] }>(s: T | null) =>
        s && { ...s, siblings: list.some(x => x.asset === s.item.asset) ? list : [s.item] };
      setInspected(fit);
      setViewing(fit);
    },
    compare: (a, b) => setComparing({ a, b, opener: document.activeElement }),
    useResult: (item, intent) => {
      setViewing(null);
      setComparing(null);
      // More like this and Reuse settings belong to the draft's own project.
      if (intent === 'more' || intent === 'reuse' || intent === 'check') {
        const home = item.job?.source?.chat_id ?? item.project;
        if (home) handTo(item, intent, home);
        return;
      }
      // Inside a project, a result goes to the project you are in. Elsewhere, ask where it should go.
      if (route.name === 'project') handTo(item, intent, route.id);
      else setDestination({ item, intent });
    },
    pendingUse,
    clearPendingUse: () => setPendingUse(null),
    wide,
    narrow,
    split,
  };
  function handTo(item: ViewerItem, intent: NonNullable<AppContextValue['pendingUse']>['intent'], projectId: string) {
    setPendingUse({ item: { ...item, project: projectId }, intent, nonce: Date.now() });
    if (!(route.name === 'project' && route.id === projectId && route.view === 'conversation'))
      go({ name: 'project', id: projectId, view: 'conversation' });
  }
  const top = route.name !== 'project';
  return (
    <AppContext.Provider value={value}>
      {/* First in the tab order on every page: straight to the message box in a project, else to the page. */}
      <button
        className="skip-link"
        onClick={() => {
          const box = document.querySelector<HTMLElement>('.composer textarea');
          const main = document.querySelector<HTMLElement>('main.main');
          if (box) box.focus();
          else if (main) {
            main.tabIndex = -1;
            main.focus();
          }
        }}
      >
        {route.name === 'project' ? 'Skip to the message box' : 'Skip to content'}
      </button>
      {route.name === 'project' && (
        <button
          className="skip-link"
          onClick={() => {
            // Straight to the open plan's Make button, past every result above it.
            const make = document.querySelector<HTMLElement>('.makebar button.btn');
            if (make) make.focus();
            else document.querySelector<HTMLElement>('.composer textarea')?.focus();
          }}
        >
          Skip to the plan
        </button>
      )}
      <div className={`shell ${top ? 'top' : ''} ${inspected && wide ? 'with-inspector' : ''}`}>
        <Rail />
        <main className="main">
          {route.name === 'project' && (
            <ProjectPage key={route.id} id={route.id} view={route.view} focus={route.focus} />
          )}
          {route.name === 'projects' && <ProjectsList />}
          {route.name === 'home' && <div className="scroll" aria-busy="true" />}
          {route.name === 'library' && <LibraryPage collection={route.collection} project={route.project} />}
          {route.name === 'gpus' && <GpusPage />}
          {route.name === 'settings' && <SettingsPage section={route.section} />}
          {top && <TabBar />}
        </main>
        {inspected && wide && (
          <Inspector
            item={inspected.item}
            siblings={inspected.siblings}
            onClose={() => setInspected(null)}
            onPick={item => setInspected(s => s && { ...s, item })}
          />
        )}
      </div>
      {status && <StatusPanel tab={status} onTab={setStatus} onClose={() => setStatus(null)} />}
      {viewing && (
        <Viewer
          item={viewing.item}
          siblings={viewing.siblings}
          onPick={item => setViewing(v => v && { ...v, item })}
          onClose={() => {
            const opener = viewing.opener as HTMLElement | null;
            const label = opener?.getAttribute('aria-label');
            setViewing(null);
            requestAnimationFrame(() => {
              // Live boards re-render their tiles: if the opener was replaced, focus the button with the same name.
              const target =
                opener?.isConnected || !label
                  ? opener
                  : document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`);
              target?.focus?.();
            });
          }}
        />
      )}
      {comparing && (
        <Compare
          a={comparing.a}
          b={comparing.b}
          onClose={() => {
            const opener = comparing.opener as HTMLElement | null;
            const label = opener?.getAttribute('aria-label');
            setComparing(null);
            // Focus goes back to what opened Compare, or to its replacement after a re-render.
            requestAnimationFrame(() =>
              (opener?.isConnected || !label
                ? opener
                : document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`)
              )?.focus?.(),
            );
          }}
        />
      )}
      {destination && (
        <Dialog
          title={
            {
              refine: 'Refine in which project?',
              check: 'Check in which project?',
              animate: 'Animate in which project?',
              input: 'Use in which project?',
              more: '',
              reuse: '',
            }[destination.intent]
          }
          onClose={() => setDestination(null)}
        >
          {[...new Set([lastProject, destination.item.project].filter((x): x is string => Boolean(x)))].map(pid => {
            const p = list.items.find(x => x.id === pid);
            return p ? (
              <button
                key={pid}
                className="option"
                onClick={() => {
                  setDestination(null);
                  handTo(destination.item, destination.intent, pid);
                }}
              >
                <span>
                  <b>{p.title}</b>
                  <small>
                    {pid === lastProject ? 'The project you were last working in' : 'Where this result was made'}
                    {pid === lastProject && pid === destination.item.project ? ' · where this result was made' : ''}
                  </small>
                </span>
              </button>
            ) : null;
          })}
          <button
            className="option"
            onClick={() => {
              const d = destination;
              setDestination(null);
              void projectsApi.create(mode).then(p => {
                list.refresh();
                handTo(d.item, d.intent, p.id);
              });
            }}
          >
            <span>
              <b>A new project</b>
              <small>Start fresh with this result attached</small>
            </span>
          </button>
          {destination.item.project && (
            <button
              className="option"
              onClick={() => {
                const d = destination,
                  from = destination.item.project!;
                setDestination(null);
                void (async () => {
                  let p = await projectsApi.create(mode);
                  const source = await projectsApi.get(from).catch(() => null);
                  if (source?.brief) p = await projectsApi.setBrief(p, source.brief);
                  // The cast's approved references come along, so new shots are drafted from the same pictures.
                  for (const [name, asset] of approvedReferences(source?.choices))
                    p = await projectsApi.choose(p.id, { reference: name, asset }).catch(() => p);
                  if (source?.title) p = await projectsApi.rename(p, source.title + ' · continued').catch(() => p);
                  list.refresh();
                  handTo(d.item, d.intent, p.id);
                })();
              }}
            >
              <span>
                <b>A new project with the same brief</b>
                <small>Its characters, places and look come along, and you can edit them there</small>
              </span>
            </button>
          )}
          <details>
            <summary className="faint">Another project</summary>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {list.items
                .filter(p => p.id !== lastProject && p.id !== destination.item.project)
                .map(p => (
                  <button
                    key={p.id}
                    className="option"
                    onClick={() => {
                      setDestination(null);
                      handTo(destination.item, destination.intent, p.id);
                    }}
                  >
                    <span>{p.title}</span>
                  </button>
                ))}
            </div>
          </details>
        </Dialog>
      )}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(t => (
          <div className="toast" key={t.id}>
            {t.text}
            {t.action && (
              <button
                className="btn small"
                onClick={() => {
                  t.action!.run();
                  setToasts(x => x.filter(y => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

/** Active work with nothing to show yet: queued, or starting or cancelling without progress. */
function waitingJob(job: JobRecord) {
  const phase = jobPhase(job);
  return phase === 'queued' || (!job.progress && phase !== 'running' && phase !== 'saving');
}

/** The status control: active work and the running rental rate, in every header. */
export function StatusControl() {
  const { tasks, pool, openStatus, projectList, route, narrow } = useApp();
  const active = tasks.filter(jobActive),
    waiting = active.filter(waitingJob).length,
    making = active.length - waiting;
  // Two lanes: Seed planning (agent replies) and making (renders on GPUs).
  const planningIn = projectList.filter(p => p.activity === 'thinking' || p.activity === 'preparing'),
    planning = planningIn.length;
  // Plans waiting for the person, in projects other than the one on screen.
  const ready = projectList.filter(p => p.ready_to_review && !(route.name === 'project' && route.id === p.id));
  const short = (t: string) => '“' + (t.length > 22 ? t.slice(0, 21) + '…' : t) + '”';
  const hourly = pool?.summary.hourly ?? 0,
    attention =
      (pool?.summary.needs_attention ?? 0) +
      tasks.filter(j => jobNeedsAttention(j) && Date.now() - Date.parse(j.updated_at) < 3600_000).length;
  // One state reads in full; several become short counts so the header never overflows. The panel has the details.
  const states = [planning, ready.length, making, waiting].filter(Boolean).length;
  let words =
    states > 1
      ? [
          planning ? `${planning} planning` : '',
          ready.length ? `${ready.length} to review` : '',
          making ? `${making} making` : '',
          waiting ? `${waiting} waiting` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : narrow && planning
        ? 'Planning'
        : narrow && ready.length
          ? `${ready.length} to review`
          : planning === 1
            ? 'Planning ' + short(planningIn[0]!.title)
            : planning
              ? `Seed planning in ${planning} projects`
              : ready.length === 1
                ? short(ready[0]!.title) + ' ready to review'
                : ready.length
                  ? ready.length + ' plans to review'
                  : making
                    ? making + ' making'
                    : waiting
                      ? waiting + (hourly ? ' queued' : ' waiting for a GPU')
                      : '';
  // Inside a project the pill speaks for that project first; work in other projects is one count beside it.
  const scoped = (() => {
    if (route.name !== 'project') return undefined;
    const here = active.filter(j => j.source?.chat_id === route.id);
    const hereWaiting = here.filter(waitingJob).length;
    const hereMaking = here.length - hereWaiting;
    const thinking = planningIn.some(p => p.id === route.id);
    const elsewhere = new Set([
      ...active.filter(j => j.source?.chat_id !== route.id).map(j => j.source?.chat_id ?? j.id),
      ...planningIn.filter(p => p.id !== route.id).map(p => p.id),
      ...ready.map(p => p.id),
    ]).size;
    const own = thinking
      ? 'Seed is planning'
      : hereMaking
        ? `Making ${hereMaking}`
        : hereWaiting
          ? `${hereWaiting} waiting`
          : '';
    const rest = elsewhere ? `+${elsewhere} elsewhere` : '';
    return [own, rest].filter(Boolean).join(' · ');
  })();
  if (scoped !== undefined) words = scoped;
  const label = [words, hourly ? rate(hourly) + ' GPU' : ''].filter(Boolean).join(', ') || 'Nothing running';
  return (
    <button
      className="status"
      onClick={() => openStatus(active.length || ready.length || planning || !hourly ? 'tasks' : 'gpus')}
      aria-label={'Activity and GPUs: ' + label}
      aria-haspopup="dialog"
    >
      <span
        className={`dot ${making || planning ? 'live' : ready.length ? 'amber' : waiting ? 'amber' : attention ? 'amber' : hourly ? '' : 'off'}`}
      />
      <span className={words ? '' : 'label'}>
        {words ||
          (attention
            ? 'Needs you'
            : hourly
              ? (pool?.workers ?? []).some(w => ['starting', 'preparing'].includes(w.state))
                ? 'GPU starting'
                : 'GPU ready'
              : 'Nothing running')}
      </span>
      {hourly > 0 && (
        <span className="rate">
          <span className="sep">· </span>
          {rate(hourly)}
        </span>
      )}
    </button>
  );
}

function Rail() {
  const { route, go, projectList, mode, refreshProjects, pool, tasks } = useApp();
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState(false);
  const shown = useMemo(
    () => projectList.filter(p => p.title.toLowerCase().includes(query.trim().toLowerCase())),
    [projectList, query],
  );
  const activeChats = new Set(tasks.filter(jobActive).map(j => j.source?.chat_id));
  async function create() {
    const p = await projectsApi.create(mode);
    refreshProjects();
    go({ name: 'project', id: p.id, view: 'conversation' });
  }
  const hourly = pool?.summary.hourly ?? 0,
    active = pool?.summary.active ?? 0;
  return (
    <nav className="rail" aria-label="Seed">
      <div className="brand serif">
        <Icon.Seed />
        <span>seed</span>
      </div>
      <button className="nav new" onClick={() => void create()} title="New project">
        <Icon.Plus />
        <span className="txt">New project</span>
      </button>
      <button
        className="nav tablet-only"
        aria-current={route.name === 'project' ? 'page' : undefined}
        title="Projects"
        aria-expanded={drawer}
        onClick={() => setDrawer(true)}
      >
        <Icon.Projects />
        <span className="txt">Projects</span>
      </button>
      <div className="section">Projects</div>
      {projectList.length > 6 && (
        <div className="search">
          <label className="search-box">
            <Icon.Search />
            <input
              placeholder="Find a project"
              aria-label="Find a project"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="projects">
        {shown.map(p => (
          <button
            key={p.id}
            className="nav"
            aria-current={route.name === 'project' && route.id === p.id ? 'page' : undefined}
            onClick={() => go({ name: 'project', id: p.id, view: 'conversation' })}
            title={p.title}
            aria-label={'Project: ' + p.title}
          >
            <span className="txt">{p.title}</span>
            {activeChats.has(p.id) || p.activity !== 'idle' ? (
              <span className="dot live" aria-label="Working" />
            ) : p.failed ? (
              <span className="dot red" aria-label="Has a failed result" />
            ) : null}
          </button>
        ))}
        {!shown.length && query && (
          <p className="faint" style={{ padding: '6px 10px', margin: 0, fontSize: '0.875rem' }}>
            No project titles match.
          </p>
        )}
      </div>
      {drawer && <ProjectsDrawer onClose={() => setDrawer(false)} />}
      <button
        className="nav"
        aria-current={route.name === 'library' ? 'page' : undefined}
        onClick={() => go({ name: 'library' })}
        title="Library"
      >
        <Icon.Library />
        <span className="txt">Library</span>
      </button>
      <div className="spacer" />
      <div className="foot">
        <button
          className="nav"
          aria-current={route.name === 'gpus' ? 'page' : undefined}
          onClick={() => go({ name: 'gpus' })}
          title="GPUs"
          aria-label="GPUs"
        >
          <Icon.Gpu />
          <span className="txt">
            GPUs
            <span className="no-tablet">
              {active
                ? ` · ${(pool?.workers ?? []).some(w => ['starting', 'preparing'].includes(w.state)) ? 'starting' : active + ' on'} · ${rate(hourly)}`
                : ''}
            </span>
          </span>
        </button>
        <button
          className="nav"
          aria-current={route.name === 'settings' ? 'page' : undefined}
          onClick={() => go({ name: 'settings' })}
          title="Settings"
        >
          <Icon.Settings />
          <span className="txt">Settings</span>
        </button>
      </div>
    </nav>
  );
}
function TabBar() {
  const { route, go } = useApp();
  const tabs = [
    ['projects', 'Projects', Icon.Projects],
    ['library', 'Library', Icon.Library],
    ['gpus', 'GPUs', Icon.Gpu],
    ['settings', 'Settings', Icon.Settings],
  ] as const;
  return (
    <nav className="tabbar" aria-label="Seed">
      {tabs.map(([name, label, I]) => (
        <button
          key={name}
          aria-current={route.name === name ? 'page' : undefined}
          onClick={() => go({ name } as never)}
        >
          <I />
          {label}
        </button>
      ))}
    </nav>
  );
}

/** The projects list as a modal drawer: focus stays inside, Escape closes it, focus returns to what opened it. */
function ProjectsDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Overlay label="Projects" className="drawer-panel" backdrop="backdrop drawer" onClose={onClose}>
      <div className="dialog-head">
        <h2>Projects</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose} autoFocus>
          <Icon.Close />
        </button>
      </div>
      <ProjectsList compact onChosen={onClose} />
    </Overlay>
  );
}
