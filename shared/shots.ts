/**
 * The film's shot list, read from its brief: every numbered line under a Shots (Shot list, Storyboard) heading, such
 * as "1. The Walk Out: Maren crosses the causeway, wide" or "Shot 2 – Knocking: medium shot at the red door". The
 * brief stays the one record of the plan; the storyboard shows each shot before anything is drafted for it.
 */
export type BriefShot = { n: number; name: string; action: string };

export function shotsFromBrief(brief: string | null | undefined): BriefShot[] {
  const out: BriefShot[] = [];
  let inShots = false;
  for (const raw of (brief ?? '').split('\n')) {
    const line = raw.replace(/[*_`]/g, '').trim();
    const heading = line.match(/^#+\s*(.+)$/)?.[1];
    if (heading) {
      inShots = /^(shots?|shot list|storyboard|shot plan)\b/i.test(heading.trim());
      continue;
    }
    if (!inShots) continue;
    const m = line.match(/^(?:[-•]\s*)?(?:shot\s*)?(\d{1,3})[.):]?\s*(?:[–—-]\s*)?([^:–—]{1,60}?)\s*(?:[:–—]\s*(.*))?$/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (!n || out.some(s => s.n === n)) continue;
    out.push({ n, name: m[2]!.trim(), action: (m[3] ?? '').trim() });
  }
  return out.sort((a, b) => a.n - b.n).slice(0, 200);
}

/** A shot's name as a key: case, punctuation and spacing do not matter ("The Knock" = "the knock."). */
export const shotNameKey = (name: string) =>
  name
    // A revision note ("The Engine (Night Fix)") does not make a new shot.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** "Shot 4: The Walk keyframe" → { n: 4, name: "The Walk" }. */
export function shotFromTitle(title: string): { n: number | null; name: string } {
  const m = title.match(/\bshot\s*(\d{1,3})\b/i);
  if (!m) return { n: null, name: title };
  const name = title
    .replace(/^.*?\bshot\s*\d+\s*[:·.-]?\s*/i, '')
    .replace(/\s*(keyframe|animation|clip|video)\s*$/i, '')
    .trim();
  return { n: Number(m[1]), name };
}

/**
 * Where a result belongs on the board. A shot named in the brief's shot list takes the brief's current number, so
 * results made as "Shot 4: The Walk" move to Shot 5 when a shot is inserted before it.
 */
export function placeShot(title: string, list: BriefShot[]): { n: number | null; name: string } {
  const own = shotFromTitle(title);
  if (own.n === null) return own;
  const match = list.find(s => shotNameKey(s.name) === shotNameKey(own.name));
  return match ? { n: match.n, name: match.name } : own;
}
