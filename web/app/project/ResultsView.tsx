import React, { useMemo, useState } from 'react';
import type { Project } from '../api.js';
import { projects as projectsApi } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { useApp, useAssets, useStoredState, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media } from '../ui.js';
import { titleOf, latest, tileState, shapeClass } from '../format.js';
import { jobActive } from '../../../shared/jobs.js';

/**
 * The project board: every result in one packed grid (or grouped by request), work in progress
 * first, chosen results marked, and planned drafts listed. Beside the conversation on wide
 * screens, and the Results tab elsewhere. Selecting two compares them.
 */
export function ResultsView({
  project,
  embedded = false,
  onChanged,
}: {
  project: Project;
  embedded?: boolean;
  onChanged?: (p: Project) => void;
}) {
  const app = useApp();
  const [filter, setFilter] = useState<'all' | 'fav' | 'image' | 'video'>('all');
  const [size, setSize] = useStoredState<'s' | 'm' | 'l'>(embedded ? 'seed.board.size' : 'seed.results.size', 'm');
  const [grouped, setGrouped] = useStoredState('seed.results.grouped', false);
  // A film or set made of numbered shots is shown shot by shot, in story order; anything else as one grid.
  const [viewPref, setView] = useStoredState<'auto' | 'shots' | 'grid'>('seed.results.view', 'auto');
  const [selected, setSelected] = useState<string[]>([]);
  const list = useAssets({
    mode: app.mode,
    chat_id: project.id,
    source: 'made',
    ...(filter === 'fav' ? { favorites: true } : {}),
    ...(filter === 'image' || filter === 'video' ? { kind: filter } : {}),
  });
  const jobsById = useMemo(() => new Map(project.jobs.map(j => [j.id, j])), [project.jobs]);
  const items: ViewerItem[] = list.items.map(a => {
    const job = a.job_id ? jobsById.get(a.job_id) : undefined,
      base = a.title ?? (job ? titleOf(job.request) : a.name);
    return {
      asset: a.id,
      kind: a.kind,
      title: job && job.request.count > 1 ? `${base} · ${job.submission_index + 1} of ${job.request.count}` : base,
      job,
      project: project.id,
    };
  });
  const fav = new Set(list.items.filter(a => a.favorite).map(a => a.id));
  // Crops and picked frames keep their original's title; they are shown as crops of a take, never as new takes.
  const derived = new Map(list.items.filter(a => a.source_asset_id).map(a => [a.id, a.source_asset_id!]));
  // Each tile keeps its own frame (a 2.39:1 crop stays wide), using the saved pixel size when it is known.
  const dims = new Map(list.items.filter(a => a.width && a.height).map(a => [a.id, a.width! / a.height!]));
  const picks = project.picks ?? {};
  const [picking, setPicking] = useState('');
  async function choose(key: string, asset: string | null) {
    setPicking(key);
    try {
      onChanged?.(await projectsApi.pick(project.id, key, asset));
    } catch (e) {
      app.toast((e as Error).message);
    } finally {
      setPicking('');
    }
  }
  const running =
    filter === 'all' || filter === 'image' || filter === 'video'
      ? project.jobs.filter(
          j => jobActive(j) && (filter === 'all' || (filter === 'video') === isVideoKind(kindOf[j.request.workflow])),
        )
      : [];
  const planned = project.groups
    .filter(g => ['reviewing', 'revising', 'assembling'].includes(g.state) && !g.direct)
    .flatMap(g => g.cards.map(c => titleOf(latest(c).request)));
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s.slice(-1), id]));
  const min = { s: embedded ? 110 : 120, m: 170, l: 260 }[size];
  const grid = { gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` };
  const tile = (it: ViewerItem) => {
    const on = selected.includes(it.asset);
    return (
      <figure key={it.asset} className="cell">
        <div className={'tile' + (on ? ' selected' : '')}>
          <Media id={it.asset} kind={it.kind} alt={it.title} />
          <button className="open" aria-label={'Open ' + it.title} onClick={() => app.inspect(it, items)} />
          <button
            className="sel check big"
            role="checkbox"
            aria-checked={on}
            aria-label={'Select ' + it.title + ' to compare'}
            onClick={() => toggle(it.asset)}
          >
            {on && <Icon.Check />}
          </button>
          <span className="corner">
            {fav.has(it.asset) && (
              <span className="pill" aria-label="Favorite">
                <Icon.HeartFill width={12} height={12} style={{ color: 'var(--accent)' }} />
              </span>
            )}
          </span>
          {it.kind === 'video' && (
            <span className="badge pill" aria-hidden="true">
              <Icon.Play width={11} height={11} />
              {it.job?.request.output.duration_seconds ?? 5} s
            </span>
          )}
        </div>
        <figcaption>
          <span>{it.title}</span>
          {it.job?.request && (
            <small>
              {it.kind === 'video' ? 'Video' : 'Image'}
              {it.job.request.workflow === 'image-to-image'
                ? ' · edit'
                : it.job.request.workflow === 'reference-to-video'
                  ? ' · animated'
                  : ''}
            </small>
          )}
        </figcaption>
      </figure>
    );
  };
  const shotOf = (title: string) => {
    const m = title.match(/\bshot\s*(\d{1,3})\b/i);
    return m ? Number(m[1]) : null;
  };
  const allTitles = [
    ...items.map(it => (it.job ? titleOf(it.job.request) : it.title)),
    ...planned,
    ...running.map(j => titleOf(j.request)),
  ];
  const hasShots = allTitles.some(t => shotOf(t) !== null);
  const view = viewPref === 'auto' ? (hasShots ? 'shots' : 'grid') : viewPref;
  type Shot = {
    n: number | null;
    name: string;
    images: ViewerItem[];
    clips: ViewerItem[];
    making: typeof running;
    planned: string[];
  };
  const shots = new Map<string, Shot>();
  const shotFor = (title: string) => {
    const n = shotOf(title),
      key = n !== null ? 'n' + n : 't' + title;
    if (!shots.has(key))
      shots.set(key, {
        n,
        name:
          n !== null
            ? title
                .replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '')
                .replace(/\s*(keyframe|animation|clip|video)\s*$/i, '')
                .trim()
            : title,
        images: [],
        clips: [],
        making: [],
        planned: [],
      });
    const s = shots.get(key)!;
    if (!s.name && n !== null) s.name = title.replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '').trim();
    return s;
  };
  // Oldest first inside a shot, so the newest take is last, like a strip of film.
  // Takes are numbered in the order they were made (and their place in a batch), the same everywhere.
  // A batch is ordered by its place (take 1 before take 2), even when its jobs finished or were saved out of order.
  const batchStart = new Map<string, number>();
  for (const j of project.jobs) {
    const key = j.submission_id || j.id,
      t = Date.parse(j.created_at);
    if (!batchStart.has(key) || t < batchStart.get(key)!) batchStart.set(key, t);
  }
  const made = (it: ViewerItem): [number, number] =>
    it.job
      ? [
          batchStart.get(it.job.submission_id || it.job.id) ?? Date.parse(it.job.created_at),
          it.job.submission_index ?? 0,
        ]
      : [0, 0];
  for (const it of [...items].sort((a, b) => {
    const x = made(a),
      y = made(b);
    return x[0] - y[0] || x[1] - y[1];
  })) {
    const s = shotFor(it.job ? titleOf(it.job.request) : it.title);
    (it.kind === 'video' ? s.clips : s.images).push(it);
  }
  for (const j of running) shotFor(titleOf(j.request)).making.push(j);
  for (const t of planned) shotFor(t).planned.push(t);
  const shotList = [...shots.values()].sort((a, b) => (a.n ?? 1e6) - (b.n ?? 1e6));
  // Previous and next in the viewer follow the board as it is shown: shot by shot, keyframes then clips.
  const inOrder = shotList.flatMap(s => [...s.images, ...s.clips]);
  // A shot's chosen take is the owner's decision ("Use for shot"), stored with the project; favorites stay personal.
  const shotKey = (s: Shot) => (s.n !== null ? String(s.n) : s.name);
  const chosen = (s: Shot, kind: 'image' | 'clip') => {
    const id = picks[shotKey(s) + ':' + kind];
    return (kind === 'image' ? s.images : s.clips).find(i => i.asset === id);
  };
  const takesOf = (its: ViewerItem[]) => its.filter(i => !derived.has(i.asset));
  // The cut: each numbered shot's chosen clip (else its favorite, else its newest), in story order.
  const cut: ViewerItem[] = shotList
    .filter(s => s.n !== null && takesOf(s.clips).length)
    .map(s => ({
      ...(chosen(s, 'clip') ?? takesOf(s.clips).find(c => fav.has(c.asset)) ?? takesOf(s.clips).at(-1)!),
      sequence: true,
    }));
  const takeNumber = (s: Shot, asset: string) => {
    const imgs = takesOf(s.images),
      at = imgs.findIndex(x => x.asset === asset);
    return at >= 0 && imgs.length > 1 ? at + 1 : at >= 0 ? 1 : 0;
  };
  // A clip names the keyframe take it started from, so the board shows which take became which clip.
  const fromTake = (s: Shot, it: ViewerItem) => {
    const start = it.job?.request.references?.find(r => r.role === 'first_frame')?.asset_id;
    const n = start ? takeNumber(s, start) : 0;
    return n ? ` from Take ${n}` : '';
  };
  const lane = (s: Shot, its: ViewerItem[], kind: 'image' | 'clip') => {
    const takes = takesOf(its),
      key = shotKey(s) + ':' + kind,
      pickedId = picks[key];
    return its.map(it => {
      const on = selected.includes(it.asset);
      const from = derived.get(it.asset);
      const crop = from !== undefined;
      const take = takes.indexOf(it);
      const isChosen = pickedId === it.asset;
      const label = crop
        ? `Crop${takeNumber(s, from!) && takes.length > 1 ? ' of Take ' + takeNumber(s, from!) : ''}`
        : takes.length > 1
          ? `Take ${take + 1}`
          : kind === 'clip'
            ? 'Clip'
            : s.n === null
              ? 'Image'
              : 'Keyframe';
      return (
        <figure key={it.asset} className={'cell lane-cell' + (isChosen ? ' chosen' : '')}>
          <div
            className={
              'tile ' +
              (it.job
                ? shapeClass(it.job.request, it.job.output_dimensions?.width, it.job.output_dimensions?.height)
                : 'square') +
              (on ? ' selected' : '')
            }
            style={dims.has(it.asset) ? { aspectRatio: String(dims.get(it.asset)) } : undefined}
          >
            <Media id={it.asset} kind={it.kind} alt={it.title} />
            {!crop && <FrameGuide frame={project.frame} ratio={dims.get(it.asset) ?? frameOf(it)} />}
            <button className="open" aria-label={'Open ' + it.title} onClick={() => app.inspect(it, inOrder)} />
            <button
              className="sel check big"
              role="checkbox"
              aria-checked={on}
              aria-label={'Select ' + it.title + ' to compare'}
              onClick={() => toggle(it.asset)}
            >
              {on && <Icon.Check />}
            </button>
            <span className="corner">
              {fav.has(it.asset) && (
                <span className="pill" aria-label="Favorite">
                  <Icon.HeartFill width={12} height={12} style={{ color: 'var(--accent)' }} />
                </span>
              )}
            </span>
            {it.kind === 'video' && (
              <span className="badge pill" aria-hidden="true">
                <Icon.Play width={11} height={11} />
                {it.job?.request.output.duration_seconds ?? 5} s
              </span>
            )}
          </div>
          <figcaption>
            <span>
              {label}
              {kind === 'clip' && !crop ? fromTake(s, it) : ''}
            </span>
            {s.n !== null && !crop && (
              <button
                className={'use-shot' + (isChosen ? ' on' : '')}
                aria-pressed={isChosen}
                disabled={picking === key}
                aria-label={
                  isChosen ? `${label} is chosen for Shot ${s.n}. Clear the choice` : `Use ${label} for Shot ${s.n}`
                }
                onClick={() => void choose(key, isChosen ? null : it.asset)}
              >
                {isChosen ? 'Chosen' : 'Use for shot'}
              </button>
            )}
          </figcaption>
        </figure>
      );
    });
  };
  // The film at a glance: one cell per numbered shot with its chosen (or newest) picture and where it stands.
  const numbered = shotList.filter(s => s.n !== null);
  const boardCell = (s: Shot) => {
    const clip = chosen(s, 'clip'),
      image = chosen(s, 'image');
    const show = clip ?? image ?? takesOf(s.clips).at(-1) ?? takesOf(s.images).at(-1);
    const status = clip
      ? `Clip chosen · ${clip.job?.request.output.duration_seconds ?? 5} s`
      : image
        ? takesOf(s.clips).length
          ? 'Keyframe chosen · choose a clip'
          : 'Keyframe chosen · no clip yet'
        : s.making.length
          ? 'Making now'
          : takesOf(s.images).length || takesOf(s.clips).length
            ? 'Made · nothing chosen'
            : 'Planned';
    return (
      <li key={s.n}>
        <button
          className={'board-cell' + (clip || image ? ' done' : '')}
          onClick={() =>
            document.getElementById('shot-' + s.n)?.scrollIntoView({
              behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
              block: 'start',
            })
          }
          aria-label={`Shot ${s.n}: ${s.name}. ${status}`}
        >
          <span className="board-thumb">
            {show ? <Media id={show.asset} kind={show.kind} alt="" /> : <span className="faint">—</span>}
          </span>
          <span className="board-text">
            <b>
              {s.n} · {s.name}
            </b>
            <small>{status}</small>
          </span>
        </button>
      </li>
    );
  };
  const chosenClips = numbered.map(s => chosen(s, 'clip')).filter(Boolean) as ViewerItem[];
  const chosenSeconds = chosenClips.reduce((t, c) => t + (c.job?.request.output.duration_seconds ?? 5), 0);
  const chosenCount = numbered.filter(s => chosen(s, 'clip') || chosen(s, 'image')).length;
  const groups = new Map<string, ViewerItem[]>();
  if (grouped)
    for (const it of items) {
      const key = it.job ? titleOf(it.job.request) : it.title;
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
  return (
    <div className={embedded ? 'board' : 'board full'}>
      <div className="toolbar">
        {embedded && <b style={{ marginRight: 4 }}>Board</b>}
        <div className="seg" role="group" aria-label="Show">
          {(
            [
              ['all', 'All'],
              ['fav', 'Favorites'],
              ['image', 'Images'],
              ['video', 'Videos'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {k === 'fav' ? <Icon.Heart width={14} height={14} /> : null}
              {l}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {view === 'shots' && cut.length > 1 && (
          <button className="btn small" onClick={() => app.view(cut[0]!, cut)}>
            <Icon.Play width={14} height={14} />
            Play in order
          </button>
        )}
        <div className="seg" role="group" aria-label="Arrange">
          <button aria-pressed={view === 'shots'} onClick={() => setView('shots')}>
            By shot
          </button>
          <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            Grid
          </button>
        </div>
        {view === 'grid' && (
          <button className="btn small quiet" aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>
            {grouped ? 'Grouped by request' : 'All together'}
          </button>
        )}
        <div className="seg no-phone" role="group" aria-label="Tile size">
          {(['s', 'm', 'l'] as const).map(k => (
            <button
              key={k}
              aria-pressed={size === k}
              aria-label={{ s: 'Small tiles', m: 'Medium tiles', l: 'Large tiles' }[k]}
              onClick={() => setSize(k)}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className={'btn primary small' + (selected.length ? '' : ' no-phone')}
          disabled={selected.length !== 2}
          onClick={() => {
            const [a, b] = selected.map(id => items.find(i => i.asset === id)!);
            if (a && b) app.compare(a, b);
          }}
        >
          <Icon.Compare />
          {selected.length === 2 ? 'Compare' : selected.length ? 'Select one more' : 'Select two to compare'}
        </button>
      </div>
      <div className="scroll">
        <div
          className={embedded ? 'boardpad' : 'col'}
          style={embedded ? undefined : { maxWidth: 1400, paddingBottom: 24 }}
        >
          {view === 'shots' && (items.length > 0 || running.length > 0 || planned.length > 0) && (
            <div className="shots">
              {numbered.length > 1 && filter === 'all' && (
                <section className="film-board" aria-label="The film, shot by shot">
                  <div className="film-board-head">
                    <b>The film</b>
                    <span className="faint">
                      {numbered.length} shots · {chosenCount} chosen
                      {chosenClips.length ? ` · ${chosenSeconds} s of clips` : ''}
                    </span>
                  </div>
                  <ol className="film-cells">{numbered.map(boardCell)}</ol>
                </section>
              )}
              {shotList.map(s => {
                const chosenImage = Boolean(chosen(s, 'image')),
                  chosenClip = Boolean(chosen(s, 'clip'));
                const reference = s.n === null && !s.clips.length && !s.planned.length;
                const stage =
                  filter !== 'all'
                    ? filter === 'fav'
                      ? 'Favorites in this shot'
                      : filter === 'image'
                        ? 'Keyframes in this shot'
                        : 'Clips in this shot'
                    : reference
                      ? 'Reference'
                      : s.making.length
                        ? 'Making now'
                        : s.clips.length
                          ? chosenClip
                            ? 'Clip chosen'
                            : `${takesOf(s.clips).length} ${takesOf(s.clips).length === 1 ? 'clip' : 'clips'} · none chosen`
                          : s.images.length
                            ? chosenImage
                              ? 'Keyframe chosen · no clip yet'
                              : 'Keyframe made · no clip yet'
                            : s.planned.length
                              ? 'In the plan, not made yet'
                              : '';
                return (
                  <section
                    key={(s.n ?? '') + s.name}
                    className="shot-row"
                    id={s.n !== null ? 'shot-' + s.n : undefined}
                    aria-label={(s.n !== null ? 'Shot ' + s.n + ': ' : '') + s.name}
                  >
                    <div className="shot-head" role="heading" aria-level={3}>
                      {s.n !== null && <b className="shot-n">Shot {s.n}</b>}
                      <span className="shot-name">{s.name}</span>
                      <span className="faint">{stage}</span>
                    </div>
                    <div className="shot-lanes">
                      {(s.images.length > 0 || !s.clips.length) && (
                        <div className="lane">
                          <span className="lane-label">{reference ? 'Images' : 'Keyframes'}</span>
                          <div className="lane-strip">
                            {lane(s, s.images, 'image')}
                            {!s.images.length && (
                              <span className="faint lane-empty">{s.planned.length ? 'Planned' : 'None yet'}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {!reference && (s.clips.length > 0 || s.images.length > 0) && (
                        <div className="lane">
                          <span className="lane-label">Clips</span>
                          <div className="lane-strip">
                            {lane(s, s.clips, 'clip')}
                            {!s.clips.length &&
                              (() => {
                                // The next step is offered right here: animate the chosen keyframe (or the newest).
                                const start = chosen(s, 'image') ?? takesOf(s.images).at(-1);
                                return (
                                  <span className="faint lane-empty">
                                    {filter === 'all' || filter === 'video' ? 'None yet.' : 'None in this view'}{' '}
                                    {start && (filter === 'all' || filter === 'video') && (
                                      <button
                                        className="btn small"
                                        onClick={() => app.useResult(start, 'animate')}
                                        aria-label={`Animate ${start.title}`}
                                      >
                                        Animate {chosen(s, 'image') ? 'the chosen keyframe' : 'the keyframe'}
                                      </button>
                                    )}
                                  </span>
                                );
                              })()}
                          </div>
                        </div>
                      )}
                      {s.making.length > 0 && (
                        <div className="lane">
                          <span className="lane-label">Making</span>
                          <div className="lane-strip">
                            {s.making.map(j => {
                              const st = tileState(j);
                              return (
                                <span key={j.id} className="chip">
                                  <span className={'dot ' + (st.tone === 'wait' ? 'amber' : 'live')} /> {st.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {view === 'grid' && running.length > 0 && (
            <section>
              <div className="day">Making now</div>
              <div className="grid" style={grid}>
                {running.map(j => {
                  const s = tileState(j);
                  return (
                    <figure key={j.id} className="cell">
                      <div className={`tile pending shimmer ${shapeClass(j.request)}`} style={{ aspectRatio: '1' }}>
                        <span className="state pill">
                          <span className={'dot ' + (s.tone === 'wait' ? 'amber' : 'live')} />
                          {s.label.split(' · ')[0]}
                        </span>
                        {s.percent !== undefined && (
                          <div className="prog">
                            <i style={{ width: s.percent + '%' }} />
                          </div>
                        )}
                      </div>
                      <figcaption>
                        <span>{titleOf(j.request)}</span>
                        <small>{s.label}</small>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </section>
          )}
          {view === 'grid' && planned.length > 0 && filter === 'all' && (
            <section>
              <div className="day">In the plan, not made yet</div>
              <div className="chips">
                {planned.map(t => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
          {list.loaded && !items.length && !running.length && !planned.length && (
            <div className="empty" style={{ minHeight: 240 }}>
              <div>
                <h2 className="serif" style={{ fontSize: '1.375rem' }}>
                  {filter === 'fav' ? 'No favorites yet' : 'Nothing made yet'}
                </h2>
                <p>
                  {filter === 'fav'
                    ? 'Tap ♥ on a result to mark it as the one you want.'
                    : 'Everything made in this project gathers here.'}
                </p>
                {filter !== 'all' && (
                  <button className="btn" onClick={() => setFilter('all')}>
                    Show all
                  </button>
                )}
              </div>
            </div>
          )}
          {view === 'grid' &&
            items.length > 0 &&
            (grouped ? (
              [...groups.entries()].map(([title, its]) => (
                <section key={title}>
                  <div className="day">
                    {title}{' '}
                    <span className="faint" style={{ fontWeight: 400 }}>
                      · {its.length}
                      {its.some(i => fav.has(i.asset)) ? ' · favorite ♥' : ''}
                    </span>
                  </div>
                  <div className="grid" style={grid}>
                    {its.map(tile)}
                  </div>
                </section>
              ))
            ) : (
              <section>
                {(running.length > 0 || planned.length > 0) && <div className="day">Made</div>}
                <div className="grid" style={grid}>
                  {items.map(tile)}
                </div>
              </section>
            ))}
          {list.cursor && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button className="btn" disabled={list.loading} onClick={() => void list.more()}>
                {list.loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The project's delivery frame ("2.39:1") drawn over a take: what stays after the crop, with the rest dimmed. */
function FrameGuide({ frame, ratio }: { frame?: string; ratio?: number }) {
  const [w, h] = (frame ?? '').split(':').map(Number);
  if (!w || !h || !ratio) return null;
  const target = w / h;
  if (Math.abs(target - ratio) / ratio < 0.03) return null;
  const wide = target > ratio;
  return (
    <span
      className="frame-guide"
      aria-hidden="true"
      title={'Crops to ' + frame}
      style={
        wide
          ? { left: 0, right: 0, height: (ratio / target) * 100 + '%', top: ((1 - ratio / target) / 2) * 100 + '%' }
          : { top: 0, bottom: 0, width: (target / ratio) * 100 + '%', left: ((1 - target / ratio) / 2) * 100 + '%' }
      }
    >
      <small>{frame}</small>
    </span>
  );
}
/** A take's own shape from its request, when its pixel size is not known yet. */
function frameOf(it: ViewerItem) {
  const a = it.job?.request.output.aspect;
  return a === '16:9' ? 16 / 9 : a === '9:16' ? 9 / 16 : a === '4:5' ? 4 / 5 : a === '1:1' ? 1 : undefined;
}
