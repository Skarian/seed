/**
 * The cast, places and props of a project. Once a project has a stored cast it is the record: entries are added from
 * the brief's "Name: look" lines (under a Characters, Places or Props heading) and edited or removed only on purpose,
 * so a reworded brief line can never make someone vanish. The brief shows the same entries in its sections. An
 * approved reference image for a name is stored with the project's picks under "ref:<Name>".
 */
export type CastEntry = { kind: 'character' | 'place' | 'prop'; name: string; look: string };

export const referenceKey = (name: string) => 'ref:' + name;

/** Generic sub-lines ("Wardrobe:") that add to the entry above them; they are not people. */
const subLine = /^(wardrobe|costume|outfit|props?|look|appearance|age|notes?)$/i;

/** Walks a brief's lines, telling each one's cast section and, for an entry line, its name and look. */
function scanBrief(
  brief: string | null | undefined,
  visit: (raw: string, section: CastEntry['kind'] | '', entry?: { name: string; look: string }) => void,
) {
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
      visit(raw, '');
      continue;
    }
    const m = section
      ? line.replace(/^(?:[-•]|\d+\.)\s*/, '').match(/^(\p{Lu}[\p{L}\p{N}_'’. -]{0,40}?)\s*(?:\([^)]{0,30}\))?\s*[:–—]\s*(.+)$/u)
      : null;
    visit(raw, section, m ? { name: m[1]!.replace(/\s*\(.*\)$/, '').trim(), look: m[2]!.trim() } : undefined);
  }
}

export function castFromBrief(brief: string | null | undefined): CastEntry[] {
  const out: CastEntry[] = [];
  scanBrief(brief, (_raw, section, entry) => {
    if (!section || !entry) return;
    if (subLine.test(entry.name)) {
      const last = out.at(-1);
      if (last && last.kind === section) last.look += '; ' + entry.look;
      return;
    }
    if (!out.some(e => e.name.toLowerCase() === entry.name.toLowerCase()))
      out.push({ kind: section, name: entry.name, look: entry.look });
  });
  return out.slice(0, 24);
}

/** A project's cast: its stored record once it has one, else what its brief lists. */
export function castOf(p: { cast?: CastEntry[] | null; brief?: string | null }): CastEntry[] {
  return p.cast ?? castFromBrief(p.brief);
}

const oneWord = (name: string) => !name.trim().includes(' ');
/** The stored entry a brief entry refers to: the same name, or a short and full form of it ("Ines" and "Ines Varga"). */
function storedMatch(stored: CastEntry[], e: CastEntry) {
  return (
    stored.find(x => x.name.toLowerCase() === e.name.toLowerCase()) ??
    stored.find(x => x.kind === e.kind && sameCast(x.name, e.name) && (oneWord(x.name) || oneWord(e.name)))
  );
}

/** Brings what a brief now says into the stored cast: new names are added and looks updated; nothing is removed. */
export function mergeCast(stored: CastEntry[] | null | undefined, brief: string | null | undefined): CastEntry[] {
  const out = (stored ?? []).map(e => ({ ...e }));
  for (const e of castFromBrief(brief)) {
    const x = storedMatch(out, e);
    if (x) x.look = e.look;
    else out.push(e);
  }
  return out.slice(0, 40);
}

/**
 * The brief with its cast sections matching the stored cast: an entry's line shows its current name and look, a
 * removed entry's line goes, and an entry the brief lacks is added under its heading. Other lines stay as written.
 */
export function briefWithCast(
  brief: string | null | undefined,
  cast: CastEntry[],
  removed: string[] = [],
  /** Old name → new name: a renamed entry keeps its place in the brief. */
  renames: Record<string, string> = {},
) {
  const lines: string[] = [];
  const gone = new Set(removed.map(n => n.toLowerCase()));
  const renamed = new Map(Object.entries(renames).map(([a, b]) => [a.toLowerCase(), b.toLowerCase()]));
  // Each entry's look as the brief has it now, sub-lines included: an unchanged entry keeps its lines as written.
  const written = new Map(castFromBrief(brief).map(e => [e.name.toLowerCase(), e.look]));
  let skipping = false;
  scanBrief(brief, (raw, section, entry) => {
    if (section && entry && !subLine.test(entry.name)) {
      const key = entry.name.toLowerCase();
      const x = cast.find(c => c.name.toLowerCase() === (renamed.get(key) ?? key));
      // A removed entry, or one whose look changed (its sub-lines are part of the new look), is rewritten whole.
      const lookChanged = x !== undefined && x.look !== written.get(key);
      skipping = gone.has(key) || lookChanged;
      if (gone.has(key)) return;
      const bullet = raw.match(/^\s*(?:[-•]|\d+\.)\s*/)?.[0] ?? '- ';
      lines.push(
        x && (lookChanged || renamed.has(key)) ? `${bullet}${x.name}: ${lookChanged ? x.look : entry.look}` : raw,
      );
      return;
    }
    // The sub-lines ("Wardrobe: …") of a removed or rewritten entry go with it.
    if (skipping && section && entry) return;
    skipping = false;
    lines.push(raw);
  });
  // A cast heading left with no entries goes too.
  const cleaned = lines.filter((l, i) => {
    if (!Object.values(headings).some(h => new RegExp(h.re.source, 'i').test(l))) return true;
    const next = lines.slice(i + 1).find(x => x.trim());
    return next !== undefined && !/^\s*#/.test(next);
  });
  // Listed under a short or full form ("Noor" for "Noor Haddad") counts as listed.
  const present = castFromBrief(cleaned.join('\n'));
  return addToBrief(
    cleaned.join('\n').replace(/\n{3,}/g, '\n\n'),
    cast.filter(c => !storedMatch(present, c)),
  ).trim();
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
  // "The" and titles such as "Dr." are not part of who someone is: "Dr. Amara Okafor-Lind" is the same as "Amara".
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/^(the|dr|mr|mrs|ms|miss|prof|professor|captain|capt|sir|lady|lord)\.?\s+/, '')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim();
  const x = norm(a),
    y = norm(b);
  if (!x || !y) return false;
  return x === y || x.split(' ')[0] === y.split(' ')[0];
}

/** A look split into its details at commas, semicolons and sentence ends, never inside brackets ("(red, amber)"). */
export function lookParts(look: string): string[] {
  const out: string[] = [];
  let depth = 0,
    cur = '';
  for (let i = 0; i < look.length; i++) {
    const c = look[i]!;
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    const end = depth === 0 && (c === ',' || c === ';' || (c === '.' && /\s/.test(look[i + 1] ?? ' ')));
    if (end) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(p => p.trim().replace(/\.$/, '')).filter(Boolean);
}

/**
 * Whether one detail of a look is something a picture can show. A lone word is a trait ("dry", "calm",
 * "unsentimental") unless it names something visible; relations, ages and personality are never drawn. One test for
 * the server (which adds looks to prompts) and the brief check (which suggests them), so both agree.
 */
const visibleWords =
  /\b(hair|bob|braid|bun|beard|moustache|mustache|stubble|freckles?|scar|eyes?|glasses|spectacles|skin|tattoo|coat|jacket|jumper|sweater|shirt|dress|skirt|trousers|jeans|boots?|shoes?|hat|cap|scarf|gloves?|apron|overalls|oilskin|uniform|cloak|bag|satchel|belt|ring|earrings?|necklace|chain|watch|patch|badge|wings?|tail|fur|feathers?|paint|wood|metal|brass|copper|iron|steel|glass|paper|stone|brick|red|orange|yellow|gold|green|teal|blue|navy|purple|pink|white|black|grey|gray|silver|brown|tall|short|slim|thin|stocky|broad|bald|small|large|tiny|huge|round|square|cracked|rusted|weathered|missing|limp|wheel|lamp|lantern|door|roof|tower|window)\b/i;
const traitWords =
  /\b(calm|kind|kindly|gentle|shy|brave|curious|stubborn|cheerful|grumpy|witty|humou?r|funny|wise|patient|anxious|nervous|proud|lonely|thoughtful|playful|sarcastic|optimistic|melancholic|cheeky|mischievous|quiet|serious|bold|clever|bright|warm|cold|stern|determined|fierce|tender|dreamy|restless|weary|energetic|focused|dry|unsentimental|sentimental|practical|gruff|loyal|honest|personality|temperament|loves|likes|hates|fears|dreams of)\b/i;
const relationWords =
  /\b(grand)?(son|daughter|mother|father|mum|mom|dad|brother|sister|aunt|uncle|wife|husband|partner|friend|neighbou?r|apprentice|boss|niece|nephew|cousin)s?\b/i;
export function isVisibleDetail(part: string): boolean {
  const p = part.trim();
  if (p.length < 3 || /^\d+(\s*years?\s*old)?$/i.test(p)) return false;
  if (relationWords.test(p) && !visibleWords.test(p)) return false;
  if (traitWords.test(p) && !visibleWords.test(p)) return false;
  // A single word is a detail only when it names something visible ("freckles", "bald").
  if (!/\s/.test(p) && !visibleWords.test(p)) return false;
  return true;
}
