/** Pure helpers for the plan card: what drafts share, what the last reply changed, and how drafts are revised. */
import type { ChatCard, ImageRequest, JobRecord, Project } from '../api.js';
import { latest, titleOf, settingChips, assetName } from '../format.js';
import { listOf } from './Stages.js';
import type { Check } from './checks.js';

/** A request minus the server-owned fields, ready to send back as a revision. */
export function revisable(r: ImageRequest) {
  const { workflow: _w, mode: _m, resolved_seeds: _s, ...rest } = r as ImageRequest & { resolved_seeds?: unknown };
  return rest;
}

/** Revises drafts one at a time, in order. `patch` returns null to skip a draft; the first refusal stops the run. */
export async function reviseEach(
  cards: ChatCard[],
  patch: (card: ChatCard, i: number) => Record<string, unknown> | null,
  onRevise: (card: ChatCard, request: Record<string, unknown>) => Promise<boolean>,
) {
  for (const [i, card] of cards.entries()) {
    const p = patch(card, i);
    if (p && !(await onRevise(card, p))) return;
  }
}

/** An asset name without the "Reference:" or "Reference sheet:" prefix. */
export const plainName = (name: string) => name.replace(/^Reference( sheet)?:\s*/i, '');

/** Setting chips that every draft has with the same value. */
export const sharedChips = (chips: Array<Array<[string, string]>>) =>
  chips[0]?.filter(([k, v]) => chips.every(list => list.some(([k2, v2]) => k2 === k && v2 === v))) ?? [];

/** How many leading title words every draft shares, so compact rows lead with what tells them apart. */
export function commonWords(cards: ChatCard[]) {
  const words = cards.map(c => titleOf(latest(c).request).split(' '));
  let common = 0;
  while (cards.length > 1 && words.every(w => w.length > common + 1 && w[common] === words[0]![common])) common++;
  return common;
}

/** What the last reply did to the plan: " · last revision: 2 changed, 1 added, 3 unchanged", or ''. */
export function revisionSummary(cards: ChatCard[]) {
  const lastRun = cards
    .flatMap(c => c.revisions)
    .filter(r => r.number > 1)
    .map(r => r.run_id)
    .filter(Boolean)
    .at(-1);
  if (!lastRun) return '';
  const revised = cards.filter(c => latest(c).run_id === lastRun && latest(c).number > 1).length;
  if (!revised) return '';
  // Drafts that the same reply added are new, not unchanged.
  const added = cards.filter(c => c.revisions.length === 1 && c.revisions[0]!.run_id === lastRun).length;
  const unchanged = cards.length - revised - added;
  return ` · last revision: ${[`${revised} changed`, added ? `${added} added` : '', unchanged ? `${unchanged} unchanged` : ''].filter(Boolean).join(', ')}`;
}

/**
 * A warning every draft shares (same code and text) is said once, for the whole plan; each draft keeps only its own.
 * `each` holds every draft's own copy of a plan-wide warning: its fixes close over that draft's inputs.
 */
export function splitWarnings(raw: Check[][]) {
  const same = (a: Check) => (b: Check) => a.code === b.code && a.text === b.text;
  const planWide =
    raw.length > 1
      ? (raw[0] ?? [])
          .filter(w => !w.soft && raw.every(ws => ws.some(same(w))))
          .map(check => ({ check, each: raw.map(ws => ws.find(same(check))!) }))
      : [];
  return { planWide, warnings: raw.map(ws => ws.filter(w => !planWide.some(p => same(p.check)(w)))) };
}

/**
 * The person's ticks, each kept with the `left_out` it overrode. Once Seed changes a draft's `left_out`, Seed's
 * choice decides. Ticks saved by older releases (plain booleans) never match, so Seed's choice decides for them too.
 */
export type Selection = Record<string, { on: boolean; was: boolean }>;
export function ticked(selection: Selection, card: ChatCard) {
  const tick = selection[card.id];
  return tick?.was === Boolean(card.left_out) ? tick.on : !card.left_out;
}
/** Seed changed a draft's `left_out` since the owner's tick: that tick is retired for good, even if Seed changes it back. */
export function pruneTicks(selection: Selection, cards: ChatCard[]): Selection {
  const kept = Object.entries(selection).filter(([id, tick]) => {
    const card = cards.find(c => c.id === id);
    return card && tick.was === Boolean(card.left_out);
  });
  return kept.length === Object.keys(selection).length ? selection : Object.fromEntries(kept);
}

/** Continuity preflight: drafts going into the make that leave out brief details, listed once for the whole plan. */
export function preflight(cards: ChatCard[], warnings: Check[][], selection: Selection) {
  if (cards.length < 2) return [];
  return cards
    .map((card, i) => ({ card, check: warnings[i]!.find(w => w.code === 'continuity') }))
    .filter((x): x is { card: ChatCard; check: Check } => Boolean(x.check) && ticked(selection, x.card));
}

/** An edit or animation runs on its own engine and size; this says so next to the source it came from. */
export function departureNote(project: Project, r: ImageRequest, tasks: JobRecord[]) {
  const inputs = r.references ?? [];
  const sourceJob = inputs.length ? project.jobs.find(j => j.outputs.includes(inputs[0]!.asset_id)) : undefined;
  if (!sourceJob || sourceJob.request.workflow === r.workflow) return '';
  const chip = (x: ImageRequest, k: string) => settingChips(x, id => id).find(([key]) => key === k)?.[1];
  const parts = (['engine', 'size'] as const).filter(k => chip(sourceJob.request, k) !== chip(r, k));
  // A Klein shot at its own shape is a new frame drawn from the images; a "same as source" edit keeps the frame.
  if (r.workflow === 'image-to-image' && r.output.aspect !== 'source')
    return `Uses ${listOf([...new Set(inputs.map(x => plainName(assetName(project, x.asset_id, tasks))))])}.`;
  // A clip starts from its keyframe: the start-frame thumbnail says the rest.
  if (r.workflow === 'reference-to-video') return '';
  return parts.length
    ? `“${titleOf(sourceJob.request)}” was made with ${parts.map(k => chip(sourceJob.request, k)).join(' at ')}; this draft uses ${parts.map(k => chip(r, k)).join(' at ')}. Its framing and look come from the source.`
    : '';
}
