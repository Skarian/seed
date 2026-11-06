/**
 * The cast, places and props of a project, read from its brief: every "Name: look" line under a Characters (Cast,
 * People), Places (Locations, Setting) or Props (Objects) heading. The brief stays the one record of how each looks; an approved reference image
 * for a name is stored with the project's picks under "ref:<Name>".
 */
export type CastEntry = { kind: 'character' | 'place' | 'prop'; name: string; look: string };

export const referenceKey = (name: string) => 'ref:' + name;

export function castFromBrief(brief: string | null | undefined): CastEntry[] {
  const out: CastEntry[] = [];
  let section: CastEntry['kind'] | '' = '';
  for (const raw of (brief ?? '').split('\n')) {
    const line = raw.replace(/[*_`]/g, '').trim();
    const heading = line.match(/^#+\s*(.+)$/)?.[1] ?? (/^[A-Za-z ]{3,20}:?$/.test(line) && !line.includes(' ') ? line : '');
    if (heading) {
      const h = heading.toLowerCase();
      section = /character|cast|people/.test(h)
        ? 'character'
        : /place|location|setting|environment/.test(h)
          ? 'place'
          : /^(key )?(props?|objects?)\b/.test(h)
            ? 'prop'
            : '';
      continue;
    }
    if (!section) continue;
    const m = line.replace(/^(?:[-•]|\d+\.)\s*/, '').match(/^([A-Z][\w'’ -]{0,40}?)\s*(?:\([^)]{0,30}\))?\s*[:–—]\s*(.+)$/);
    if (!m) continue;
    const name = m[1]!.replace(/\s*\(.*\)$/, '').trim();
    // "Wardrobe:" or "Props:" lines add to the character above them; they are not people.
    if (/^(wardrobe|costume|outfit|props?|look|appearance|age|notes?)$/i.test(name)) {
      const last = out.at(-1);
      if (last && last.kind === section) last.look += '; ' + m[2]!.trim();
      continue;
    }
    if (!out.some(e => e.name.toLowerCase() === name.toLowerCase())) out.push({ kind: section, name, look: m[2]!.trim() });
  }
  return out.slice(0, 24);
}

const headings: Record<CastEntry['kind'], { re: RegExp; title: string }> = {
  character: { re: /^#+\s*(characters?|cast|people)\b.*$/im, title: 'Characters' },
  place: { re: /^#+\s*(places?|locations?|settings?|environments?)\b.*$/im, title: 'Places' },
  prop: { re: /^#+\s*((key )?props?|objects?)\b.*$/im, title: 'Props' },
};

/**
 * Adds cast, places or props to a brief under their heading ("- Name: look"), creating the heading when missing.
 * Names already in the brief are left as they are.
 */
export function addToBrief(brief: string | null | undefined, entries: CastEntry[]): string {
  let out = brief ?? '';
  for (const e of entries) {
    if (castFromBrief(out).some(x => x.name.toLowerCase() === e.name.toLowerCase())) continue;
    const line = `- ${e.name}: ${e.look}`;
    const h = headings[e.kind];
    const m = out.match(h.re);
    if (m && m.index !== undefined) {
      const at = m.index + m[0].length;
      out = out.slice(0, at) + '\n' + line + out.slice(at);
    } else out = (out.replace(/\s*$/, '') + `\n\n## ${h.title}\n${line}\n`).replace(/^\n+/, '');
  }
  return out;
}

/** The same person, place or prop under a shorter or longer name: "Ines" ≈ "Ines Varga", "Foredeck" ≈ "The Foredeck". */
export function sameCast(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  const x = norm(a),
    y = norm(b);
  if (!x || !y) return false;
  return x === y || x.split(' ')[0] === y.split(' ')[0];
}
