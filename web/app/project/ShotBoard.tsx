// The board shot by shot: the film at a glance, then a row per shot with its keyframe, clip and making lanes,
// where the owner chooses the take to use for each shot.
import type { Project } from '../api.js';
import { useApp, type ViewerItem } from '../data.js';
import { Media } from '../ui.js';
import { tileState, shapeClass, assetName } from '../format.js';
import { approvedReference, shotKey } from '../../../shared/choices.js';
import { boardStatus, rowStage, type Board, type Filter, type Picking, type Shot } from './board.js';
import { TileFace, FrameGuide, frameOf } from './BoardTile.js';

export function ShotBoard({ b, filter, ...pick }: { b: Board; filter: Filter } & Picking) {
  const { numbered, film, chosen } = b;
  const chosenClips = numbered.map(s => chosen(s, 'clip')).filter(Boolean) as ViewerItem[];
  const chosenSeconds = chosenClips.reduce((t, c) => t + (c.job?.request.output.duration_seconds ?? 5), 0);
  const chosenCount = numbered.filter(s => chosen(s, 'clip') || chosen(s, 'image')).length;
  return (
    <div className="shots">
      {numbered.length > 1 && filter === 'all' && (
        <section className="film-board" aria-label={(film ? 'The film' : 'The sequence') + ', shot by shot'}>
          <div className="film-board-head">
            <b role="heading" aria-level={2}>
              {film ? 'The film' : 'The sequence'}
            </b>
            <span className="faint">
              {numbered.length} shots · {chosenCount} chosen
              {chosenClips.length ? ` · ${chosenSeconds} s of clips` : ''}
            </span>
          </div>
          <ol className="film-cells">
            {numbered.map(s => (
              <BoardCell key={s.n} b={b} s={s} />
            ))}
          </ol>
        </section>
      )}
      {b.shotList
        // References live in Cast & places above; the rows below are the shots.
        .filter(s => !(s.n === null && b.cast.length > 0 && /^reference( sheet)?:/i.test(s.name)))
        .map(s => (
          <ShotRow key={(s.n ?? '') + s.name} b={b} s={s} filter={filter} {...pick} />
        ))}
    </div>
  );
}

/** The film at a glance: a numbered shot's chosen (or newest) picture and where it stands. */
function BoardCell({ b, s }: { b: Board; s: Shot }) {
  const done = b.chosen(s, 'clip') ?? b.chosen(s, 'image');
  const show = done ?? b.takesOf(s.clips).at(-1) ?? b.takesOf(s.images).at(-1);
  const status = boardStatus(b, s);
  return (
    <li>
      <button
        className={'board-cell' + (done ? ' done' : '')}
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
}

function ShotRow({ b, s, filter, ...pick }: { b: Board; s: Shot; filter: Filter } & Picking) {
  const app = useApp();
  const reference = s.n === null && !s.clips.length && !s.planned.length;
  const lane = (kind: 'image' | 'clip') => <Lane b={b} s={s} kind={kind} {...pick} />;
  // The next step is offered in an empty clip lane: animate the chosen keyframe (or the newest).
  const start = b.chosen(s, 'image') ?? b.takesOf(s.images).at(-1);
  return (
    <section
      className="shot-row"
      id={s.n !== null ? 'shot-' + s.n : undefined}
      aria-label={(s.n !== null ? 'Shot ' + s.n + ': ' : '') + s.name}
    >
      <div className="shot-head" role="heading" aria-level={3}>
        {s.n !== null && <b className="shot-n">Shot {s.n}</b>}
        <span className="shot-name">{s.name}</span>
        <span className="faint">{rowStage(b, s, filter, reference)}</span>
      </div>
      {s.action && <p className="shot-action faint">{s.action}</p>}
      <div className="shot-lanes">
        {(s.images.length > 0 || !s.clips.length) && (
          <div className="lane">
            <span className="lane-label">{reference ? 'Images' : 'Keyframes'}</span>
            <div className="lane-strip">
              {lane('image')}
              {!s.images.length && (
                <span className="faint lane-empty">{s.planned.length ? 'Planned' : 'None yet'}</span>
              )}
            </div>
          </div>
        )}
        {!reference && (s.clips.length > 0 || (b.film && s.images.length > 0)) && (
          <div className="lane">
            <span className="lane-label">Clips</span>
            <div className="lane-strip">
              {lane('clip')}
              {!s.clips.length && (
                <span className="faint lane-empty">
                  {filter === 'all' || filter === 'video' ? 'None yet.' : 'None in this view'}{' '}
                  {start && (filter === 'all' || filter === 'video') && (
                    <button
                      className="btn small"
                      onClick={() => app.useResult(start, 'animate')}
                      aria-label={`Animate ${start.title}`}
                    >
                      Animate {b.chosen(s, 'image') ? 'the chosen keyframe' : 'the keyframe'}
                    </button>
                  )}
                </span>
              )}
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
}

/** One lane of a shot's takes, newest first so the latest fixes are in view; take numbers keep the order made. */
function Lane({ b, s, kind, ...pick }: { b: Board; s: Shot; kind: 'image' | 'clip' } & Picking) {
  const app = useApp();
  const its = kind === 'image' ? s.images : s.clips;
  const takes = b.takesOf(its),
    shot = shotKey(s.n, s.name),
    pickedId = b.chosen(s, kind)?.asset;
  return [...its].reverse().map(it => {
    const from = b.derived.get(it.asset),
      crop = from !== undefined,
      isChosen = pickedId === it.asset,
      d = it.job?.output_dimensions;
    const label = crop
      ? `Crop${b.takeNumber(s, from) && takes.length > 1 ? ' of Take ' + b.takeNumber(s, from) : ''}`
      : takes.length > 1
        ? `${kind === 'clip' ? 'Clip' : 'Take'} ${takes.indexOf(it) + 1}`
        : kind === 'clip'
          ? 'Clip'
          : s.n === null
            ? 'Image'
            : 'Keyframe';
    // A clip names the keyframe take it started from, so the board shows which take became which clip.
    const first = it.job?.request.references?.find(r => r.role === 'first_frame')?.asset_id;
    const startTake = kind === 'clip' && !crop && first ? b.takeNumber(s, first) : 0;
    const older = olderReference(b.project, it, app.tasks);
    return (
      <figure key={it.asset} className={'cell lane-cell' + (isChosen ? ' chosen' : '')}>
        <TileFace
          it={it}
          b={b}
          siblings={b.inOrder}
          {...pick}
          className={'tile ' + (it.job ? shapeClass(it.job.request, d?.width, d?.height) : 'square')}
          style={b.dims.has(it.asset) ? { aspectRatio: String(b.dims.get(it.asset)) } : undefined}
        >
          {!crop && <FrameGuide frame={b.project.frame} ratio={b.dims.get(it.asset) ?? frameOf(it)} />}
        </TileFace>
        <figcaption>
          <span>
            {label}
            {startTake ? ` · from keyframe take ${startTake}` : ''}
            {older && (
              <small
                className="older-ref"
                title={`Made from an earlier picture of ${older}; the approved one has changed since`}
              >
                {' '}
                · older {older}
              </small>
            )}
          </span>
          {s.n !== null && !crop && (
            <button
              className={'use-shot' + (isChosen ? ' on' : '')}
              aria-pressed={isChosen}
              aria-busy={pick.picking === shot + ':' + kind}
              aria-label={
                isChosen ? `${label} is chosen for Shot ${s.n}. Clear the choice` : `Use ${label} for Shot ${s.n}`
              }
              onClick={async () => {
                // Clearing also clears a choice saved by number before shots were named.
                if (isChosen && b.choices?.takes['#' + s.n]?.[kind])
                  await pick.choose({ shot: '#' + s.n, kind, asset: null });
                await pick.choose({ shot, kind, asset: isChosen ? null : it.asset });
              }}
            >
              {isChosen ? 'Chosen' : 'Use for shot'}
            </button>
          )}
        </figcaption>
      </figure>
    );
  });
}

/** Who a take was made from by a picture that is no longer their approved reference (the look changed since). */
function olderReference(project: Project, it: ViewerItem, tasks: Parameters<typeof assetName>[2]) {
  for (const r of it.job?.request.references ?? []) {
    const who = assetName(project, r.asset_id, tasks).match(/^Reference: (.+?)(?: · \d+ of \d+)?$/)?.[1];
    const now = who ? approvedReference(project.choices, who) : undefined;
    if (who && now && now !== r.asset_id) return who;
  }
  return '';
}
