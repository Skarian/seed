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
  const layout = useAppLayout(),
    navigation = useNavigation(),
    studio = useStudio();
  const { spicy } = useSpicy(),
    mode = spicy ? 'nsfw' : 'sfw';
  const [workflow, setWorkflow] = useState<WorkflowId>('text-to-image');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sidebarTarget, setSidebarTarget] = useState<HTMLDivElement | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const page = navigation.page;
  useEffect(() => {
    const close = () => setActivityOpen(false);
    window.addEventListener('seed:branch-ready', close);
    return () => window.removeEventListener('seed:branch-ready', close);
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
          <button
            aria-current={page === 'admin' ? 'page' : undefined}
            onClick={() => navigate('admin')}
          >
            Admin
          </button>
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
      <main>
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
            key={mode + ':' + filter}
            mode={mode}
            filter={filter}
            onDeleted={studio.removeAsset}
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
        {page === 'chat' && (
          <Suspense
            fallback={
              <p className="initial-loading" role="status">
                Loading Chat…
              </p>
            }
          >
            <Chat
              sidebarTarget={sidebarTarget}
              onChooseChat={() => {
                if (!layout.wide) layout.setOpen(false);
              }}
            />
          </Suspense>
        )}
        <footer>seed</footer>
      </main>
    </div>
  );
}
