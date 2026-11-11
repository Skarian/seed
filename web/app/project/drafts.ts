/** Pure builders for ProjectPage: what a message, a remake or a restore sends, and what Reuse or Make it myself
 * puts back in the composer. No state and no network calls here. */
import {
  kindOf,
  isVideoKind,
  type ChatCard,
  type ChatMessage,
  type Kind,
  type Project,
  type JobRecord,
} from '../api.js';
import { latest, titleOf, cardJobs, isFailed } from '../format.js';
import { jobPhase } from '../../../shared/jobs.js';
import type { ComposerContext } from './Composer.js';
import { readablePrompt } from './checks.js';
import { defaultRoles, type Attachment, type MakeSettings } from './requests.js';
import { nextVersion, substantialRequest } from './timeline.js';

/** A message from the composer: its words with the Refine/Animate/Use lead-in, its assets and where it goes. */
export function outgoingMessage(context: ComposerContext, text: string, attachments: Attachment[]) {
  const assets = attachments.filter(a => a.asset_id).map(a => a.asset_id!);
  let body = text.trim(),
    extra: { card_id?: string; revision?: number; keep_plan?: boolean } = {};
  if (context.type === 'keep') extra = { keep_plan: true };
  if (context.type === 'draft') extra = { card_id: context.card, revision: context.revision };
  if (context.type !== 'using') return { body, assets, extra, kind: undefined };
  const { item, intent } = context;
  assets.unshift(item.asset);
  const lead =
    intent === 'refine'
      ? item.kind === 'video'
        ? 'Make a new take of this clip (“' + item.title + '”): '
        : 'Edit this image (“' + item.title + '”): '
      : intent === 'animate'
        ? 'Animate this image (“' + item.title + '”) as the start frame: '
        : 'Use “' + item.title + '” as an input: ';
  // Refine and Animate mean an operation on that exact image: set the kind before Seed reads the message.
  // A clip cannot be edited as an image: refining it drafts a new take that uses the clip as its reference.
  const kind =
    intent === 'animate' || (intent === 'refine' && item.kind === 'video')
      ? 'reference-to-video'
      : intent === 'refine'
        ? 'image-to-image'
        : undefined;
  return { body: lead + body, assets, extra, kind };
}

/** The inputs of a direct make: a Refine or Animate target first, in the role its intent implies, then attachments. */
export function directInputs(kind: Kind, attachments: Attachment[], context: ComposerContext) {
  const inputs = defaultRoles(kind, attachments);
  if (context.type !== 'using') return inputs;
  const { item, intent } = context;
  const role =
    intent === 'animate'
      ? 'first_frame'
      : intent === 'refine'
        ? item.kind === 'video'
          ? 'reference'
          : 'source'
        : undefined;
  return defaultRoles(kind, [
    { key: item.asset, asset_id: item.asset, name: item.title, kind: item.kind, role },
    ...inputs,
  ]);
}

/** Switching to Make with a Refine/Animate target, or an image attached to words-only Image or Video, picks the
 * kind that uses it (Make then edits or animates the image instead of refusing it). Null keeps the settings. */
export function settingsForMake(context: ComposerContext, settings: MakeSettings, attachments: Attachment[]) {
  if (context.type === 'using' && context.intent !== 'input')
    return { ...settings, kind: context.intent === 'animate' ? ('animate' as const) : ('edit' as const) };
  if ((settings.kind === 'image' || settings.kind === 'video') && attachments.some(x => x.kind === 'image'))
    return { ...settings, kind: settings.kind === 'video' ? ('animate' as const) : ('edit' as const) };
  return null;
}

/** More like this, Retry, Redo cancelled and Make again as a direct make of the card's latest request. */
export function remakeRequest(project: Project, card: ChatCard, how: 'more' | 'retry' | 'cancelled' | 'again') {
  const r = latest(card).request;
  // Retry and redo-cancelled replace only the takes that did not finish, with their own seeds.
  const failed = cardJobs(project, card).filter(j => (how === 'cancelled' ? jobPhase(j) === 'cancelled' : isFailed(j)));
  const { mode: _m, resolved_seeds, ...rest } = r;
  const count = how === 'retry' || how === 'cancelled' ? Math.max(1, failed.length) : r.count;
  const seedsFor =
    how === 'retry' || how === 'cancelled' ? failed.map(j => j.seed) : how === 'again' ? resolved_seeds : undefined;
  return {
    ...rest,
    count,
    title: how === 'more' ? nextVersion(project, titleOf(r)) : titleOf(r),
    seed: how === 'more' ? 'random' : (seedsFor?.[0] ?? r.seed),
    ...(seedsFor && seedsFor.length === count ? { resolved_seeds: seedsFor } : {}),
  };
}

/** A draft turned into an edit of attached images, in place: the first image is its source, the rest references. */
export function editOfImages(card: ChatCard, ids: string[], project: Project) {
  const r = latest(card).request;
  const images = ids.filter(a => (project.asset_manifest?.find(x => x.id === a)?.kind ?? 'image') === 'image');
  if (!images.length) return null;
  return {
    images,
    request: {
      workflow: 'image-to-image',
      title: r.title,
      prompt: r.prompt,
      count: r.count,
      seed: 'random',
      output: { aspect: 'source', size: r.output.size },
      references: images.slice(0, 10).map((asset_id, i) => ({
        id: 'input' + (i + 1),
        asset_id,
        kind: 'image',
        role: i === 0 ? 'source' : 'reference',
      })),
    },
  };
}

/** Reuse: a result's exact prompt and settings for Make, to change one thing and run it. */
export function reuseDraft(card: ChatCard, project: Project, tasks: JobRecord[], settings: MakeSettings) {
  const r = latest(card).request,
    kind = kindOf[r.workflow];
  return {
    // The words people read, not the engine's compiled form (no section keys or <Picture 1> tokens).
    text: readablePrompt(r, project, tasks),
    settings: {
      ...settings,
      kind,
      aspect: r.output.aspect === 'source' ? settings.aspect : r.output.aspect,
      count: r.count,
      ...(isVideoKind(kind)
        ? {
            videoSize: r.output.size,
            duration: r.output.duration_seconds ?? 5,
            sound: r.audio?.output ?? 'generated',
            detail: r.detail ?? 'standard',
          }
        : { imageSize: r.output.size }),
      style: r.loras?.[0],
      target: r.target ?? 'auto',
      seed: r.resolved_seeds?.[0] ?? r.seed,
    },
    attachments: (r.references ?? []).map(ref => ({
      key: ref.id,
      asset_id: ref.asset_id,
      name: project.asset_manifest?.find(a => a.id === ref.asset_id)?.name ?? 'Input',
      kind: ref.kind,
      role: ref.role,
      framing: ref.framing,
      start: ref.range?.start_seconds,
      length: ref.range?.duration_seconds,
      include_audio: ref.include_audio,
    })),
  };
}

/** Make it myself: the user's last real request as a direct make, with the kind its words and inputs suggest. */
export function makeItMyselfDraft(project: Project, settings: MakeSettings, fromTurn?: ChatMessage) {
  const last = substantialRequest(project);
  if (!last) return null;
  // If the model wrote its request as text, its prompt is the best starting point.
  const leaked = fromTurn?.text.match(/prompt\s*[:=]\s*"((?:[^"\\]|\\.){12,})"/)?.[1]?.replace(/\\"/g, '"');
  const kind: Kind = last.assets.length
    ? project.asset_manifest?.find(a => a.id === last.assets[0])?.kind === 'image' &&
      /animat|move|video|clip/i.test(last.text)
      ? 'animate'
      : 'edit'
    : /video|clip|animat/i.test(last.text)
      ? 'video'
      : 'image';
  return {
    text:
      leaked ?? last.text.replace(/^(Edit this image|Make a new take of this clip|Animate this image|Use) [^:]*: /, ''),
    settings: { ...settings, kind },
    attachments: defaultRoles(
      kind,
      last.assets.map(a => {
        const m = project.asset_manifest?.find(x => x.id === a);
        return { key: a, asset_id: a, name: m?.name ?? 'Input', kind: m?.kind ?? 'image' };
      }),
    ),
  };
}
