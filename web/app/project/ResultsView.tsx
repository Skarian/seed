import React, { useMemo, useState } from 'react';
import type { Project } from '../api.js';
import { projects as projectsApi } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { useApp, useAssets, useStoredState, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media } from '../ui.js';
import { titleOf, latest, tileState, shapeClass } from '../format.js';
import { jobActive } from '../../../shared/jobs.js';
import { CastStrip, referenceAsk } from './Cast.js';
import { Stages, listOf, type Stage } from './Stages.js';
import { castOf, referenceKey, addToBrief, sameCast } from '../../../shared/cast.js';
import { shotsFromBrief, placeShot, shotPickKey, chosenTake } from '../../../shared/shots.js';
import type { ImageRequest } from '../../../shared/generation.js';

/** A draft that records its shot is placed by that record; older drafts fall back to the "Shot N: Name" title. */
const boardTitle = (r: ImageRequest | undefined) =>
  // References for Cast & places are never shots, whatever their record says.
  /^reference( sheet)?:/i.test(r?.title ?? '')
    ? titleOf(r)
    : r?.shot?.number
      ? `Shot ${r.shot.number}: ${r.shot.name ?? titleOf(r).replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '')}`
      : titleOf(r);

/**
 * The project board: every result in one packed grid (or grouped by request), work in progress
 * first, chosen results marked, and planned drafts listed. Beside the conversation on wide
 * screens, and the Results tab elsewhere. Selecting two compares them.
 */
export function ResultsView({
  project,
  embedded = false,
  onChanged,
  onAsk,
}: {
  project: Project;
  embedded?: boolean;
  onChanged?: (p: Project) => void;
  /** Sends a message to Seed in this project's conversation. */
  onAsk?: (text: string) => void;
}) {
  const app = useApp();
  const [filter, setFilter] = useState<'all' | 'fav' | 'image' | 'video'>('all');
  const [size, setSize] = useStoredState<'s' | 'm' | 'l'>(embedded ? 'seed.board.size' : 'seed.results.size', 'm');
  const [grouped, setGrouped] = useStoredState('seed.results.grouped', false);
  // A film or set made of numbered shots is shown shot by shot, in story order; anything else as one grid.
  const [viewPref, setView] = useStoredState<'auto' | 'shots' | 'grid'>('seed.results.view', 'auto');
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const list = useAssets({
    mode: app.mode,
    chat_id: project.id,
    source: 'made',
    ...(filter === 'fav' ? { favorites: true } : {}),
    ...(filter === 'image' || filter === 'video' ? { kind: filter } : {}),
  });
  const jobsById = useMemo(() => new Map(project.jobs.map(j => [j.id, j])), [project.jobs]);
  const shotsNow = useMemo(() => shotsFromBrief(project.brief), [project.brief]);
  const items: ViewerItem[] = list.items.map(a => {
    const job = a.job_id ? jobsById.get(a.job_id) : undefined,
      made = a.title ?? (job ? titleOf(job.request) : a.name),
      // A shot renumbered in the brief ("First Light" moved from 5 to 6) shows its current number everywhere.
      placed = placeShot(made, shotsNow),
      base =
        placed.n !== null && /^shot\s*\d+\s*[:·.-]/i.test(made) && !new RegExp('^shot\\s*' + placed.n + '\\b', 'i').test(made)
          ? made.replace(/^shot\s*\d+/i, 'Shot ' + placed.n)
          : made;
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
    .flatMap(g => g.cards.map(c => boardTitle(latest(c).request)));
  // Drafts left out of a make stay saved in the conversation (Bring back): they are not missing.
  const saved = project.groups
    .filter(g => !['reviewing', 'revising', 'assembling'].includes(g.state) && !g.direct)
    .flatMap(g => g.cards.filter(c => latest(c).decision !== 'approved').map(c => boardTitle(latest(c).request)));
  // A film goes on to clips; a set of stills is finished when every shot has its chosen picture.
  // A brief that says stills only ("image-only", "no clips") is a set of pictures even if it mentions clips.
  const stillsOnly =
    /\b(image[- ]only|stills?[- ]only|no (clips|videos?|animation)|(do not|don.t|won.t) (make|render|draft|run) (any )?(clips|videos?)|image sequence|picture[- ]?books?|storybook|illustrated (?:book|story|stories|sequence)|illustrations?|(?:not|no) (?:a )?(?:video|film|clip|animation)|comic|graphic novel)\b/i.test(
      project.brief ?? '',
    );
  const film =
    (!stillsOnly &&
      /\b(film|films|clip|clips|video|videos|animat\w*|motion|trailer|short)\b/i.test(project.brief ?? '')) ||
    project.jobs.some(j => isVideoKind(kindOf[j.request.workflow])) ||
    project.groups.some(g => g.cards.some(c => isVideoKind(kindOf[latest(c).request.workflow])));
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s.slice(-1), id]));
  const min = { s: embedded ? 110 : 120, m: 170, l: 260 }[size];
  // Grid tiles take the shape most of these pictures have (16:9 for a film), so frames fill them instead of
  // sitting in black bars; odd shapes still show whole inside.
  const shapes = new Map<string, number>();
  for (const r of dims.values()) {
    const k = r > 1.5 ? '16 / 9' : r < 0.7 ? '9 / 16' : r < 0.95 ? '4 / 5' : '1';
    shapes.set(k, (shapes.get(k) ?? 0) + 1);
  }
  const shape = [...shapes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '1';
  const wideMin = shape === '16 / 9' ? Math.round(min * 1.4) : min;
  const grid = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${wideMin}px, 1fr))`,
    ['--tile-aspect' as string]: shape,
  };
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
                ? ''
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
  // The brief's shot list is the plan: each of its shots is on the board before anything is drafted for it.
  const briefShots = shotsFromBrief(project.brief);
  const allTitles = [
    ...briefShots.map(b => `Shot ${b.n}: ${b.name}`),
    ...items.map(it => (it.job ? boardTitle(it.job.request) : it.title)),
    ...planned,
    ...running.map(j => boardTitle(j.request)),
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
    /** Drafts saved in the conversation but left out of their make. */
    saved: string[];
    /** What happens in the shot, from the brief's shot list. */
    action: string;
  };
  const shots = new Map<string, Shot>();
  // A shot named in the brief's shot list sits at the brief's current number, whatever number it was made under.
  const shotFor = (title: string) => {
    const { n, name } = placeShot(title, briefShots),
      key = n !== null ? 'n' + n : 't' + title;
    if (!shots.has(key))
      shots.set(key, {
        n,
        name,
        images: [],
        clips: [],
        making: [],
        planned: [],
        saved: [],
        action: '',
      });
    const s = shots.get(key)!;
    if (!s.name && n !== null) s.name = title.replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '').trim();
    return s;
  };
  for (const b of briefShots) shotFor(`Shot ${b.n}: ${b.name}`).action = b.action;
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
    const s = shotFor(it.job ? boardTitle(it.job.request) : it.title);
    (it.kind === 'video' ? s.clips : s.images).push(it);
  }
  for (const j of running) shotFor(boardTitle(j.request)).making.push(j);
  for (const t of planned) shotFor(t).planned.push(t);
  // Only shots already on the board (or in the shot list) show a saved draft; a saved draft alone adds no shot.
  for (const t of saved) {
    const { n } = placeShot(t, briefShots);
    if (n !== null && shots.has('n' + n)) shots.get('n' + n)!.saved.push(t);
  }
  // A take chosen for a shot belongs in that shot's row wherever it was made (a picture from Make now, chosen by
  // asking Seed), so the Storyboard, the Library's "Chosen for" and the clip plan agree.
  for (const [key, s] of shots)
    for (const kind of ['image', 'clip'] as const) {
      if (s.n === null) continue;
      const id = chosenTake(picks, s.n, s.name, kind);
      const list = kind === 'image' ? s.images : s.clips;
      if (!id || list.some(i => i.asset === id)) continue;
      for (const [k2, other] of shots) {
        const from = kind === 'image' ? other.images : other.clips;
        const at = from.findIndex(i => i.asset === id);
        if (at < 0) continue;
        list.push(from.splice(at, 1)[0]!);
        const empty = !other.images.length && !other.clips.length && !other.making.length;
        if (other.n === null && empty && !other.planned.length && k2 !== key) shots.delete(k2);
        break;
      }
    }
  const shotList = [...shots.values()].sort((a, b) => (a.n ?? 1e6) - (b.n ?? 1e6));
  // Previous and next in the viewer follow the board as it is shown: shot by shot, keyframes then clips.
  const inOrder = shotList.flatMap(s => [...s.images, ...s.clips]);
  // A shot's chosen take is the owner's decision ("Use for shot"), stored with the project; favorites stay personal.
  // Chosen takes are stored by the shot's name, so they follow the shot when shots are renumbered.
  const pickKey = (s: Shot, kind: 'image' | 'clip') =>
    s.n !== null ? shotPickKey(s.n, s.name, kind) : s.name + ':' + kind;
  const chosen = (s: Shot, kind: 'image' | 'clip') => {
    const id = s.n !== null ? chosenTake(picks, s.n, s.name, kind) : picks[s.name + ':' + kind];
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
    return n ? ` · from keyframe take ${n}` : '';
  };
  const lane = (s: Shot, its: ViewerItem[], kind: 'image' | 'clip') => {
    const takes = takesOf(its),
      key = pickKey(s, kind),
      pickedId = chosen(s, kind)?.asset;
    // Newest first, so the latest fixes are in view; take numbers keep the order they were made in.
    return [...its].reverse().map(it => {
      const on = selected.includes(it.asset);
      const from = derived.get(it.asset);
      const crop = from !== undefined;
      const take = takes.indexOf(it);
      const isChosen = pickedId === it.asset;
      const label = crop
        ? `Crop${takeNumber(s, from!) && takes.length > 1 ? ' of Take ' + takeNumber(s, from!) : ''}`
        : takes.length > 1
          ? `${kind === 'clip' ? 'Clip' : 'Take'} ${take + 1}`
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
                aria-busy={picking === key}
                aria-label={
                  isChosen ? `${label} is chosen for Shot ${s.n}. Clear the choice` : `Use ${label} for Shot ${s.n}`
                }
                onClick={async () => {
                  // Clearing also clears a choice saved by number before shots were named.
                  if (isChosen && picks[s.n + ':' + kind]) await choose(s.n + ':' + kind, null);
                  await choose(key, isChosen ? null : it.asset);
                }}
              >
                {isChosen ? 'Chosen' : 'Use for shot'}
              </button>
            )}
          </figcaption>
        </figure>
      );
    });
  };
  // A chosen keyframe is stale when the shot changed afterwards: newer takes made from a different prompt.
  const stale = (s: Shot) => {
    const c = chosen(s, 'image');
    if (!c?.job) return false;
    const at = Date.parse(c.job.created_at);
    return takesOf(s.images).some(
      i =>
        i.job &&
        Date.parse(i.job.created_at) > at &&
        i.job.request.prompt !== c.job!.request.prompt &&
        // A refine of the chosen take is a variation of it, not a change to the shot.
        !(i.job.request.references ?? []).some(r => r.asset_id === c.asset),
    );
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
        ? stale(s)
          ? 'Chosen before the latest change · choose again'
          : !film
            ? 'Picture chosen'
            : takesOf(s.clips).length
              ? 'Keyframe chosen · choose a clip'
              : 'Keyframe chosen · no clip yet'
        : s.making.length
          ? 'Making now'
          : takesOf(s.images).length || takesOf(s.clips).length
            ? 'Made · nothing chosen'
            : s.planned.length
              ? 'Planned'
              : s.saved.length
                ? 'Draft saved · not made'
                : 'Not drafted yet';
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
  // The steps from brief to cut. Each step asks Seed for one plan covering everything it still needs.
  const cast = castOf(project);
  const noRef = cast.filter(e => !picks[referenceKey(e.name)] && !picks['skip:' + e.name]);
  // Names whose reference takes are made and only need approving, and names that still need drafting.
  const hasTakes = (name: string) =>
    items.some(
      i => i.kind === 'image' && /^reference:/i.test(i.title) && i.title.toLowerCase().includes(name.toLowerCase()),
    );
  const toApprove = noRef.filter(e => hasTakes(e.name)),
    toDraftRef = noRef.filter(e => !hasTakes(e.name));
  const hasKey = (s: Shot) => Boolean(chosen(s, 'clip') || (chosen(s, 'image') && !stale(s)));
  const toDraft = numbered.filter(
    s => !hasKey(s) && !takesOf(s.images).length && !s.planned.length && !s.making.length && !s.saved.length,
  );
  const toBringBack = numbered.filter(
    s => !hasKey(s) && !takesOf(s.images).length && !s.planned.length && !s.making.length && s.saved.length > 0,
  );
  const toChoose = numbered.filter(s => !hasKey(s) && takesOf(s.images).length > 0);
  const toAnimate = numbered.filter(
    s => chosen(s, 'image') && !chosen(s, 'clip') && !takesOf(s.clips).length && !s.planned.length && !s.making.length,
  );
  const clipsToChoose = numbered.filter(s => !chosen(s, 'clip') && takesOf(s.clips).length > 0);
  const shotWord = (ns: Shot[]) => (ns.length === 1 ? 'Shot ' : 'Shots ') + listOf(ns.map(s => s.n!));
  const stages: Stage[] = [
    {
      key: 'cast',
      label: 'Cast & places',
      done: cast.length - noRef.length,
      total: cast.length,
      count: (() => {
        const skips = cast.filter(e => !picks[referenceKey(e.name)] && picks['skip:' + e.name]).length;
        return skips ? `${cast.length - noRef.length - skips} of ${cast.length - skips} approved · ${skips} not needed` : undefined;
      })(),
      left: [
        toApprove.length
          ? 'Approve a take for ' + listOf(toApprove.map(e => e.name)) + ' (Approve… under Cast & places).'
          : '',
        toDraftRef.length
          ? listOf(toDraftRef.map(e => e.name)) + (toDraftRef.length === 1 ? ' has' : ' have') + ' no reference yet.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      action: toDraftRef.length
        ? {
            label: toDraftRef.length === 1 ? 'Draft its reference' : `Draft ${toDraftRef.length} references`,
            ask:
              toDraftRef.length === 1
                ? referenceAsk(toDraftRef[0]!)
                : 'Draft one plan with a reference for each of ' +
                  listOf(toDraftRef.map(e => e.name)) +
                  ' from the brief: characters alone, full length, facing the camera, on a plain light-grey background in soft even light, at 4:5 with 2 takes; places wide with no people, in clear light, at 16:9 with 2 takes; props alone on a plain light-grey background, no people, at 1:1 with 2 takes. Title each "Reference: Name". Leave the other drafts as they are. Do not run anything.',
          }
        : undefined,
    },
    {
      key: 'keyframes',
      label: 'Keyframes',
      done: numbered.filter(hasKey).length,
      total: numbered.length,
      left: [
        toDraft.length ? shotWord(toDraft) + (toDraft.length === 1 ? ' has' : ' have') + ' no keyframe yet.' : '',
        toChoose.length ? 'Pick a keyframe for ' + shotWord(toChoose).toLowerCase() + '.' : '',
        toBringBack.length
          ? shotWord(toBringBack) +
            (toBringBack.length === 1 ? ' has a saved draft' : ' have saved drafts') +
            ': Bring back in the conversation to make.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      action: toDraft.length
        ? {
            label: toDraft.length === 1 ? `Draft shot ${toDraft[0]!.n}` : `Draft ${toDraft.length} keyframes`,
            ask:
              'Draft one plan with a keyframe for ' +
              shotWord(toDraft).toLowerCase() +
              ' from the brief’s shot list, one draft per shot with 2 takes, titled "Shot N: Name", using the approved references of the cast and places in each shot. Leave the other drafts as they are. Do not run anything.',
          }
        : undefined,
    },
    {
      key: 'clips',
      label: film ? 'Clips' : '',
      done: numbered.filter(s => chosen(s, 'clip')).length,
      total: numbered.length,
      left: [
        toAnimate.length
          ? shotWord(toAnimate) + (toAnimate.length === 1 ? ' has' : ' have') + ' a chosen keyframe and no clip.'
          : '',
        clipsToChoose.length ? 'Choose a clip for ' + shotWord(clipsToChoose).toLowerCase() + '.' : '',
        !toAnimate.length && !clipsToChoose.length ? 'Clips start from chosen keyframes.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      action: toAnimate.length
        ? {
            label:
              toAnimate.length === 1 ? `Draft a clip for shot ${toAnimate[0]!.n}` : `Draft ${toAnimate.length} clips`,
            ask:
              'Draft one plan with a clip for ' +
              shotWord(toAnimate).toLowerCase() +
              ', each animating that shot’s chosen keyframe with the action from the brief’s shot list, titled "Shot N: Name". Leave the other drafts as they are. Do not run anything.',
          }
        : undefined,
    },
  ];
  const groups = new Map<string, ViewerItem[]>();
  if (grouped)
    for (const it of items) {
      const key = it.job ? titleOf(it.job.request) : it.title;
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
  return (
    <div className={(embedded ? 'board' : 'board full') + (comparing ? ' selecting' : '')}>
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
          className={selected.length || comparing ? 'btn primary small' : 'btn small'}
          aria-pressed={selected.length < 2 ? comparing : undefined}
          onClick={() => {
            // Before two are chosen, the button starts choosing: every take shows its box until two are ticked.
            if (selected.length < 2) {
              setComparing(c => !c);
              return;
            }
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
          {filter === 'all' && view === 'shots' && numbered.length > 0 && (
            <Stages
              stages={stages.filter(s => s.label)}
              onAsk={onAsk}
              onPlay={cut.length ? () => app.view(cut[0]!, cut) : undefined}
              finished={
                film
                  ? undefined
                  : {
                      text: `Your ${numbered.length}-image sequence is ready.`,
                      label: 'Open it in the Library',
                      onClick: () => app.go({ name: 'library', project: project.id }),
                    }
              }
            />
          )}
          {filter === 'all' && (
            <CastStrip
              brief={project.brief}
              cast={castOf(project)}
              onEdit={async (from, entry) => {
                try {
                  onChanged?.(await projectsApi.editCast(project.id, from, entry));
                } catch (e) {
                  app.toast((e as Error).message);
                  throw e;
                }
              }}
              picks={picks}
              images={items.filter(i => i.kind === 'image')}
              busy={picking}
              onChoose={(key, asset) => void choose(key, asset)}
              onAsk={onAsk}
              projectId={project.id}
              onImport={async picked => {
                // A name this project already has ("Tomo", or "Ines" for "Ines Varga") gets the picture under its own
                // name; new names join the brief with their look. Then each picture is approved here.
                const here = castOf(project);
                const target = (name: string) => here.find(e => sameCast(e.name, name))?.name;
                let p = await projectsApi.setBrief(
                  project,
                  addToBrief(
                    project.brief,
                    picked.filter(x => !target(x.entry.name)).map(x => x.entry),
                  ),
                );
                for (const x of picked)
                  p = await projectsApi.pick(project.id, referenceKey(target(x.entry.name) ?? x.entry.name), x.asset);
                onChanged?.(p);
                app.toast(`Brought in ${picked.map(x => x.entry.name).join(', ')}`);
              }}
              onOpen={it =>
                app.view(
                  it,
                  items.filter(i => i.kind === 'image'),
                )
              }
            />
          )}
          {view === 'shots' &&
            (items.length > 0 || running.length > 0 || planned.length > 0 || briefShots.length > 0) && (
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
                    <ol className="film-cells">{numbered.map(boardCell)}</ol>
                  </section>
                )}
                {shotList
                  // References live in Cast & places above; the rows below are the shots.
                  .filter(s => !(s.n === null && cast.length > 0 && /^reference( sheet)?:/i.test(s.name)))
                  .map(s => {
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
                                  ? stale(s)
                                    ? 'Chosen before the latest change · choose again'
                                    : film
                                      ? 'Keyframe chosen · no clip yet'
                                      : 'Picture chosen'
                                  : film
                                    ? 'Keyframe made · no clip yet'
                                    : 'Made · nothing chosen'
                                : s.planned.length
                                  ? 'In the plan, not made yet'
                                  : s.action
                                    ? 'In the shot list, not drafted yet'
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
                        {s.action && <p className="shot-action faint">{s.action}</p>}
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
                          {!reference && (s.clips.length > 0 || (film && s.images.length > 0)) && (
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
                  {[...items]
                    // Newest batch first, its takes in order (take 1 before take 2).
                    .sort((x, y) => made(y)[0] - made(x)[0] || made(x)[1] - made(y)[1])
                    .map(tile)}
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
