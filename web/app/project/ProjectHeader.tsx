import { useState } from 'react';
import { projects as projectsApi, type Project } from '../api.js';
import { useApp } from '../data.js';
import { Icon } from '../icons.js';
import { MenuButton, Dialog, onTabKeys, tabStop } from '../ui.js';
import { StatusControl } from '../App.js';
import { shotsFromBrief } from '../../../shared/shots.js';

export function Header({
  project,
  view,
  split,
  canSplit,
  onBeside,
  onRename,
  onDelete,
}: {
  project: Project | null;
  view: 'conversation' | 'results';
  split: boolean;
  canSplit: boolean;
  onBeside: (on: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const app = useApp();
  // A film with a shot list in its brief works from a storyboard; other projects collect results.
  const board = shotsFromBrief(project?.brief).length ? 'Storyboard' : 'Results';
  return (
    <header className="head">
      <button className="icon-btn back" aria-label="All projects" onClick={() => app.go({ name: 'projects' })}>
        <Icon.Back />
      </button>
      <h1 className="serif">
        <button onClick={onRename} title="Rename project" disabled={!project}>
          {project?.title ?? ' '}
        </button>
      </h1>
      {canSplit && (
        <button
          className="btn small"
          aria-pressed={split}
          onClick={() => onBeside(!split)}
          title={
            split ? `Show the conversation alone, with ${board} as a tab` : 'Show the board beside the conversation'
          }
        >
          <Icon.Compare width={14} height={14} />
          {split ? 'Close side board' : `${board} beside conversation`}
        </button>
      )}
      {project && !split && (
        <div className="seg views" role="tablist" aria-label="Project view" onKeyDown={onTabKeys}>
          <button
            role="tab"
            {...tabStop(view === 'conversation', 'project-view', 'project-tab-conversation')}
            onClick={() => app.go({ name: 'project', id: project.id, view: 'conversation' })}
          >
            Conversation
          </button>
          <button
            role="tab"
            {...tabStop(view === 'results', 'project-view', 'project-tab-results')}
            onClick={() => app.go({ name: 'project', id: project.id, view: 'results' })}
          >
            {board}
          </button>
        </div>
      )}
      <span className="spacer" />
      <StatusControl />
      {project && (
        <MenuButton
          label="Project options"
          items={[
            {
              label: 'This project in the Library',
              hint: 'Its results and uploads',
              onSelect: () => app.go({ name: 'library', project: project.id }),
            },
            ...(app.narrow
              ? [
                  { label: 'GPUs', onSelect: () => app.go({ name: 'gpus' }) },
                  { label: 'Settings', onSelect: () => app.go({ name: 'settings' }) },
                  'divider' as const,
                ]
              : []),
            { label: 'Rename', onSelect: onRename },
            { label: 'Delete project…', danger: true, onSelect: onDelete },
          ]}
        >
          <Icon.More />
        </MenuButton>
      )}
    </header>
  );
}

export function RenameDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const [title, setTitle] = useState(project.title),
    [error, setError] = useState('');
  return (
    <Dialog
      title="Rename project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!title.trim()}
            onClick={() =>
              void projectsApi
                .rename(project, title.trim())
                .then(onSaved)
                .catch(e => setError(e.message))
            }
          >
            Save
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        value={title}
        maxLength={120}
        onChange={e => setTitle(e.target.value)}
        aria-label="Project name"
        onKeyDown={e => {
          if (e.key === 'Enter' && title.trim())
            void projectsApi
              .rename(project, title.trim())
              .then(onSaved)
              .catch(err => setError(err.message));
        }}
      />
      {error && (
        <p className="changed" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function EmptyProject({ onStarter, making }: { onStarter: (t: string) => void; making: boolean }) {
  const { pool } = useApp();
  const local = pool?.local,
    cloud = pool?.summary.active ?? 0;
  const starters = [
    'A short film in four shots: help me plan the keyframes',
    'One character in three different scenes, same look every time',
    'Animate an image I attach into a 5-second clip',
    'Turn a photo I attach into a watercolor painting',
  ];
  return (
    <div className="empty">
      <div>
        <h2 className="serif">What are we making?</h2>
        <p>
          {making
            ? 'Describe exactly what to make. Make now starts it with the settings below.'
            : 'Describe it in your own words. Seed plans it with you and asks before anything runs.'}
        </p>
        <div className="chips">
          {starters.map(s => (
            <button key={s} className="chip" onClick={() => onStarter(s)}>
              {s}
            </button>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 18, fontSize: '0.875rem' }}>
          {local?.enabled
            ? 'Seed PC is ready · no rental fee'
            : cloud
              ? `${cloud} cloud ${cloud === 1 ? 'GPU' : 'GPUs'} running`
              : 'No GPU yet. Seed offers one, with its price, when you make something.'}
        </p>
      </div>
    </div>
  );
}

/** One message in the stream. Seed's turns show a live stage, never tool syntax, and recover when nothing was made. */
