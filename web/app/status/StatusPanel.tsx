import React, { useEffect, useRef } from 'react';
import { jobs as jobsApi, kindOf, isVideoKind } from '../api.js';
import { useApp } from '../data.js';
import { Icon } from '../icons.js';
import { Thumb, onTabKeys, tabStop } from '../ui.js';
import { tileState, titleOf, relativeTime } from '../format.js';
import { jobActive } from '../../../shared/jobs.js';
import { GpuOverview } from '../gpus/GpusPage.js';

/** Every task across projects and every GPU, one click from any screen. */
export function StatusPanel({
  tab,
  onTab,
  onClose,
}: {
  tab: 'tasks' | 'gpus';
  onTab: (t: 'tasks' | 'gpus') => void;
  onClose: () => void;
}) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const reviewable = app.projectList.filter(
    p => p.ready_to_review && !(app.route.name === 'project' && app.route.id === p.id),
  );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
    // Dialogs and menus opened from the panel live outside it (portals); using them must not close the panel.
    const layered = () => Boolean(document.querySelector('.backdrop, .menu'));
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !layered() && onClose();
    const out = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.status, .backdrop, .menu')) onClose();
    };
    // Capture: runs before a dialog on top closes itself, so Escape closes only that dialog, never the panel too.
    addEventListener('keydown', key, true);
    addEventListener('pointerdown', out);
    return () => {
      removeEventListener('keydown', key, true);
      removeEventListener('pointerdown', out);
      opener?.focus?.();
    };
  }, []);
  const recent = app.tasks
    .filter(j => jobActive(j) || Date.now() - Date.parse(j.updated_at) < 6 * 3600_000)
    .slice(0, 80);
  // A creative task (one draft's batch) first, its numbered outputs underneath.
  const batches = [
    ...recent
      .reduce(
        (m, j) => m.set(j.submission_id || j.id, [...(m.get(j.submission_id || j.id) ?? []), j]),
        new Map<string, typeof recent>(),
      )
      .values(),
  ].map(list => list.sort((a, b) => a.submission_index - b.submission_index));
  const planning = app.projectList.filter(p => p.activity === 'thinking' || p.activity === 'preparing');
  const active = batches.filter(b => b.some(jobActive)),
    rest = batches.filter(b => !b.some(jobActive));
  const row = (list: typeof recent) => {
    const j = list[0]!,
      project = app.projectList.find(p => p.id === j.source?.chat_id);
    const done = list.filter(x => x.state === 'completed'),
      live = list.filter(x => tileState(x).cancellable),
      failed = list.filter(x => tileState(x).tone === 'bad'),
      cancelled = list.filter(x => x.state === 'cancelled');
    const s =
      list.length === 1
        ? tileState(j).label
        : live.length
          ? `${done.length} of ${list.length} done · ${tileState(live[0]!).label}`
          : failed.length
            ? `${done.length} of ${list.length} done · ${failed.length} failed`
            : cancelled.length
              ? `Cancelled · ${done.length} of ${list.length} made`
              : `${done.length} of ${list.length} done`;
    const out = done[0]?.outputs[0],
      video = isVideoKind(kindOf[j.request.workflow]);
    const tone = live.length ? (tileState(live[0]!).tone === 'wait' ? 'amber' : 'live') : failed.length ? 'red' : 'off';
    return (
      // The row opens its project: a real button, so it works from the keyboard. Cancel sits beside it.
      <div key={j.submission_id || j.id} className="task">
        <button
          type="button"
          className="task-open"
          disabled={!project}
          onClick={() => {
            if (project) {
              onClose();
              app.go({ name: 'project', id: project.id, view: 'conversation', focus: j.source?.card_id });
            }
          }}
        >
          {out ? (
            <span className="thumb">
              <Thumb id={out} kind={video ? 'video' : 'image'} alt="" />
            </span>
          ) : (
            <span className="thumb" style={{ display: 'grid', placeItems: 'center' }}>
              <span className={'dot ' + tone} />
            </span>
          )}
          <span className="t">
            <b>
              {titleOf(j.request)}
              {list.length > 1 ? ` · ${list.length} ${video ? 'clips' : 'images'}` : ''}
            </b>
            <small>
              {video ? 'Clip' : 'Image'} · {s}
              {project ? ' · ' + project.title : ''} · {relativeTime(list.at(-1)!.updated_at)}
            </small>
          </span>
          {project && <Icon.Next />}
        </button>
        {live.length > 0 && (
          <button
            className="btn small"
            onClick={e => {
              e.stopPropagation();
              void Promise.all(live.map(x => jobsApi.cancel(x.id))).then(app.refreshTasks);
              app.toast(
                `Cancelled ${live.length} · finished results are kept${live.some(j => j.worker?.executor === 'cloud') ? '; the rented GPU keeps running until you release it' : ''}`,
              );
            }}
          >
            {live.length > 1 ? `Cancel remaining ${live.length}` : 'Cancel'}
          </button>
        )}
      </div>
    );
  };
  return (
    <div className="panel" ref={ref} role="dialog" aria-label="Activity and GPUs">
      <div className="dialog-head" style={{ paddingBottom: 0, borderBottom: 0 }}>
        <h2>Activity</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon.Close />
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Activity" onKeyDown={onTabKeys}>
        <button
          role="tab"
          {...tabStop(tab === 'tasks', 'activity-panel', 'activity-tab-tasks')}
          onClick={() => onTab('tasks')}
        >
          Tasks{active.length + planning.length ? ` (${active.length + planning.length})` : ''}
        </button>
        <button
          role="tab"
          {...tabStop(tab === 'gpus', 'activity-panel', 'activity-tab-gpus')}
          onClick={() => onTab('gpus')}
        >
          GPUs{app.pool?.summary.active ? ` (${app.pool.summary.active})` : ''}
        </button>
      </div>
      <div style={{ overflow: 'auto' }} role="tabpanel" id="activity-panel" aria-labelledby={'activity-tab-' + tab}>
        {tab === 'tasks' ? (
          <>
            {planning.length > 0 && (
              <>
                <div className="day" style={{ padding: '0 16px' }}>
                  Seed planning
                </div>
                {planning.map(p => (
                  <button
                    key={p.id}
                    className="task"
                    onClick={() => {
                      onClose();
                      app.go({ name: 'project', id: p.id, view: 'conversation' });
                    }}
                  >
                    <span className="thumb" style={{ display: 'grid', placeItems: 'center' }}>
                      <span className="dot live" />
                    </span>
                    <span className="t">
                      <b>{p.title}</b>
                      <small>Seed is replying</small>
                    </span>
                    <Icon.Next />
                  </button>
                ))}
              </>
            )}
            {reviewable.length > 0 && (
              <>
                <div className="day" style={{ padding: '0 16px' }}>
                  Ready for you
                </div>
                {reviewable.map(p => (
                  <button
                    key={p.id}
                    className="task"
                    onClick={() => {
                      onClose();
                      app.go({ name: 'project', id: p.id, view: 'conversation' });
                    }}
                  >
                    <span className="thumb" style={{ display: 'grid', placeItems: 'center' }}>
                      <span className="dot amber" />
                    </span>
                    <span className="t">
                      <b>{p.title}</b>
                      <small>A plan is ready to review and make</small>
                    </span>
                    <Icon.Next />
                  </button>
                ))}
              </>
            )}
            {!recent.length && !planning.length && !reviewable.length && (
              <p className="muted" style={{ padding: 16, margin: 0 }}>
                Nothing has run in the last few hours.
              </p>
            )}
            {active.length > 0 && (
              <div className="day" style={{ padding: '0 16px' }}>
                Now
              </div>
            )}
            {active.map(row)}
            {rest.length > 0 && (
              <div className="day" style={{ padding: '0 16px' }}>
                Earlier
              </div>
            )}
            {rest.map(row)}
          </>
        ) : (
          <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <GpuOverview compact />
            <button
              className="btn"
              onClick={() => {
                onClose();
                app.go({ name: 'gpus' });
              }}
            >
              Open GPUs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
