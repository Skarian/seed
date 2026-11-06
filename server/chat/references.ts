import type { ImageRequest } from '../workflows.js';
import { inputLabels, promptBindings, remapReferences } from '../../shared/reference-labels.js';
import { referenceKey, lookParts, isVisibleDetail, type CastEntry } from '../../shared/cast.js';
export { lookParts };
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
export function validateCastReferences(
  request: ImageRequest,
  cast: CastEntry[],
  picks: Record<string, string>,
  warned: Set<string> = new Set(),
): string {
  if (request.workflow !== 'image-to-image') return request.prompt;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase();
  const named = (text: string, name: string) =>
    new RegExp('(^|[^\\p{L}])' + esc(first(name)) + '($|[^\\p{L}])', 'iu').test(text);
  const labels = chatReferenceLabels(request);
  const people = cast.filter(e => e.kind !== 'place');
  let prompt = request.prompt;
  for (const ref of request.references ?? []) {
    const label = labels.get(ref.id ?? ref.asset_id);
    const owner = people.find(e => picks[referenceKey(e.name)] === ref.asset_id);
    if (!label || !owner) continue;
    const near = (at: number) => prompt.slice(Math.max(0, at - 90), at + label.length + 40);
    const at = prompt.indexOf(label);
    if (at < 0 || named(near(at), owner.name)) continue;
    const other = people.find(e => e !== owner && named(near(at), e.name));
    // A real mix-up is refused once a turn, so the model rewrites who is who; never twice, so a turn cannot loop.
    if (other && !warned.has(label)) {
      warned.add(label);
      throw Error(
        `[[${ref.id ?? ref.asset_id}]] is ${owner.name}’s approved reference, but the prompt describes it as ${other.name}. Each [[token]] is the handle of one picture: write “${owner.name}, the … from [[${ref.id ?? ref.asset_id}]]”, and put ${other.name} beside their own picture’s token.`,
      );
    }
    // Otherwise name the picture in place, so the image model knows whose picture it is.
    prompt = prompt.split(label).join(`${label} (${owner.name})`);
  }
  return prompt;
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
  const shot = request.shot;
  // A close-up, insert or hands shot shows too little of anyone for their whole look to belong in it.
  if (/\b(close-?up|insert|macro|detail|hands?)\b/i.test(shot?.framing ?? '')) return request.prompt;
  // Who is in the shot is the shot's own record; a reference used only as a backdrop or for a prop adds no one.
  const inShot = (name: string) => {
    const first = (n: string) => n.toLowerCase().split(' ')[0]!;
    if (shot?.offscreen?.some(n => first(n) === first(name))) return false;
    return shot?.cast ? shot.cast.some(n => first(n) === first(name)) : true;
  };
  const carried = (part: string) => {
    const words = part.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{3,}/gu) ?? [];
    return words.length > 0 && words.filter(w => low.includes(w)).length >= Math.ceil(words.length * 0.6);
  };
  const add: string[] = [];
  for (const e of cast) {
    if (e.kind === 'place' || !inputs.has(picks[referenceKey(e.name)] ?? '') || !inShot(e.name)) continue;
    // A prompt that already carries this person's look line (from an earlier save) never gets a second one.
    if (low.includes(e.name.toLowerCase() + '’s look:') || low.includes(e.name.toLowerCase() + "'s look:")) continue;
    const missing = lookParts(e.look)
      // A state that belongs to particular shots ("in shot 4 it is mended") is the shot's to say, never every shot's.
      .filter(p => !/\bshots?\s*\d|\bin (?:the )?(?:first|last|final|opening|closing) shots?\b/i.test(p))
      .filter(p => isVisibleDetail(p) && !carried(p))
      // Fragments read as one phrase: "a teal coat", not "A teal coat" mid-sentence.
      .map(p => (/^\p{Lu}\p{Ll}/u.test(p) && !/^\p{Lu}\p{Ll}+\s+\p{Lu}/u.test(p) ? p[0]!.toLowerCase() + p.slice(1) : p));
    if (missing.length) add.push(`${e.name}’s look: ${missing.join(', ')}.`);
  }
  return add.length ? request.prompt.replace(/\s*$/, '') + ' ' + add.join(' ') : request.prompt;
}

