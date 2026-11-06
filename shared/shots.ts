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
