// The project board's model: pure functions that turn a project and its results into tiles, shots in story order,
// the cut, each shot's status and the steps to the cut. ResultsView and its parts only render what these return.
import { kindOf, isVideoKind, type JobRecord, type LibraryAsset, type Project } from '../api.js';
import type { ViewerItem } from '../data.js';
import { titleOf, latest } from '../format.js';
import { jobActive, jobPhase } from '../../../shared/jobs.js';
import { castOf } from '../../../shared/cast.js';
import { shotsFromBrief, placeShot } from '../../../shared/shots.js';
import { planOpen } from '../../../shared/plan.js';
import { chosenTake, referenceSkipped, type Choice } from '../../../shared/choices.js';
import { referenceAsk } from './Cast.js';
import { listOf, type Stage } from './Stages.js';
import type { ImageRequest } from '../../../shared/generation.js';

export type Filter = 'all' | 'fav' | 'image' | 'video';
export type Board = ReturnType<typeof buildBoard>;
/** The results ticked for comparing, and the shot or cast choice being saved ("<shot key>:<kind>" or a name). */
export type Picking = {
  selected: string[];
  toggle: (id: string) => void;
  picking: string;
  choose: (choice: Choice) => Promise<void>;
};
export type Shot = {
  n: number | null;
  name: string;
  images: ViewerItem[];
  clips: ViewerItem[];
  making: JobRecord[];
  planned: string[];
  /** Drafts saved in the conversation but left out of their make. */
  saved: string[];
  /** What happens in the shot, from the brief's shot list. */
  action: string;
};

/** A draft that records its shot is placed by that record; older drafts fall back to the "Shot N: Name" title. */
export const boardTitle = (r: ImageRequest | undefined) =>
  // References for Cast & places are never shots, whatever their record says.
  /^reference( sheet)?:/i.test(r?.title ?? '')
    ? titleOf(r)
    : r?.shot?.number
      ? `Shot ${r.shot.number}: ${r.shot.name ?? titleOf(r).replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '')}`
      : titleOf(r);

const titleOfItem = (it: ViewerItem) => (it.job ? boardTitle(it.job.request) : it.title);

/** Everything the board shows, worked out from the project and the results the current filter loaded. */
export function buildBoard(project: Project, assets: LibraryAsset[], filter: Filter) {
  const jobsById = new Map(project.jobs.map(j => [j.id, j]));
  // The brief's shot list is the plan: each of its shots is on the board before anything is drafted for it.
  const briefShots = shotsFromBrief(project.brief);
  const items: ViewerItem[] = assets.map(a => {
    const job = a.job_id ? jobsById.get(a.job_id) : undefined,
      made = a.title ?? (job ? titleOf(job.request) : a.name),
      // A shot renumbered in the brief ("First Light" moved from 5 to 6) shows its current number everywhere.
      placed = placeShot(made, briefShots),
      base =
        placed.n !== null &&
        /^shot\s*\d+\s*[:·.-]/i.test(made) &&
        !new RegExp('^shot\\s*' + placed.n + '\\b', 'i').test(made)
          ? made.replace(/^shot\s*\d+/i, 'Shot ' + placed.n)
          : made,
      title = job && job.request.count > 1 ? `${base} · ${job.submission_index + 1} of ${job.request.count}` : base;
    return { asset: a.id, kind: a.kind, title, job, project: project.id };
  });
  const fav = new Set(assets.filter(a => a.favorite).map(a => a.id));
  // Crops and picked frames keep their original's title; they are shown as crops of a take, never as new takes.
  const derived = new Map(assets.filter(a => a.source_asset_id).map(a => [a.id, a.source_asset_id!]));
  // Each tile keeps its own frame (a 2.39:1 crop stays wide), using the saved pixel size when it is known.
  const dims = new Map(assets.filter(a => a.width && a.height).map(a => [a.id, a.width! / a.height!]));
  const choices = project.choices;
  const isVideo = (j: JobRecord) => isVideoKind(kindOf[j.request.workflow]);
  const shown = (j: JobRecord) => filter === 'all' || (filter === 'video') === isVideo(j);
  const running = filter === 'fav' ? [] : project.jobs.filter(j => jobActive(j) && shown(j));
  const planned = project.groups
    .filter(g => planOpen(g) && !g.direct)
    .flatMap(g => g.cards.map(c => boardTitle(latest(c).request)));
  // Drafts left out of a make stay saved in the conversation (Bring back): they are not missing.
  const saved = project.groups
    .filter(g => !planOpen(g) && !g.direct)
    .flatMap(g => g.cards.filter(c => latest(c).decision !== 'approved').map(c => boardTitle(latest(c).request)));
  // A film goes on to clips; a set of stills is finished when every shot has its chosen picture.
  // A brief that says stills only ("image-only", "no clips") is a set of pictures even if it mentions clips.
  const stillsOnly =
    /\b(image[- ]only|stills?[- ]only|no (clips|videos?|animation)|(do not|don.t|won.t) (make|render|draft|run) (any )?(clips|videos?)|image sequence|picture[- ]?books?|storybook|illustrated (?:book|story|stories|sequence)|illustrations?|(?:not|no) (?:a )?(?:video|film|clip|animation)|comic|graphic novel)\b/i.test(
      project.brief ?? '',
    );
  // A film when the brief says it is one (film, short, trailer, animation) or a clip has actually been made. A word
  // like "video" in a rule ("never run video") or one optional clip draft does not turn a set of stills into a film.
  const film =
    (!stillsOnly &&
      /\b(film|films|short film|trailer|animated|animation|music video|clips? for each shot)\b/i.test(
        project.brief ?? '',
      )) ||
    project.jobs.some(j => isVideo(j) && jobPhase(j) === 'completed');
  const hasShots = [
    ...briefShots.map(b => `Shot ${b.n}: ${b.name}`),
    ...items.map(titleOfItem),
    ...planned,
    ...running.map(j => boardTitle(j.request)),
  ].some(t => /\bshot\s*(\d{1,3})\b/i.test(t));

  // Takes are numbered in the order they were made (and their place in a batch), the same everywhere.
  // A batch is ordered by its place (take 1 before take 2), even when its jobs finished or were saved out of order.
  const batchStart = new Map<string, number>();
  for (const j of project.jobs) {
    const key = j.submission_id || j.id,
      t = Date.parse(j.created_at);
    if (!batchStart.has(key) || t < batchStart.get(key)!) batchStart.set(key, t);
  }
  const made = (it: ViewerItem): [number, number] => {
    const j = it.job;
    return j ? [batchStart.get(j.submission_id || j.id) ?? Date.parse(j.created_at), j.submission_index ?? 0] : [0, 0];
  };

  const shots = new Map<string, Shot>();
  // A shot named in the brief's shot list sits at the brief's current number, whatever number it was made under.
  const shotFor = (title: string) => {
    const { n, name } = placeShot(title, briefShots),
      key = n !== null ? 'n' + n : 't' + title;
    if (!shots.has(key))
      shots.set(key, { n, name, images: [], clips: [], making: [], planned: [], saved: [], action: '' });
    const s = shots.get(key)!;
    if (!s.name && n !== null) s.name = title.replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '').trim();
    return s;
  };
  for (const b of briefShots) shotFor(`Shot ${b.n}: ${b.name}`).action = b.action;
  // Oldest first inside a shot, so the newest take is last, like a strip of film.
  for (const it of [...items].sort((x, y) => made(x)[0] - made(y)[0] || made(x)[1] - made(y)[1])) {
    const s = shotFor(titleOfItem(it));
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
      const id = chosenTake(choices, s.n, s.name, kind);
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

  const takesOf = (its: ViewerItem[]) => its.filter(i => !derived.has(i.asset));
  // A shot's chosen take is the owner's decision ("Use for shot"), stored with the project; favorites stay personal.
  // Chosen takes are stored by the shot's name, so they follow the shot when shots are renumbered.
  const chosen = (s: Shot, kind: 'image' | 'clip') => {
    const id = chosenTake(choices, s.n, s.name, kind);
    return (kind === 'image' ? s.images : s.clips).find(i => i.asset === id);
  };
  const takeNumber = (s: Shot, asset: string) => {
    const imgs = takesOf(s.images),
      at = imgs.findIndex(x => x.asset === asset);
    return at >= 0 && imgs.length > 1 ? at + 1 : at >= 0 ? 1 : 0;
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
  // The cut: each numbered shot's chosen clip (else its favorite, else its newest), in story order.
  const cut: ViewerItem[] = shotList
    .filter(s => s.n !== null && takesOf(s.clips).length)
    .map(s => ({
      ...(chosen(s, 'clip') ?? takesOf(s.clips).find(c => fav.has(c.asset)) ?? takesOf(s.clips).at(-1)!),
      sequence: true,
    }));
  // Previous and next in the viewer follow the board as it is shown: shot by shot, keyframes then clips.
  const inOrder = shotList.flatMap(s => [...s.images, ...s.clips]);
  const numbered = shotList.filter(s => s.n !== null);

  const results = { items, fav, derived, dims, running, planned, made };
  const story = { briefShots, shotList, numbered, inOrder, cut, film, hasShots };
  return { project, choices, cast: castOf(project), ...results, ...story, takesOf, chosen, takeNumber, stale };
}

/** Where a numbered shot stands, for its cell in the film-at-a-glance overview. */
export function boardStatus(b: Board, s: Shot) {
  const clip = b.chosen(s, 'clip'),
    image = b.chosen(s, 'image');
  return clip
    ? `Clip chosen · ${clip.job?.request.output.duration_seconds ?? 5} s`
    : image
      ? b.stale(s)
        ? 'Chosen before the latest change · choose again'
        : !b.film
          ? 'Picture chosen'
          : b.takesOf(s.clips).length
            ? 'Keyframe chosen · choose a clip'
            : 'Keyframe chosen · no clip yet'
      : s.making.length
        ? 'Making now'
        : b.takesOf(s.images).length || b.takesOf(s.clips).length
          ? 'Made · nothing chosen'
          : s.planned.length
            ? 'Planned'
            : s.saved.length
              ? 'Draft saved · not made'
              : 'Not drafted yet';
}

/** Where a shot stands, for the heading of its row; under a filter, what the row is showing. */
export function rowStage(b: Board, s: Shot, filter: Filter, reference: boolean) {
  if (filter !== 'all')
    return filter === 'fav'
      ? 'Favorites in this shot'
      : filter === 'image'
        ? 'Keyframes in this shot'
        : 'Clips in this shot';
  const clips = b.takesOf(s.clips).length;
  return reference
    ? 'Reference'
    : s.making.length
      ? 'Making now'
      : s.clips.length
        ? b.chosen(s, 'clip')
          ? 'Clip chosen'
          : `${clips} ${clips === 1 ? 'clip' : 'clips'} · none chosen`
        : s.images.length
          ? b.chosen(s, 'image')
            ? boardStatus(b, s) // With no clip made, a chosen keyframe reads as it does in the overview.
            : b.film
              ? 'Keyframe made · no clip yet'
              : 'Made · nothing chosen'
          : s.planned.length
            ? 'In the plan, not made yet'
            : s.action
              ? 'In the shot list, not drafted yet'
              : '';
}

/**
 * Grid columns and tile shape. Tiles take the shape most of these pictures have (16:9 for a film), so frames fill
 * them instead of sitting in black bars; odd shapes still show whole inside.
 */
export function gridStyle(dims: Map<string, number>, size: 's' | 'm' | 'l', embedded: boolean) {
  const min = { s: embedded ? 110 : 120, m: 170, l: 260 }[size];
  const shapes = new Map<string, number>();
  for (const r of dims.values()) {
    const k = r > 1.5 ? '16 / 9' : r < 0.7 ? '9 / 16' : r < 0.95 ? '4 / 5' : '1';
    shapes.set(k, (shapes.get(k) ?? 0) + 1);
  }
  const shape = [...shapes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '1';
  const wideMin = shape === '16 / 9' ? Math.round(min * 1.4) : min;
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(${wideMin}px, 1fr))`,
    ['--tile-aspect' as string]: shape,
  };
}

/** Results grouped under the title of the request that made them, in first-seen order. */
export function byRequest(items: ViewerItem[]) {
  const groups = new Map<string, ViewerItem[]>();
  for (const it of items) {
    const key = it.job ? titleOf(it.job.request) : it.title;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  return groups;
}

/**
 * The steps from brief to cut (Cast & places, Keyframes, Clips): how far each has got, what is left in words, and
 * the one plan to ask Seed for next.
 */
export function boardStages(b: Board): Stage[] {
  const { cast, choices, numbered, chosen, takesOf, stale } = b;
  const noRef = cast.filter(e => !choices?.references[e.name]);
  // Names whose reference takes are made and only need approving, and names that still need drafting.
  const hasTakes = (name: string) =>
    b.items.some(
      i => i.kind === 'image' && /^reference:/i.test(i.title) && i.title.toLowerCase().includes(name.toLowerCase()),
    );
  const toApprove = noRef.filter(e => hasTakes(e.name)),
    toDraftRef = noRef.filter(e => !hasTakes(e.name));
  const hasKey = (s: Shot) => Boolean(chosen(s, 'clip') || (chosen(s, 'image') && !stale(s)));
  // A shot with no keyframe to choose and nothing on the way: drafting it next, or bringing back its saved draft.
  const idle = numbered.filter(s => !hasKey(s) && !takesOf(s.images).length && !s.planned.length && !s.making.length);
  const toDraft = idle.filter(s => !s.saved.length);
  const toBringBack = idle.filter(s => s.saved.length > 0);
  const toChoose = numbered.filter(s => !hasKey(s) && takesOf(s.images).length > 0);
  const toAnimate = numbered.filter(
    s => chosen(s, 'image') && !chosen(s, 'clip') && !takesOf(s.clips).length && !s.planned.length && !s.making.length,
  );
  const clipsToChoose = numbered.filter(s => !chosen(s, 'clip') && takesOf(s.clips).length > 0);
  const shotWord = (ns: Shot[]) => (ns.length === 1 ? 'Shot ' : 'Shots ') + listOf(ns.map(s => s.n!));
  const sentences = (...xs: string[]) => xs.filter(Boolean).join(' ');
  const have = (xs: unknown[]) => (xs.length === 1 ? ' has' : ' have'),
    them = (xs: unknown[]) => (xs.length === 1 ? 'it' : 'them');
  const skips = cast.filter(e => referenceSkipped(choices, e.name)).length;
  return [
    {
      key: 'cast',
      label: 'Cast & places',
      done: cast.length - noRef.length,
      total: cast.length,
      count: skips
        ? `${cast.length - noRef.length - skips} of ${cast.length - skips} approved · ${skips} not needed`
        : undefined,
      left: sentences(
        toApprove.length
          ? 'Approve a take for ' + listOf(toApprove.map(e => e.name)) + ' (Approve… under Cast & places).'
          : '',
        toDraftRef.length ? listOf(toDraftRef.map(e => e.name)) + have(toDraftRef) + ' no reference yet.' : '',
      ),
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
      left: sentences(
        toDraft.length ? shotWord(toDraft) + have(toDraft) + ' no keyframe yet.' : '',
        toChoose.length ? 'Pick a keyframe for ' + shotWord(toChoose).toLowerCase() + '.' : '',
        toBringBack.length
          ? `${shotWord(toBringBack)}${have(toBringBack)} ${toBringBack.length === 1 ? 'a saved draft' : 'saved drafts'}: bring ${them(toBringBack)} back in the conversation to make ${them(toBringBack)}.`
          : '',
      ),
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
      label: b.film ? 'Clips' : '',
      done: numbered.filter(s => chosen(s, 'clip')).length,
      total: numbered.length,
      left: sentences(
        toAnimate.length ? shotWord(toAnimate) + have(toAnimate) + ' a chosen keyframe and no clip.' : '',
        clipsToChoose.length ? 'Choose a clip for ' + shotWord(clipsToChoose).toLowerCase() + '.' : '',
        !toAnimate.length && !clipsToChoose.length ? 'Clips start from chosen keyframes.' : '',
      ),
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
}
