import React, { useEffect, useState } from 'react';
import { projects as projectsApi, type Project } from '../api.js';
import { useStoredState } from '../data.js';
import { Markdown } from '../ui.js';
import { relativeTime } from '../format.js';

/**
 * The project's lasting brief: story, characters, locations, look, rules and shots. Seed keeps it up to date from the
 * conversation and every draft follows it; the owner can read and edit it at any time. Collapsed to one line by default.
 */
export function BriefBar({
  project,
  busy,
  onSaved,
  openDrafts = 0,
  onUpdateDrafts,
}: {
  project: Project;
  busy: boolean;
  onSaved: (p: Project) => void;
  openDrafts?: number;
  onUpdateDrafts?: () => void;
}) {
  const brief = project.brief ?? '';
  // Opens on request each visit; an open brief left from last time would cover half the conversation.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(brief),
    [error, setError] = useState(''),
    [justSaved, setJustSaved] = useState(false);
  const [seen, setSeen] = useStoredState<Record<string, string>>('seed.brief.seen', {});
  useEffect(() => {
    if (!editing) setText(brief);
  }, [brief, editing]);
  const fresh =
    project.brief_updated_by === 'seed' && project.brief_updated_at && seen[project.id] !== project.brief_updated_at;
  useEffect(() => {
    if (open && fresh) setSeen({ ...seen, [project.id]: project.brief_updated_at! });
  }, [open, fresh]);
  // Bold-only lines ("**Characters**") read as headings, and the summary skips headings and the project's own title.
  const shown = brief.replace(/^\s*\*\*([^*\n]{1,40})\*\*:?\s*$/gm, '## $1').replace(/^#\s+/gm, '## ');
  const summary = shown
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .map(l =>
      l
        .replace(/^\s*(?:[-*]|\d+\.)\s*/, '')
        .replace(/[*_`]/g, '')
        .trim(),
    )
    .filter(l => l && l !== project.title)
    .slice(0, 3)
    .join(' · ');
  async function save() {
    setError('');
    try {
      onSaved(await projectsApi.setBrief(project, text));
      setEditing(false);
      setJustSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className={'brief' + (open ? ' open' : '')} aria-label="Project brief">
      <button
        className="brief-head"
        aria-expanded={open}
        aria-label={'Project brief' + (fresh ? ', updated by Seed' : '')}
        onClick={() => setOpen(!open)}
      >
        <b>Brief</b>
        {fresh && <span className="dot amber" aria-label="Updated by Seed" />}
        <span className="faint brief-sum">
          {brief ? summary : 'Characters, places, look and shots. Seed fills in the brief as you decide.'}
        </span>
        {project.brief_updated_at && (
          <span className="faint brief-when">
            {project.brief_updated_by === 'seed' ? 'Seed' : 'You'} · {relativeTime(project.brief_updated_at)}
          </span>
        )}
      </button>
      {open && (
        <div className="brief-body">
          {editing ? (
            <>
              <textarea
                className="textarea"
                value={text}
                onChange={e => setText(e.target.value)}
                rows={Math.min(18, Math.max(6, text.split('\n').length + 1))}
                maxLength={8000}
                aria-label="Brief"
                placeholder={
                  '## Characters\nMara: 32, short black curly bob, scar through her left eyebrow, mustard raincoat\n\n## Rules\nNo text anywhere\n\n## Shots\n1. Wide, Mara at the lighthouse at dawn'
                }
                autoFocus
              />
              {error && (
                <p className="changed" role="alert">
                  {error}
                </p>
              )}
              <div className="actions">
                <button
                  className="btn small"
                  onClick={() => {
                    setEditing(false);
                    setText(brief);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn small primary"
                  disabled={busy || text.trim() === brief.trim()}
                  onClick={() => void save()}
                >
                  Save brief
                </button>
              </div>
              <p className="faint" style={{ margin: 0, fontSize: '0.7813rem' }}>
                Seed uses the brief when it plans new drafts. Check each draft and result for continuity. Changing the
                brief does not change drafts that already exist; ask Seed to update them.
              </p>
            </>
          ) : (
            <>
              {brief ? (
                <div className="brief-text">
                  <Markdown text={shown} />
                </div>
              ) : (
                <p className="faint" style={{ margin: 0 }}>
                  No brief yet. Tell Seed who is in your story, where it happens and what must always or never appear,
                  and it writes the brief. You can also write it yourself.
                </p>
              )}
              {justSaved && openDrafts > 0 && onUpdateDrafts && (
                <div className="notice" style={{ fontSize: '0.8438rem' }}>
                  Brief saved. The{' '}
                  {openDrafts === 1 ? 'open draft still follows' : `${openDrafts} open drafts still follow`} the earlier
                  brief.{' '}
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => {
                      setJustSaved(false);
                      onUpdateDrafts();
                    }}
                  >
                    Update {openDrafts === 1 ? 'it' : `all ${openDrafts}`} to match
                  </button>
                </div>
              )}
              <div className="actions">
                <button className="btn small" disabled={busy} onClick={() => setEditing(true)}>
                  {brief ? 'Edit brief' : 'Write the brief'}
                </button>
                {busy && (
                  <span className="faint" style={{ fontSize: '0.7813rem' }}>
                    You can edit once Seed finishes replying.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
