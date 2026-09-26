import React, { lazy, Suspense, useEffect, useState } from 'react';
import { workflowIds, type WorkflowId } from '../shared/studio.js';
import { useSpicy } from './spicy-mode.js';
import { useAppLayout } from './app-layout.js';
import { useNavigation, type WorkspacePage } from './hooks/use-navigation.js';
import { useStudio } from './hooks/use-studio.js';
import type { LibraryFilter } from './hooks/use-library.js';
import { Sidebar } from './sidebar.js';
import { BrandSwitcher } from './brand-switcher.js';
import { workflowLabels } from './workflow-labels.js';
import { JobsView } from './job-ui.js';
import { Generate } from './generate.js';
import { Library } from './library.js';
import { WorkerPoolProvider, useWorkerPool } from './hooks/use-worker-pool.js';
import { WorkerPoolStatus, WorkerPoolDialog } from './worker-pool.js';
const Admin = lazy(() => import('./admin.js').then((module) => ({ default: module.Admin })));
const Chat = lazy(() => import('./chat.js').then((module) => ({ default: module.Chat })));

function SeedMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="7" y="5" width="19" height="22" rx="3" transform="rotate(12 16 16)" />
      <rect x="6" y="5" width="19" height="22" rx="3" transform="rotate(-12 16 16)" />
    </svg>
  );
}

export function App() {
  return <WorkerPoolProvider><AppContent /></WorkerPoolProvider>;
}
function AppContent() {
  const pool = useWorkerPool();
  const layout = useAppLayout(),
    navigation = useNavigation(),
    studio = useStudio();
  const { spicy } = useSpicy(),
    mode = spicy ? 'nsfw' : 'sfw';
  const [workflow, setWorkflow] = useState<WorkflowId>('text-to-image');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [favoritesOnly,setFavoritesOnly]=useState(false),[collectionIds,setCollectionIds]=useState({sfw:'',nsfw:''});
  const [sidebarTarget, setSidebarTarget] = useState<HTMLDivElement | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [returnToWorkers, setReturnToWorkers] = useState(false);
  const [chatMounted, setChatMounted] = useState(navigation.page === 'chat');
  const page = navigation.page;
  useEffect(()=>{const open=()=>{setActivityOpen(false);setWorkflow('image-to-image');navigation.navigate('generate');if(!layout.wide)layout.setOpen(false);};window.addEventListener('seed:edit-image',open);return()=>window.removeEventListener('seed:edit-image',open);},[navigation.navigate,layout.wide]);
  useEffect(() => { if (page === 'chat') setChatMounted(true); }, [page]);
  useEffect(() => { const open=(event:Event)=>{navigation.navigate('admin');if((event as CustomEvent).detail?.section==='loras')history.replaceState(null,'','/admin?section=loras');};window.addEventListener('seed:admin-open',open);return()=>window.removeEventListener('seed:admin-open',open); }, [navigation.navigate]);
  useEffect(() => {
    const close = () => setActivityOpen(false);
    window.addEventListener('seed:branch-ready', close);
    window.addEventListener('seed:workers-opened', close);
    return () => { window.removeEventListener('seed:branch-ready', close); window.removeEventListener('seed:workers-opened', close); };
  }, []);
  useEffect(() => setActivityOpen(false), [mode]);
  function navigate(next: WorkspacePage) {
    navigation.navigate(next);
    if (!layout.wide) layout.setOpen(false);
  }
  const count = studio.studio
    ? studio.studio.activity.active +
      studio.studio.activity.waiting +
      studio.studio.activity.needs_attention
    : null;
  return (
    <div className={`studio-shell ${layout.open ? 'sidebar-visible' : ''} page-${page}`}>
      {!layout.open && (
        <header className="app-bar">
          <button
            className="sidebar-toggle"
            aria-label="Toggle sidebar"
            aria-expanded={layout.open}
            aria-controls="app-sidebar"
            onClick={() => layout.setOpen(true)}
          >
            ☰
          </button>
          {page === 'generate' && <span className="mobile-workflow-title">{workflowLabels[workflow]}</span>}
        </header>
      )}
      <Sidebar
        open={layout.open}
        wide={layout.wide}
        onOpenChange={layout.setOpen}
        heading={
          <BrandSwitcher
            page={page}
            onNavigate={navigate}
            icon={
              <span className="brand-mark">
                <SeedMark />
              </span>
            }
          >
            seed
          </BrandSwitcher>
        }
        footer={
          <><WorkerPoolStatus />
          <button
            aria-current={page === 'admin' ? 'page' : undefined}
            onClick={() => navigate('admin')}
          >
            Admin
          </button>
          </>
        }
      >
        <div className="header-status">
          <button
            className="jobs-button"
            aria-haspopup="dialog"
            aria-label={`Activity${count === null ? '' : ', ' + count}`}
            onClick={() => {
              setActivityOpen(true);
              if (!layout.wide) layout.setOpen(false);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <rect x="4" y="5" width="16" height="15" rx="3" />
              <path d="M8 3v4m8-4v4M8 11h8m-8 4h5" />
            </svg>
            <span>Activity</span>
            <span className="job-count">{count ?? '–'}</span>
          </button>
        </div>
        <div className="sidebar-section" ref={setSidebarTarget} />
        {page !== 'chat' && (
          <div className="sidebar-chats-heading">
            <button onClick={() => navigate('chat')}>Chats</button>
            <button
              aria-label="New chat"
              title="New chat"
              onClick={() => {
                sessionStorage.removeItem('seed.chat.selected.' + mode);
                navigate('chat');
              }}
            >
              +
            </button>
          </div>
        )}
        {page === 'generate' && (
          <div className="sidebar-section">
            <p className="section-label">Workflows</p>
            {workflowIds.map((id) => (
              <button
                key={id}
                className={workflow === id ? 'selected' : ''}
                onClick={() => {
                  setWorkflow(id);
                  if (!layout.wide) layout.setOpen(false);
                }}
              >
                {workflowLabels[id]}
              </button>
            ))}
          </div>
        )}
        {page === 'library' && (
          <div className="sidebar-section">
            <p className="section-label">Media type</p>
            {(['all', 'image', 'video', 'audio'] as const).map((type) => (
              <button
                key={type}
                className={filter === type ? 'selected' : ''}
                onClick={() => {
                  setFilter(type);
                  if (!layout.wide) layout.setOpen(false);
                }}
              >
                {{ all: 'All media', image: 'Images', video: 'Videos', audio: 'Audio' }[type]}
              </button>
            ))}
          </div>
        )}
      </Sidebar>
      {activityOpen && <JobsView mode={mode} onClose={() => setActivityOpen(false)} />}
      <WorkerPoolDialog onCredentials={() => { pool.close(); setReturnToWorkers(true); navigate('admin'); }} />
      <main>
        {page === 'admin' && returnToWorkers && <div className="pool-resume"><span>Your worker selection is saved.</span><button onClick={() => { setReturnToWorkers(false); pool.open(pool.dialog.workerClass); }}>Return to workers ↗</button></div>}
        <Generate
          active={page === 'generate'}
          workflow={workflow}
          mode={mode}
          studio={studio.studio}
          jobs={studio.jobs}
          error={studio.error}
          onWorkflowChange={setWorkflow}
          onSubmitted={studio.accept}
          onRefresh={studio.refresh}
          onLibrary={() => navigate('library')}
        />
        {page === 'library' && (
          <Library
            key={mode}
            mode={mode}
            filter={filter}
            onDeleted={studio.removeAsset}
            favoritesOnly={favoritesOnly} onFavoritesChange={setFavoritesOnly} collectionId={collectionIds[mode]} onCollectionChange={id=>setCollectionIds(current=>({...current,[mode]:id}))}
          />
        )}
        {page === 'admin' && (
          <Suspense
            fallback={
              <p className="initial-loading" role="status">
                Loading Admin…
              </p>
            }
          >
            <Admin />
          </Suspense>
        )}
        {(page === 'chat' || chatMounted) && (
          <div hidden={page !== 'chat'} className="retained-chat-page">
          <Suspense
            fallback={
              <p className="initial-loading" role="status">
                Loading Chat…
              </p>
            }
          >
            <Chat
              sidebarTarget={page === 'chat' ? sidebarTarget : null}
              onChooseChat={() => {
                if (!layout.wide) layout.setOpen(false);
              }}
            />
          </Suspense>
          </div>
        )}
        <footer>seed</footer>
      </main>
    </div>
  );
}
