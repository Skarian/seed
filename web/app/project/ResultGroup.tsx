import React, { useState } from 'react';
import type { ChatCard, ChatGroup, JobRecord, Project } from '../api.js';
import { jobs as jobsApi, pool as poolApi, kindOf, isVideoKind } from '../api.js';
import { Icon } from '../icons.js';
import { Media, MenuButton, downloadAsset } from '../ui.js';
import {
  latest,
  titleOf,
  tileState,
  shapeClass,
  isFailed,
  cardJobs,
  outputNoun,
  settingChips,
  assetName,
} from '../format.js';
import { useApp, type ViewerItem } from '../data.js';
import { styleName, type StyleEntry } from './readiness.js';
import { readablePrompt } from './checks.js';
import { roleLabels } from './requests.js';
import { castOf } from '../../../shared/cast.js';
import { approvedReference } from '../../../shared/choices.js';
import { shotFromTitle } from '../../../shared/shots.js';
import { jobActive, jobPhase } from '../../../shared/jobs.js';
import { planOpen } from '../../../shared/plan.js';

type Actions = {
  onVariations: (card: ChatCard) => void;
  onRetryFailed: (card: ChatCard) => void;
  onBringBack: (card: ChatCard) => void;
  onBringBackAll: (cards: ChatCard[]) => void;
  onRedoCancelled: (card: ChatCard) => void;
  onMakeAgain: (card: ChatCard) => void;
  onReuse: (card: ChatCard) => void;
  onPrepare: (card: ChatCard) => void;
  /** Approves (or clears) an image as the reference for a character, place or prop of the brief. */
  onApproveReference?: (name: string, asset: string | null) => void;
};

/** What a plan becomes after Make: each made draft with its results, plus drafts that were set aside. */
export function ResultGroup({
  project,
  group,
  styles,
  collapsed,
  onExpand,
  actions,
  flash,
}: {
  project: Project;
  group: ChatGroup;
  styles: StyleEntry[];
  collapsed: boolean;
  onExpand: () => void;
  actions: Actions;
  flash?: string;
}) {
  const made = group.cards.filter(c => latest(c).decision === 'approved');
  const notNow = group.cards.filter(c => latest(c).decision !== 'approved');
  if (group.state === 'stopped' && group.direct)
    return (
      <section className="notice error" id={'group-' + group.id}>
        <b>Couldn't start “{titleOf(latest(group.cards[0]!).request)}”.</b>{' '}
        {group.submission_error ??
          'Nothing was made. If you started a cloud GPU for it, it bills until you release it.'}
        <div className="actions">
          <button className="btn small" onClick={() => actions.onMakeAgain(group.cards[0]!)}>
            Try again
          </button>
        </div>
      </section>
    );
  if (!made.length || group.state === 'stopped')
    return (
      <section className="card" id={'group-' + group.id}>
        <div className="notnow">
          <span>
            {/* A plan set aside (every draft kept for later) is not a stop. */}
            {group.state === 'stopped' && !group.cards.every(c => latest(c).decision === 'denied')
              ? 'Stopped, not made'
              : 'Not made yet'}
            :
          </span>
          {group.cards.map(c => (
            <span key={c.id}>
              <b>{titleOf(latest(c).request)}</b>{' '}
              <button className="link" onClick={() => actions.onBringBack(c)}>
                Bring back
              </button>
            </span>
          ))}
        </div>
      </section>
    );
  return (
    <>
      {made.map((card, i) => (
        <CardResults
          key={card.id}
          project={project}
          group={group}
          card={card}
          styles={styles}
          collapsed={collapsed}
          onExpand={onExpand}
          actions={actions}
          flash={flash === card.id || flash === group.id}
          notNow={i === made.length - 1 ? notNow : []}
        />
      ))}
    </>
  );
}

function CardResults({
  project,
  group,
  card,
  styles,
  collapsed,
  onExpand,
  actions,
  flash,
  notNow,
}: {
  project: Project;
  group: ChatGroup;
  card: ChatCard;
  styles: StyleEntry[];
  collapsed: boolean;
  onExpand: () => void;
  actions: Actions;
  flash: boolean;
  notNow: ChatCard[];
}) {
  const app = useApp();
  const r = latest(card).request,
    // A take whose picture was deleted leaves no empty slot behind, and is not counted.
    list = cardJobs(project, card).filter(
      j => !(jobPhase(j) === 'completed' && !j.outputs.length && j.deleted_outputs?.length),
    ),
    title = titleOf(r);
  const done = list.filter(j => jobPhase(j) === 'completed'),
    failed = list.filter(isFailed),
    running = list.filter(jobActive);
  const [how, setHow] = useState(false);
  const items: ViewerItem[] = done.flatMap((j, n) =>
    j.outputs.map(asset => ({
      asset,
      kind: isVideoKind(kindOf[r.workflow]) ? ('video' as const) : ('image' as const),
      title: `${title}${list.length > 1 ? `, ${n + 1} of ${list.length}` : ''}`,
      job: j,
      project: project.id,
    })),
  );
  const cancelled = list.filter(j => jobPhase(j) === 'cancelled');
  // Cancelled takes that were made again since (a later job with the same title) need no "Make again".
  const remade = madeAgain(project, title, cancelled, list);
  const status = running.length
    ? `${done.length} of ${list.length} done · ${running.every(j => jobPhase(j) === 'queued') ? 'queued' : 'making'}`
    : [
        done.length ? (done.length === list.length ? 'Done' : `${done.length} done`) : '',
        failed.length ? `${failed.length} failed` : '',
        cancelled.length ? `${cancelled.length} cancelled` : '',
      ]
        .filter(Boolean)
        .join(' · ') || `${outputNoun(r, done.length)} · done`;
  const head = (
    <div className="card-head">
      <span className="title" role="heading" aria-level={3}>
        {title}
      </span>
      <span className="meta">{status}</span>
      <span className="end">
        {running.length > 1 && (
          <button
            className="btn small"
            onClick={() => {
              void Promise.all(running.map(j => jobsApi.cancel(j.id))).then(() => app.refreshTasks());
              app.toast(
                `Cancelling ${running.length} · finished results are kept${running.every(j => j.worker?.executor === 'local' || j.request.target === 'local') ? ' (Seed PC)' : '; a rented GPU keeps running until you release it'}`,
              );
            }}
          >
            Cancel remaining {running.length}
          </button>
        )}
        {!app.split && done.length > 1 && (
          <button
            className="btn quiet small"
            onClick={() => {
              app.go({ name: 'project', id: project.id, view: 'results' });
              // Land on this shot's takes, not the top of the storyboard.
              const shot = shotFromTitle(titleOf(latest(card).request)).n;
              if (shot === null) return;
              let tries = 0;
              const find = () => {
                const row = document.getElementById('shot-' + shot);
                if (row) row.scrollIntoView({ block: 'start' });
                else if (tries++ < 40) requestAnimationFrame(find);
              };
              requestAnimationFrame(find);
            }}
            title="See these takes large, in their shot on the storyboard"
          >
            Review takes
          </button>
        )}
        {collapsed ? (
          <button className="btn quiet small" onClick={onExpand}>
            Show
          </button>
        ) : (
          <button className="btn quiet small" aria-expanded={how} onClick={() => setHow(h => !h)}>
            How it was made
          </button>
        )}
        <MenuButton
          label={'Options for ' + title}
          items={[
            {
              label: 'Make another now',
              hint: 'Same settings, a new seed. Starts right away on the GPU.',
              onSelect: () => actions.onVariations(card),
            },
            {
              label: 'Prepare a variation',
              hint: 'A new draft with the same settings, to review before making.',
              onSelect: () => actions.onPrepare(card),
            },
            {
              label: 'Reuse settings',
              hint: 'Load this prompt and settings into Make, to change one thing.',
              onSelect: () => actions.onReuse(card),
            },
            ...(failed.length
              ? [
                  {
                    label: `Retry ${failed.length} failed`,
                    hint: 'Only the failed outputs, same settings.',
                    onSelect: () => actions.onRetryFailed(card),
                  },
                ]
              : []),
            ...(running.length
              ? [
                  {
                    label: 'Cancel what is still making',
                    danger: true,
                    onSelect: () => {
                      for (const j of running) void jobsApi.cancel(j.id).then(() => app.refreshTasks());
                    },
                  },
                ]
              : []),
          ]}
        >
          <Icon.More />
        </MenuButton>
      </span>
    </div>
  );
  // Drafts left out of this make stay reachable whatever happens to the made ones (done, failed or cancelled).
  // A later make of the same shot means this left-out draft is history, not missing work.
  const madeLater = (c: ChatCard) =>
    project.groups
      .slice(project.groups.indexOf(group) + 1)
      .some(g =>
        g.cards.some(
          x => latest(x).decision === 'approved' && titleOf(latest(x).request) === titleOf(latest(c).request),
        ),
      );
  // A draft already brought back into the open plan needs no second Bring back here.
  const broughtBack = (c: ChatCard) =>
    project.groups.some(
      g => g !== group && planOpen(g) && g.cards.some(x => titleOf(latest(x).request) === titleOf(latest(c).request)),
    );
  // Drafts still waiting lead; versions since redrafted or already brought back fold into a short history.
  const waiting = notNow.filter(c => !broughtBack(c) && !madeLater(c)),
    history = notNow.filter(c => broughtBack(c) || madeLater(c));
  const notNowRow = notNow.length > 0 && (
    <div className="notnow">
      {waiting.length > 0 && <span>Not run · kept as drafts:</span>}
      {waiting.length > 1 && (
        <button className="btn small" onClick={() => actions.onBringBackAll(waiting)}>
          Bring back all {waiting.length}
        </button>
      )}
      {waiting.map(c => (
        <span key={c.id}>
          <b>{titleOf(latest(c).request)}</b>{' '}
          <button
            className="link"
            onClick={() => actions.onBringBack(c)}
            aria-label={'Bring back: ' + titleOf(latest(c).request)}
          >
            Bring back
          </button>
        </span>
      ))}
      {history.length > 0 && (
        <details className="notnow-history">
          <summary className="link">Earlier versions ({history.length})</summary>
          {history.map(c => (
            <span key={c.id}>
              <b>{titleOf(latest(c).request)}</b>
              <span className="faint">
                {broughtBack(c) ? ' · brought back into the plan' : ' · redrafted since'}
              </span>{' '}
              {!broughtBack(c) && (
                <button
                  className="link"
                  onClick={() => actions.onBringBack(c)}
                  aria-label={'Make this earlier version of ' + titleOf(latest(c).request)}
                >
                  Make this version instead
                </button>
              )}
            </span>
          ))}
        </details>
      )}
    </div>
  );
  if (list.length && cancelled.length === list.length)
    return (
      <section className="card" id={'card-' + card.id} data-group={group.id}>
        <div className="notnow">
          <span>
            <b>{title}</b> · cancelled before it was made
          </span>
          {remade ? (
            <span className="faint">made again below</span>
          ) : (
            <button className="link" onClick={() => actions.onMakeAgain(card)}>
              Make again
            </button>
          )}
        </div>
        {notNowRow}
        <IdleAfterCancel role={isVideoKind(kindOf[r.workflow]) ? 'video' : 'image'} show jobs={list} />
      </section>
    );
  if (collapsed)
    return (
      <section className="card" id={'card-' + card.id}>
        {head}
        <div className="strip">
          {items.map(it => (
            <button
              key={it.asset}
              className={'tile ' + shapeClass(r)}
              onClick={() => app.inspect(it, items)}
              aria-label={'Open ' + it.title}
            >
              <Media id={it.asset} kind={it.kind} alt={it.title} />
            </button>
          ))}
        </div>
        {notNowRow}
      </section>
    );
  return (
    <section
      className={'card' + (flash ? ' flash' : '')}
      id={'card-' + card.id}
      data-group={group.id}
      aria-label={title}
    >
      {head}
      {how && <HowItWasMade project={project} card={card} styles={styles} />}
      <div
        className={
          'results' +
          (list.length === 1 ? ' one' : list.length === 2 ? ' two' : '') +
          (r.output.aspect === '9:16' && list.length > 2 ? ' tall' : '')
        }
        style={
          r.output.aspect === '9:16' && list.length > 2
            ? { ['--cols' as string]: String(Math.min(list.length, 4)) }
            : undefined
        }
      >
        {list
          .filter(j => jobPhase(j) !== 'cancelled' || running.length)
          .map((job, n) => (
            <ResultTile
              key={job.id}
              job={job}
              project={project}
              title={`${title}${list.length > 1 ? `, ${n + 1} of ${list.length}` : ''}`}
              siblings={items}
              card={card}
              actions={actions}
            />
          ))}
      </div>
      {!running.length && cancelled.length > 0 && done.length > 0 && !remade && (
        <div className="notnow">
          <span>
            {outputNoun(r, cancelled.length)} cancelled before {cancelled.length === 1 ? 'it was' : 'they were'} made
          </span>
          <button className="link" onClick={() => actions.onRedoCancelled(card)}>
            {cancelled.length === 1 ? 'Make that one again' : `Make those ${cancelled.length} again`}
          </button>
        </div>
      )}
      {notNowRow}
      <IdleAfterCancel
        role={isVideoKind(kindOf[r.workflow]) ? 'video' : 'image'}
        show={!running.length && cancelled.length > 0}
        jobs={list}
      />
    </section>
  );
}

/** After a cancel, say plainly whether a GPU is still billing, and offer to release it right here. */
function IdleAfterCancel({ role, show, jobs }: { role: 'image' | 'video'; show: boolean; jobs: JobRecord[] }) {
  const app = useApp();
  const [done, setDone] = useState(false);
  const note = React.useRef<HTMLDivElement>(null);
  // Only the cloud GPU that ran this group's work is offered; work made on Seed PC rents nothing.
  const served = new Set(jobs.filter(j => j.worker?.executor === 'cloud' && j.worker.id).map(j => j.worker!.id!));
  const w = app.pool?.workers.find(
    x => served.has(x.id) && x.worker_class === role && x.state === 'ready' && !x.current_job_id && !x.quit_mode,
  );
  const busyElsewhere = app.tasks.some(j => ['queued', 'starting', 'running'].includes(jobPhase(j)));
  if (!show || (!w && !done) || busyElsewhere) return null;
  if (done)
    return (
      <div className="notnow" ref={note} tabIndex={-1}>
        <span>Releasing the {role} GPU. Results stay in your Library.</span>
      </div>
    );
  return (
    <div className="notnow">
      <span>
        The {role} GPU that made these is still rented ({`$${w!.hourly.toFixed(2)}/h`})
        {w!.idle_release_minutes ? `, and releases after ${w!.idle_release_minutes} idle minutes` : ''}.
      </span>
      <button
        className="link"
        onClick={() => {
          void poolApi.act(w!.id, 'finish').then(() => app.refreshPool());
          setDone(true);
          requestAnimationFrame(() => note.current?.focus());
        }}
      >
        Release it now
      </button>
      <button className="link" onClick={() => setDone(true)}>
        Keep it for the next make
      </button>
    </div>
  );
}

/** What a waiting output is waiting for: a GPU starting up, with its download progress and time left when known. */
function gpuWait(pool: ReturnType<typeof useApp>['pool'], role: 'image' | 'video') {
  const w = pool?.workers.find(x => x.worker_class === role && ['starting', 'preparing'].includes(x.state));
  if (!w) return null;
  const p = w.preparation,
    pct = p && p.bytes_total ? Math.round((p.bytes_done / p.bytes_total) * 100) : null;
  const eta = p?.eta_seconds ? ' · about ' + Math.max(1, Math.round(p.eta_seconds / 60)) + ' min' : '';
  return w.state === 'starting'
    ? 'Waiting for GPU · starting'
    : pct !== null
      ? `Waiting for GPU · models ${pct}%${eta}`
      : 'Waiting for GPU · loading models';
}

export function HowItWasMade({ project, card, styles }: { project: Project; card: ChatCard; styles: StyleEntry[] }) {
  const r = latest(card).request,
    { tasks } = useApp();
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }} className="kv">
      <span>Prompt</span>
      <div className="prompt">{readablePrompt(r, project, tasks)}</div>
      <span>Settings</span>
      <div>
        {settingChips(r, id => styleName(styles, id))
          .map(([, v]) => v)
          .join(' · ')}
      </div>
      {(r.references ?? []).length > 0 && (
        <>
          <span>Inputs</span>
          <div>
            {r
              .references!.map(
                x =>
                  '“' + assetName(project, x.asset_id, tasks) + '” as ' + (roleLabels[x.role] ?? x.role).toLowerCase(),
              )
              .join(', ')}
          </div>
        </>
      )}
      {r.resolved_seeds && (
        <>
          <span>{r.resolved_seeds.length === 1 ? 'Seed' : 'Seeds'}</span>
          <div>{r.resolved_seeds.join(', ')}</div>
        </>
      )}
    </div>
  );
}

function ResultTile({
  job,
  project,
  title,
  siblings,
  card,
  actions,
}: {
  job: JobRecord;
  project: Project;
  title: string;
  siblings: ViewerItem[];
  card: ChatCard;
  actions: Actions;
}) {
  const app = useApp();
  const r = job.request,
    video = isVideoKind(kindOf[r.workflow]);
  const base = tileState(job),
    shape = shapeClass(r, job.output_dimensions?.width, job.output_dimensions?.height);
  const state =
    base.label === 'Waiting for GPU' || base.label === 'Queued'
      ? { ...base, label: gpuWait(app.pool, video ? 'video' : 'image') ?? base.label }
      : base;
  // A setting the GPU refused fails the same way again: offer to change it instead of retrying as is.
  const rejected = /^Generation did not start: the GPU rejected a setting/.test(job.error ?? '');
  const asset = job.outputs[0];
  if (jobPhase(job) !== 'completed' || !asset)
    return (
      <div
        className={`tile pending ${shape} ${state.tone === 'bad' ? 'failed' : ''} ${state.tone === 'live' || state.tone === 'wait' ? 'shimmer' : ''}`}
        role="group"
        aria-label={title + ': ' + state.label}
      >
        {state.tone === 'bad' && (
          <span className="state pill">
            <span className="dot red" />
            {state.label.split(' · ')[0]}
          </span>
        )}
        <div className="placeholder">
          {state.tone === 'live' || state.tone === 'wait' ? (
            <span className="wait-text">
              <span className={'dot ' + (state.tone === 'live' ? 'live' : 'amber')} />
              {state.label}
              {state.retained && (
                <>
                  <small className="wait-reason">
                    The {video ? 'clip' : 'image'} was made but didn’t reach this PC.
                  </small>
                  <button
                    className="btn small"
                    style={{ marginTop: 8 }}
                    onClick={() =>
                      void jobsApi
                        .retrySave(job.id)
                        .then(() => app.refreshTasks())
                        .catch(e => app.toast((e as Error).message))
                    }
                  >
                    Try saving again
                  </button>
                </>
              )}
              {/* The server gives a reason only when the owner must act. */}
              {jobPhase(job) === 'queued' && job.waiting_reason && (
                <small className="wait-reason">{job.waiting_reason}</small>
              )}
            </span>
          ) : state.tone === 'bad' ? (
            <span>
              {state.label.replace(/^Failed · /, '')}
              <br />
              {/* An uncertain job offers Check again only when Seed can safely retry it; otherwise the worker decides. */}
              {(jobPhase(job) !== 'uncertain' || job.recovery?.action) && (
                <button
                  className="btn small"
                  style={{ marginTop: 8 }}
                  onClick={() =>
                    jobPhase(job) === 'uncertain'
                      ? void jobsApi.recover(job.id).catch(() => undefined)
                      : rejected
                        ? actions.onReuse(card)
                        : actions.onRetryFailed(card)
                  }
                >
                  {jobPhase(job) === 'uncertain' ? 'Check again' : rejected ? 'Change settings' : 'Make it again'}
                </button>
              )}
            </span>
          ) : state.tone === 'off' ? (
            <span>
              Cancelled
              <br />
              {madeAgain(project, title.replace(/, \d+ of \d+$/, ''), [job], [job]) ? (
                <small className="faint">Made again below</small>
              ) : (
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => actions.onMakeAgain(card)}>
                  Make again
                </button>
              )}
            </span>
          ) : null}
        </div>
        {state.cancellable && (
          <span className="corner">
            <button
              className="pill"
              onClick={() =>
                void jobsApi
                  .cancel(job.id)
                  .then(after => {
                    app.refreshTasks();
                    app.toast(
                      jobPhase(after) === 'completed'
                        ? 'It had already finished, so it was kept'
                        : job.worker?.executor === 'local' || job.request.target === 'local'
                          ? 'Cancelled · nothing else was affected'
                          : 'Cancelled · the rented GPU keeps running until you release it',
                    );
                  })
                  .catch(e => app.toast((e as Error).message))
              }
              aria-label={'Cancel ' + title}
            >
              Cancel
            </button>
          </span>
        )}
        {state.percent !== undefined && (
          <div className="prog">
            <i style={{ width: state.percent + '%' }} />
          </div>
        )}
      </div>
    );
  const item: ViewerItem = { asset, kind: video ? 'video' : 'image', title, job, project: project.id };
  // "Use as Ines's reference": approving is one step from any image, not only from Cast & places.
  const approve =
    video || !actions.onApproveReference
      ? []
      : castOf(project)
          .slice(0, 8)
          .map(e => {
            const on = approvedReference(project.choices, e.name) === asset;
            return {
              label: on ? `${e.name}’s reference` : `Use as ${e.name}’s reference`,
              checked: on,
              onSelect: () => actions.onApproveReference!(e.name, on ? null : asset),
            };
          });
  const approveItems = approve.length ? ['divider' as const, ...approve] : [];
  return (
    <div className={`tile ${shape}`}>
      <Media id={asset} kind={item.kind} alt={title} />
      <button
        className="open"
        aria-label={'Open ' + title}
        onClick={() => app.inspect(item, siblings)}
        onDoubleClick={() => app.view(item, siblings)}
      />
      {video && (
        <span className="state pill" aria-hidden="true">
          <Icon.Play width={12} height={12} />
          {r.output.duration_seconds ?? 5} s
        </span>
      )}
      {/* Touch screens have no hover: one always-visible menu holds the next steps. */}
      <MenuButton
        label={'Next steps for ' + title}
        className="pill touch-more"
        placement="above"
        items={[
          {
            label: 'Refine',
            hint: video ? 'Describe a change; Seed drafts a new take' : 'Describe a change to this image',
            onSelect: () => app.useResult(item, 'refine'),
          },
          { label: 'Make another now', hint: 'Same settings, a new seed', onSelect: () => actions.onVariations(card) },
          ...(!video
            ? [{ label: 'Animate', hint: 'Use it as a start frame', onSelect: () => app.useResult(item, 'animate') }]
            : []),
          { label: 'Use as input', onSelect: () => app.useResult(item, 'input') },
          ...(!video
            ? [
                {
                  label: 'Check against the brief',
                  hint: 'Against the brief and references',
                  onSelect: () => app.useResult(item, 'check'),
                },
              ]
            : []),
          { label: 'Open full screen', onSelect: () => app.view(item, siblings) },
          ...approveItems,
        ]}
      >
        <Icon.More width={16} height={16} />
      </MenuButton>
      <div className="bar">
        <button className="pill" onClick={() => app.useResult(item, 'refine')}>
          <Icon.Pencil width={14} height={14} />
          Refine
        </button>
        <button
          className="pill"
          onClick={() => actions.onVariations(card)}
          title="Same settings, a new seed. Starts right away."
        >
          Make another now
        </button>
        {!video && (
          <button className="pill" onClick={() => app.useResult(item, 'animate')}>
            <Icon.Film width={14} height={14} />
            Animate
          </button>
        )}
        <MenuButton
          label={'More for ' + title}
          className="pill"
          placement="above"
          items={[
            { label: 'Use as input', onSelect: () => app.useResult(item, 'input') },
            ...(!video
              ? [
                  {
                    label: 'Check against the brief',
                    hint: 'Against the brief and references',
                    onSelect: () => app.useResult(item, 'check'),
                  },
                ]
              : []),
            { label: 'Reuse settings', onSelect: () => actions.onReuse(card) },
            { label: 'Open full screen', onSelect: () => app.view(item, siblings) },
            { label: 'Download', onSelect: () => void downloadAsset(asset, title.replace(/, (\d+) of \d+$/, ' $1')) },
            ...approveItems,
          ]}
        >
          <Icon.More width={14} height={14} />
        </MenuButton>
      </div>
    </div>
  );
}

/** Whether cancelled work was made again since: a later job in the project with the same draft title. */
function madeAgain(project: Project, title: string, cancelled: JobRecord[], own: JobRecord[]) {
  if (!cancelled.length) return false;
  const since = Math.max(...cancelled.map(j => Date.parse(j.created_at)));
  return project.jobs.some(j => !own.includes(j) && titleOf(j.request) === title && Date.parse(j.created_at) > since);
}
