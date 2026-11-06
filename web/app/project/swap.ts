import { inputLabels } from '../../../shared/reference-labels.js';
import type { ImageRequest } from '../../../shared/generation.js';

type Ref = NonNullable<ImageRequest['references']>[number];

/**
 * Replaces one input of a draft with another picture. The prompt names inputs by position (<image1>), so a plain
 * swap would point a person's name at the new picture. When `keep` is set (the old picture is someone's approved
 * reference), the old picture stays on as a reference and the prompt follows it; a picture already used elsewhere in
 * the draft is not added twice, and the prompt's mentions of it follow it to its new place.
 */
export function swapInput(r: ImageRequest, slot: string, asset: { id: string; kind: Ref['kind'] }, keep: boolean) {
  const before = r.references ?? [];
  const old = before.find(x => x.id === slot);
  if (!old) return { references: before, prompt: r.prompt };
  const twin = before.find(x => x.id !== slot && x.asset_id === asset.id);
  let refs: Ref[] = before
    .filter(x => x !== twin)
    .map(x => (x.id === slot ? { ...x, asset_id: asset.id, kind: asset.kind } : x));
  let kept: Ref | undefined;
  if (keep && old.asset_id !== asset.id && !refs.some(x => x.asset_id === old.asset_id)) {
    const used = new Set(refs.map(x => x.id));
    let n = refs.length + 1;
    while (used.has('input' + n)) n++;
    kept = { id: 'input' + n, asset_id: old.asset_id, kind: old.kind, role: 'reference' } as Ref;
    refs = [...refs, kept];
  }
  const was = inputLabels(before),
    now = inputLabels(refs);
  // Where each old label's picture now sits.
  const moves = new Map<string, string>();
  for (const x of before) {
    const from = was.get(x.id);
    if (!from) continue;
    const to = x.id === slot ? (kept ? now.get(kept.id) : now.get(slot)) : x === twin ? now.get(slot) : now.get(x.id);
    if (to && to !== from) moves.set(from, to);
  }
  let prompt = r.prompt;
  if (moves.size) {
    // Two passes through placeholders, so <image1> → <image4> and <image3> → <image1> cannot chain.
    const keys = [...moves.keys()];
    keys.forEach((k, i) => (prompt = prompt.split(k).join(`\u0000${i}\u0000`)));
    keys.forEach((k, i) => (prompt = prompt.split(`\u0000${i}\u0000`).join(moves.get(k)!)));
  }
  return { references: refs, prompt, kept: Boolean(kept) };
}
