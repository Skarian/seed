import { shotNameKey, type BriefShot } from './shots.js';

/**
 * The owner's choices in a project: the approved reference picture of each cast member, place or prop (or `'skip'`
 * when it needs none), and the chosen take of each shot. A shot is keyed by its name, so a choice follows the shot
 * when shots are inserted or renumbered; a shot without a name by "#<number>".
 */
export interface ProjectChoices {
  references: Record<string, string>;
  takes: Record<string, { image?: string; clip?: string }>;
}
export type TakeKind = 'image' | 'clip';
/** One choice the owner (or Seed, when asked in words) makes. A null asset clears it. */
export type Choice =
  { reference: string; asset: string | 'skip' | null } | { shot: string; kind: TakeKind; asset: string | null };

export const noChoices = (): ProjectChoices => ({ references: {}, takes: {} });
export const shotKey = (n: number | null, name: string) => shotNameKey(name) || '#' + n;
/**
 * A shot key in words: "Shot 3: Noor's Walk", by the brief's current number and own spelling (read the brief once with
 * shotsFromBrief). A shot the brief no longer lists keeps its key, capitalised ("The Knock"); one without a name is
 * "Shot 3".
 */
export function shotLabel(shots: readonly BriefShot[], key: string) {
  if (key.startsWith('#')) return 'Shot ' + key.slice(1);
  const listed = shots.find(s => shotNameKey(s.name) === key);
  return listed ? `Shot ${listed.n}: ${listed.name}` : key.replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
}

/** The approved reference picture of a name, if any. */
export const approvedReference = (choices: ProjectChoices | undefined, name: string) => {
  const asset = choices?.references[name];
  return asset && asset !== 'skip' ? asset : undefined;
};
/** The owner said this name needs no reference picture. */
export const referenceSkipped = (choices: ProjectChoices | undefined, name: string) =>
  choices?.references[name] === 'skip';
/** Every approved reference picture, by name. */
export const approvedReferences = (choices: ProjectChoices | undefined) =>
  Object.entries(choices?.references ?? {}).filter(([, asset]) => asset !== 'skip');

/** The chosen take of a shot: by its name, or (for choices saved before names were used) by its number. */
export const chosenTake = (choices: ProjectChoices | undefined, n: number | null, name: string, kind: TakeKind) =>
  choices?.takes[shotKey(n, name)]?.[kind] ?? (n !== null ? choices?.takes['#' + n]?.[kind] : undefined);

export function applyChoice(choices: ProjectChoices, choice: Choice): ProjectChoices {
  if ('reference' in choice) {
    const references = { ...choices.references };
    if (choice.asset) references[choice.reference] = choice.asset;
    else delete references[choice.reference];
    return { ...choices, references };
  }
  const take = { ...choices.takes[choice.shot] };
  if (choice.asset) take[choice.kind] = choice.asset;
  else delete take[choice.kind];
  const takes = { ...choices.takes, [choice.shot]: take };
  if (!take.image && !take.clip) delete takes[choice.shot];
  return { ...choices, takes };
}

/** A cast name changed: its reference choice follows it. */
export function renameReference(choices: ProjectChoices, from: string, to: string): ProjectChoices {
  if (!(from in choices.references)) return choices;
  const { [from]: asset, ...references } = choices.references;
  return { ...choices, references: { ...references, [to]: asset! } };
}

/** What an asset is chosen as: a name's reference, or a shot's take (by the shot key and kind). */
export function chosenAs(choices: ProjectChoices | undefined, asset: string) {
  return [
    ...Object.entries(choices?.references ?? {})
      .filter(([, a]) => a === asset)
      .map(([name]) => ({ reference: name })),
    ...Object.entries(choices?.takes ?? {}).flatMap(([shot, take]) =>
      (['image', 'clip'] as const).filter(kind => take[kind] === asset).map(kind => ({ shot, kind })),
    ),
  ];
}

/** Projects saved before choices were typed kept them as "ref:Name", "skip:Name", "shot:<key>:image" and "<n>:clip". */
export function choicesFromPicks(picks: Record<string, string>): ProjectChoices {
  const out = noChoices();
  for (const [key, asset] of Object.entries(picks)) {
    if (key.startsWith('ref:')) out.references[key.slice(4)] = asset;
    else if (key.startsWith('skip:')) out.references[key.slice(5)] ??= 'skip';
    else {
      const m = key.match(/^(?:shot:)?(.+):(image|clip)$/);
      if (!m) continue;
      const shot = /^\d+$/.test(m[1]!) ? '#' + m[1] : key.startsWith('shot:') ? m[1]! : shotNameKey(m[1]!);
      (out.takes[shot] ??= {})[m[2] as TakeKind] = asset;
    }
  }
  return out;
}
