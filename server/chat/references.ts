import type { ImageRequest } from '../workflows.js';
import { inputLabels, promptBindings, remapReferences } from '../../shared/reference-labels.js';
import { referenceKey, type CastEntry } from '../../shared/cast.js';
export function chatReferenceLabels(request: ImageRequest) {
  return inputLabels(request.references ?? []);
}
export function validateChatReferences(request: ImageRequest) {
  const allowed = new Set(chatReferenceLabels(request).values());
  if (
    request.prompt.includes('[removed reference]') ||
    [...request.prompt.matchAll(/<(?:Picture|Video|Audio) [1-9][0-9]*>|<image[1-9][0-9]*>/g)].some(
      m => !allowed.has(m[0]),
    )
  )
    throw Error('Update the prompt to replace its missing reference labels.');
}
/** Preserve label-to-input-instance meaning when order changes without a prompt edit. */
export function preserveChatLabels(previous: ImageRequest, next: ImageRequest) {
  if (previous.prompt !== next.prompt) return next;
  const before = promptBindings(previous.references ?? []),
    after = promptBindings(next.references ?? []);
  return { ...next, prompt: remapReferences(next.prompt, before, after) };
}

/**
 * Who is who. Each input that is a character's or prop's approved reference must be named beside its label
 * ("Odile, the woman from <image1>"), so the prompt cannot describe Odile's picture as Pim. The app knows which
 * reference is whose; the model only writes the words around it.
 */
export function validateCastReferences(request: ImageRequest, cast: CastEntry[], picks: Record<string, string>) {
  if (request.workflow !== 'image-to-image') return;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase();
  const named = (text: string, name: string) =>
    new RegExp('(^|[^\\p{L}])' + esc(first(name)) + '($|[^\\p{L}])', 'iu').test(text);
  const labels = chatReferenceLabels(request);
  const people = cast.filter(e => e.kind !== 'place');
  for (const ref of request.references ?? []) {
    const label = labels.get(ref.id);
    const owner = people.find(e => picks[referenceKey(e.name)] === ref.asset_id);
    if (!label || !owner) continue;
    for (const m of request.prompt.matchAll(new RegExp(esc(label), 'g'))) {
      const near = request.prompt.slice(Math.max(0, m.index! - 90), m.index! + label.length + 40);
      if (named(near, owner.name)) continue;
      const other = people.find(e => e !== owner && named(near, e.name));
      throw Error(
        other
          ? `${label} is ${owner.name}’s approved reference, but the prompt describes it as ${other.name}. Rewrite it so each reference is named for who it shows, for example “${owner.name}, the … from ${label}”.`
          : `Name who ${label} shows: it is ${owner.name}’s approved reference. Write it as “${owner.name}, the … from ${label}”.`,
      );
    }
  }
}

/**
 * A character's or prop's approved picture guides the look, but a new frame still drifts (a shaved head becomes a bun)
 * unless the words say it too. Adds any part of each referenced name's brief look the prompt does not already carry,
 * as one sentence at the end ("Ines Varga's look: shaved head, oil-stained overalls.").
 */
export function withCastLooks(request: ImageRequest, cast: CastEntry[], picks: Record<string, string>): string {
  if (request.workflow !== 'image-to-image') return request.prompt;
  const inputs = new Set((request.references ?? []).map(r => r.asset_id));
  const low = request.prompt.toLowerCase();
  const visible = (part: string) =>
    !/^\d+(\s*years?\s*old)?$/i.test(part) &&
    !/\b(grand)?(son|daughter|mother|father|brother|sister|aunt|uncle|wife|husband|friend|apprentice|calm|kind|shy|brave|curious|stubborn|cheerful|grumpy|witty|humou?r|funny|wise|patient|anxious|proud|lonely|playful|loves|likes|hates|fears)\b/i.test(
      part,
    );
  const carried = (part: string) => {
    const words = part.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{3,}/gu) ?? [];
    return words.length > 0 && words.filter(w => low.includes(w)).length >= Math.ceil(words.length * 0.6);
  };
  const add: string[] = [];
  for (const e of cast) {
    if (e.kind === 'place' || !inputs.has(picks[referenceKey(e.name)] ?? '')) continue;
    const missing = e.look
      .split(/[,;]|\.\s/)
      .map(p => p.trim().replace(/\.$/, ''))
      .filter(p => p.length > 2 && visible(p) && !carried(p));
    if (missing.length) add.push(`${e.name}’s look: ${missing.join(', ')}.`);
  }
  return add.length ? request.prompt.replace(/\s*$/, '') + ' ' + add.join(' ') : request.prompt;
}
