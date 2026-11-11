import type { ChatCard, ChatMessage, Project, ImageRequest, JobRecord } from '../api.js';
import { asksSavedStyle } from '../../../shared/styles-asked.js';
import { castOf, sameCast, lookParts, isVisibleDetail } from '../../../shared/cast.js';
import { approvedReference } from '../../../shared/choices.js';
import { kindOf, isVideoKind } from '../api.js';
import { latest, assetName } from '../format.js';
import { inputLabels } from '../../../shared/reference-labels.js';
import { sizeChoices, resolveDimensions } from '../../../shared/resolution.js';
import { silencedPrompt, type ShotFields } from '../../../shared/generation.js';

/** The shapes Crop offers, including film ratios; checks promise a crop only to one of these. */
export const cropShapes = [
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1.85:1', 1.85],
  ['21:9', 21 / 9],
  ['2.39:1', 2.39],
] as const;
type Aspect = '16:9' | '9:16' | '1:1' | '4:5';
export type Fix = {
  label: string;
  patch: (r: ImageRequest) => Record<string, unknown>;
  action?: 'edit-myself';
  assets?: string[];
  /** Accepting this fix means the owner plans to crop the result to this shape; Crop then starts there. */
  cropTo?: string;
};

/** A soft check is advice (it never turns Make into "Make anyway"); the others are mismatches with what was asked. */
/** What a check is about, so the app can act on it without reading its wording. */
export type CheckCode =
  'shape' | 'size' | 'length' | 'sound' | 'added-sound' | 'continuity' | 'unused-input' | 'old-reference' | 'no-style';
export type Check = { code: CheckCode; text: string; fixes: Fix[]; soft?: boolean };

/** What the user explicitly asked for in their latest messages: shape, length and sound. Newest wins. */
export function askedFor(messages: ChatMessage[]) {
  const said: {
    aspect?: Aspect | 'portrait' | 'landscape';
    other?: string;
    seconds?: number;
    silent?: boolean;
    mixed?: boolean;
    pixels?: [number, number];
  } = {};
  for (const m of [...messages]
    .reverse()
    .filter(x => x.role === 'user')
    .slice(0, 3)) {
    const t = m.text.toLowerCase();
    if (!said.aspect && !said.other && !said.mixed) {
      // A ratio Seed cannot make directly (3:2, 21:9, 2:3…): remember it so the plan can say so.
      // A clock time ("stopped at 6:17", "6:17 pm") is scene content, not a shape; decimal ratios such as 2.39:1 count.
      const ratio = t.match(/(?<![\d.])(\d{1,2}(?:\.\d{1,2})?):(\d{1,2})\b(?!\s*(?:am|pm|a\.m|p\.m))/);
      const clock =
        ratio &&
        (/\b(at|clock|time|stopped|reads?|shows?|o'clock|midnight|noon)\s*$/.test(
          t.slice(0, ratio.index).trim().split(/\s+/).slice(-2).join(' '),
        ) ||
          (!ratio[1]!.includes('.') && Number(ratio[2]) > 21));
      if (
        ratio &&
        !clock &&
        !['4:5', '1:1', '16:9', '9:16'].includes(ratio[0]) &&
        Number(ratio[1]) > 0 &&
        Number(ratio[2]) > 0 &&
        Number(ratio[1]) <= 32 &&
        Number(ratio[2]) <= 32
      ) {
        said.other = ratio[0];
        continue;
      }
      const exact = t.match(/\b(4:5|1:1|16:9|9:16)\b/)?.[1] as Aspect | undefined;
      // Shape words describe the frame, not a face, a room or a camera move: "square face", "a wide shot" and
      // "a portrait of Mara" are not canvas requests.
      // "Square" is a shape request only when it is about the picture ("a square image", "make it square", "square
      // format"); "a square navy repair", "a square jaw" or "the town square" describe the scene.
      const square =
        /\bsquare(?=[\s-]*(?:image|images|picture|pictures|photo|photos|clip|clips|video|videos|poster|posters|cover|avatar|icon|format|frame|crop|aspect|ratio|tile|tiles|post|posts|version|canvas|thumbnail|shape|one|[.,;!?)]|$))|\b(?:in|as|at|make (?:it|them|this)|keep (?:it|them)|go) square\b/.test(
          t,
        ) && !/\b(?:town|market|village|city|main|public) square\b/.test(t);
      // "Portrait framing", "a three-quarter portrait", "a portrait shot" and "vertical pan" describe the picture, not
      // the canvas: only a shape word that stands for the frame itself counts. ("A wide landscape shot" is a frame.)
      const composition = (extra: string) =>
        `(?![\\s-]*(?:lens|lighting|mode|framing|framed|composition|close-?up|crop|style|pose|angle|pan|tilt|move|lines?|stripes?|painting|photography|artist|of\\b${extra}))`;
      const portrait =
        // "Noor's portrait", "her portrait" or "the portrait" is a picture, not a shape.
        new RegExp(
          "(?<!three-quarter |3/4 |profile |['’]s |her |his |their |its |my |your |the )\\b(?:vertical|portrait)\\b" +
            composition('|shot'),
        ).test(t) && !/\bportrait(?:\s+orientation)?\s+of\b/.test(t);
      const landscape = new RegExp('\\b(?:landscape|horizontal|widescreen)\\b' + composition('')).test(t);
      // One message naming several shapes ("a portrait one-sheet, a square tile and a wide banner") is about several
      // deliverables: there is no single shape to hold every draft to, so no shape check at all.
      const shapes = new Set([
        ...(t.match(/\b(?:4:5|1:1|16:9|9:16)\b/g) ?? []).map(x =>
          x === '4:5' || x === '9:16' ? 'portrait' : x === '1:1' ? 'square' : 'landscape',
        ),
        ...(square ? ['square'] : []),
        ...(portrait ? ['portrait'] : []),
        ...(landscape || /\b(?:wide|panoramic)\s+(?:banner|header|strip)\b/.test(t) ? ['landscape'] : []),
      ]);
      if (shapes.size > 1) said.mixed = true;
      else said.aspect = exact ?? (square ? '1:1' : portrait ? 'portrait' : landscape ? 'landscape' : undefined);
    }
    // An exact pixel size ("1920×1080", "1920 x 1080 px").
    if (!said.pixels) {
      const px = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
      if (px) said.pixels = [Number(px[1]), Number(px[2])];
    }
    if (said.seconds === undefined) {
      const s = t.match(/\b(\d{1,2})[- ]?(?:seconds?|secs?|s)\b/);
      if (s) said.seconds = Number(s[1]);
    }
    if (said.silent === undefined) {
      if (/\b(silent|no sound|no audio|without (?:sound|audio)|mute)\b/.test(t)) said.silent = true;
      else if (/\b(with sound|with audio|sound of|soundtrack)\b/.test(t)) said.silent = false;
    }
  }
  return said;
}

const names: Record<string, string> = {
  '16:9': 'landscape 16:9',
  '9:16': 'portrait 9:16',
  '1:1': 'square',
  '4:5': 'portrait 4:5',
};
const withAspect = (aspect: Aspect) => (r: ImageRequest) => ({ ...strip(r), output: { ...r.output, aspect } });
function strip(r: ImageRequest) {
  const { workflow: _w, mode: _m, resolved_seeds: _s, ...rest } = r as ImageRequest & { resolved_seeds?: unknown };
  return rest as Record<string, unknown> & { output: ImageRequest['output'] };
}

/** Checks are computed when read and kept per project copy: a new copy (any save) computes them again. */
const memo = new WeakMap<Project, Map<string, Check[]>>();
/** Where a draft differs from what was asked, with one-tap fixes. Unsupported asks get the supported choices. */
export function checkDraft(card: ChatCard, project: Project, siblings = 1): Check[] {
  let held = memo.get(project);
  if (!held) memo.set(project, (held = new Map()));
  const key = card.id + ':' + latest(card).number + ':' + siblings;
  if (!held.has(key)) held.set(key, draftChecks(card, project, siblings));
  return held.get(key)!;
}
/** The owner's "keep it as drafted" on one check of one draft. A changed problem has new text, so it asks again. */
export const ackKey = (card: ChatCard, check: Check) => card.id + ':' + check.text;
function draftChecks(card: ChatCard, project: Project, siblings: number): Check[] {
  const r = latest(card).request,
    kind = kindOf[r.workflow],
    video = isVideoKind(kind),
    out: Check[] = [];
  // Only the message that produced this version of the draft counts. With several drafts, a setting is
  // checked only when that message plainly addresses all of them ("make them all square").
  // The message that asked for this draft: a manual edit keeps the request it revised, so its checks still apply.
  const origin = [...card.revisions].reverse().find(v => v.run_id)?.run_id;
  const at = project.messages.findIndex(m => m.id === origin);
  const trigger = at > 0 ? [...project.messages.slice(0, at)].reverse().find(m => m.role === 'user') : undefined;
  const forAll = siblings <= 1 || /\b(all|every|each|both|them)\b/i.test(trigger?.text ?? '');
  const asked: ReturnType<typeof askedFor> = trigger && forAll ? askedFor([trigger]) : {};
  // An input that is an older reference of a cast member (approved since, or replaced) is swapped for the approved one.
  const cast = castOf(project);
  for (const ref of r.references ?? []) {
    const made = project.jobs.find(j => j.outputs.includes(ref.asset_id));
    const who = made?.request.title?.match(/^Reference:\s*(.+)$/i)?.[1];
    const entry = who ? cast.find(e => sameCast(e.name, who)) : undefined;
    const approved = entry ? approvedReference(project.choices, entry.name) : undefined;
    if (!entry || !approved || approved === ref.asset_id) continue;
    out.push({
      code: 'old-reference',
      text: `This draft uses an older picture of ${entry.name}, not the approved reference.`,
      fixes: [
        {
          label: `Use ${entry.name}’s approved reference`,
          patch: x => ({
            ...strip(x),
            references: (x.references ?? []).map(y => (y.id === ref.id ? { ...y, asset_id: approved } : y)),
          }),
        },
      ],
    });
  }
  // A delivery ratio Seed cannot make (2.39:1) belongs to the whole film, not to one message: the project's delivery
  // frame, or else the latest message that names one, applies to every draft alike (so revising one shot cannot move it).
  if (!asked.other && !video) {
    const latestOther = [...project.messages]
      .reverse()
      .filter(m => m.role === 'user')
      .map(m => askedFor([m]).other)
      .find(Boolean);
    // A draft's own delivery shape (the poster at 2:3, lobby cards at 16:9) wins over the project's or a message's.
    const own = r.shot?.delivery;
    const supported = ['16:9', '9:16', '4:5', '1:1'];
    const other = own ? (supported.includes(own) ? undefined : own) : (project.frame ?? latestOther);
    if (other) asked.other = other;
  }
  // A style the user asked for cannot ride on a picture made from references: say so on the draft, not only in grey.
  if (
    r.workflow === 'image-to-image' &&
    !(r.loras ?? []).length &&
    // The style may have been asked a message or two before the one that drafted this ("Draft 3 keyframes").
    (at > 0 ? project.messages.slice(0, at) : [])
      .filter(m => m.role === 'user')
      .slice(-3)
      .some(m => asksSavedStyle(m.text))
  )
    out.push({
      code: 'no-style',
      soft: true,
      text: 'You asked for a style. Styles can’t be used on pictures made from references (FLUX 3 Image Klein), so this draft has none and its look comes from the prompt and the references. A picture from words (Krea 2) can use the style.',
      fixes: [],
    });
  // A draft that can carry a style, asked for one in the message that made it, and has none: say so plainly.
  if (
    r.workflow !== 'image-to-image' &&
    !(r.loras ?? []).length &&
    trigger &&
    asksSavedStyle(trigger.text) &&
    // The style was meant for this draft: its title, kind (clip, animation) or "it" is in the same sentence.
    trigger.text
      .split(/(?<=[.!?])\s+/)
      .some(
        s =>
          /\bstyle\b/i.test(s) &&
          (video ? /\b(clip|animat\w*|video|motion)\b/i.test(s) : !/\b(clip|animat\w*|video|motion)\b/i.test(s)),
      )
  )
    out.push({
      code: 'no-style',
      text: 'You asked for a style on this draft, but it has none. Choose it in Edit, under Style.',
      fixes: [],
    });
  const aspect = r.output.aspect;
  // References and reference sheets have their own shapes (4:5 for a character); the film's shape is not theirs.
  const isReference = /^reference( sheet)?:/i.test(r.title ?? '');
  if (asked.aspect && aspect !== 'source' && !isReference) {
    const portrait = aspect === '9:16' || aspect === '4:5';
    const ok =
      asked.aspect === 'portrait'
        ? portrait
        : asked.aspect === 'landscape'
          ? aspect === '16:9'
          : asked.aspect === aspect;
    if (!ok) {
      const want =
        asked.aspect === 'portrait' ? (video ? '9:16' : '4:5') : asked.aspect === 'landscape' ? '16:9' : asked.aspect;
      if (video && (want === '1:1' || want === '4:5'))
        out.push({
          code: 'shape',
          text: `You asked for ${names[want]}, which video can't make, and Seed can't crop a video afterwards. This draft is ${names[aspect]}.`,
          fixes: (['16:9', '9:16'] as const)
            .filter(a => a !== aspect)
            .map((a): Fix => ({ label: 'Use ' + names[a], patch: withAspect(a) }))
            .concat([{ label: 'Keep ' + names[aspect], patch: () => ({}) }]),
        });
      else
        out.push({
          code: 'shape',
          text: `You asked for ${names[want]}; this draft is ${names[aspect]}.`,
          fixes: [{ label: 'Make it ' + names[want], patch: withAspect(want as Aspect) }],
        });
    }
  }
  if (asked.other && aspect !== 'source' && !isReference) {
    const [w, h] = asked.other.split(':').map(Number) as [number, number],
      want = w / h;
    const supported: Aspect[] = video ? ['16:9', '9:16'] : ['16:9', '1:1', '4:5', '9:16'];
    const value = (a: Aspect) => {
      const [x, y] = a.split(':').map(Number) as [number, number];
      return x / y;
    };
    // The closest supported shape that still contains the asked one, so a crop loses as little as possible.
    const closest = [...supported].sort(
      (a, b) => Math.abs(Math.log(value(a) / want)) - Math.abs(Math.log(value(b) / want)),
    )[0]!;
    const fixes: Fix[] = closest !== aspect ? [{ label: 'Use ' + names[closest], patch: withAspect(closest) }] : [];
    // Promise a crop only to a shape Crop actually offers.
    const croppable = !video && cropShapes.some(([s]) => s === asked.other);
    fixes.push({
      label: croppable ? `Keep ${names[aspect]}, crop to ${asked.other} after` : 'Keep ' + names[aspect],
      patch: () => ({}),
      ...(croppable ? { cropTo: asked.other } : {}),
    });
    // Once the owner chose "crop to X after" for this project, every draft at the closest shape is already settled.
    const settled =
      croppable &&
      closest === aspect &&
      project.frame === asked.other;
    if (!settled)
      out.push({
        code: 'shape',
        text: `You asked for ${asked.other}, which Seed can't make directly. This draft is ${names[aspect]}.${croppable ? ` After it's made, Crop turns it into ${asked.other} on this device, no GPU.` : ''}`,
        fixes,
      });
  }
  // An exact pixel size the user asked for: the draft should be the closest size Seed offers at that shape.
  if (asked.pixels && r.output.aspect !== 'source') {
    const [w, h] = asked.pixels;
    const dims = (size: string) => {
      try {
        return resolveDimensions(r.workflow, size as never, r.output.aspect);
      } catch {
        return undefined;
      }
    };
    const now = dims(String(r.output.size));
    const best = sizeChoices(r.workflow)
      .map(p => ({ id: String(p.id), d: dims(p.id) }))
      .filter((x): x is { id: string; d: { width: number; height: number } } => Boolean(x.d))
      .sort((a, b) => Math.abs(a.d.width * a.d.height - w * h) - Math.abs(b.d.width * b.d.height - w * h))[0];
    if (now && best && best.id !== r.output.size && (now.width !== w || now.height !== h))
      out.push({
        code: 'size',
        text: `You asked for ${w} × ${h}; this draft is ${now.width} × ${now.height}. The closest size Seed makes is ${best.d.width} × ${best.d.height}.`,
        fixes: [
          {
            label: `Use ${best.d.width} × ${best.d.height}`,
            patch: x => ({ ...strip(x), output: { ...x.output, size: best.id } }),
          },
        ],
      });
  }
  if (
    video &&
    asked.seconds &&
    asked.seconds >= 5 &&
    asked.seconds <= 15 &&
    r.output.duration_seconds !== asked.seconds
  )
    out.push({
      code: 'length',
      text: `You asked for ${asked.seconds} seconds; this draft is ${r.output.duration_seconds ?? 5}.`,
      fixes: [
        {
          label: `Make it ${asked.seconds} s`,
          patch: x => ({ ...strip(x), output: { ...x.output, duration_seconds: asked.seconds } }),
        },
      ],
    });
  if (video && asked.silent !== undefined && (r.audio?.output === 'silent') !== asked.silent)
    out.push({
      code: 'sound',
      text: asked.silent
        ? 'You asked for silence; this draft has sound.'
        : 'You asked for sound; this draft is silent.',
      fixes: [
        {
          label: asked.silent ? 'Make it silent' : 'Add sound',
          patch: x => ({
            ...strip(x),
            audio: { output: asked.silent ? 'silent' : 'generated' },
            ...(asked.silent ? { prompt: silencedPrompt(x.prompt) } : {}),
          }),
        },
      ],
    });
  // Sound the person never mentioned is a creative choice: say so, and make silence one tap.
  if (
    video &&
    asked.silent === undefined &&
    trigger &&
    !/\b(sound|audio|music|ambien\w*|noise|voice|dialog\w*|speak\w*|sings?|score)\b/i.test(trigger.text) &&
    r.audio?.output !== 'silent'
  )
    out.push({
      code: 'added-sound',
      text: 'Seed added sound to this clip, which you didn’t ask for.',
      fixes: [
        {
          label: 'Make it silent',
          patch: x => ({ ...strip(x), audio: { output: 'silent' }, prompt: silencedPrompt(x.prompt) }),
        },
        { label: 'Keep the sound', patch: () => ({}) },
      ],
    });
  // Brief details that apply to this draft but are missing from its prompt. Words only: this checks the request, not the picture.
  // A clip that starts from a keyframe takes the characters' look from that image; their words need no check.
  // A clip that animates a keyframe (its start frame or a picture reference) takes the look from that picture.
  const fromFrame = r.workflow === 'reference-to-video' && (r.references ?? []).some(x => x.kind === 'image');
  // A character, place or prop whose approved reference image is an input of this draft is carried by that image.
  const carried = (name: string) => {
    const id = approvedReference(project.choices, name);
    return Boolean(id && (r.references ?? []).some(x => x.asset_id === id));
  };
  const shown = new Set(
    castOf(project)
      .filter(e => carried(e.name))
      .map(e => e.name.split(' ')[0]!.toLowerCase()),
  );
  const shownPlaces = new Set(
    castOf(project)
      .filter(e => e.kind !== 'character' && carried(e.name))
      .map(e => e.name.toLowerCase().replace(/^the /, '')),
  );
  const subject = (r.title ?? '').match(/^reference(?: sheet)?:\s*(.+)$/i)?.[1]?.toLowerCase();
  const gaps = (fromFrame ? [] : briefGapList(r.prompt, project.brief ?? '', r.shot))
    .filter(g => !g.who || !shown.has(g.who.split(' ')[0]!.toLowerCase()))
    // A place whose approved picture is an input carries its own look.
    .filter(g => !g.where || !shownPlaces.has(g.where.toLowerCase().replace(/^the /, '')))
    .filter(g => !subject || (g.who !== undefined && subject.includes(g.who.toLowerCase())));
  if (gaps.length) {
    const whose = [...new Set(gaps.map(g => g.who).filter(Boolean))];
    const parts = [
      ...whose.map(w =>
        // "Maren's green rubber boots", or for an action, "Maren carries a tin lantern".
        (() => {
          const details = gaps
            .filter(g => g.who === w)
            .map(g => g.text)
            .join(', ');
          return /^(?:carries|carry|wears|wear|has|have|holds|hold|is|are|keeps|walks|rides|uses)\b/i.test(details)
            ? `${nameCase(w!)} ${details}`
            : `${nameCase(w!)}’s ${details}`;
        })(),
      ),
      ...gaps.filter(g => !g.who).map(g => `“${g.text}”`),
    ];
    out.push({
      code: 'continuity',
      soft: true,
      text: `Missing from this prompt: ${parts.join('; ')}.`,
      fixes: [
        {
          label:
            whose.length === 1
              ? `Add the missing ${nameCase(whose[0]!)} details to this prompt`
              : gaps.length === 1
                ? 'Add this detail to the prompt'
                : 'Add these details to the prompt',
          patch: x => ({ ...strip(x), prompt: addBriefDetails(x.prompt, gaps) }),
        },
        { label: 'Not visible in this shot', patch: () => ({}) },
      ],
    });
  }
  // An attachment that the draft does not use (it is made from words only).
  const runMessage = at;
  const asking =
    runMessage > 0 ? [...project.messages.slice(0, runMessage)].reverse().find(m => m.role === 'user') : undefined;
  const used = new Set((r.references ?? []).map(x => x.asset_id));
  // Every message that shaped this draft counts: an image attached at the start is still unused after a follow-up.
  const askedBy = (runId: string) => {
    const reply = project.messages.findIndex(m => m.id === runId);
    return reply > 0 ? [...project.messages.slice(0, reply)].reverse().find(m => m.role === 'user') : undefined;
  };
  const attached = card.revisions.flatMap(v => (v.run_id ? askedBy(v.run_id)?.assets : undefined) ?? []);
  const unused = [...new Set([...(asking?.assets ?? []), ...attached])].filter(a => !used.has(a));
  if (unused.length && !(r.references ?? []).length)
    out.push({
      code: 'unused-input',
      text: `Your attached ${unused.length === 1 ? 'image is' : 'files are'} not used by this draft; it is made from words only.`,
      fixes: [
        { label: 'Make it as an edit of the attached image', patch: () => ({}), action: 'edit-myself', assets: unused },
      ],
    });
  return out;
}

const stop = new Set([
  'the',
  'and',
  'with',
  'her',
  'his',
  'their',
  'a',
  'an',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'over',
  'through',
  'small',
  'old',
  'years',
  'year',
  'from',
  'into',
  'every',
  'always',
  'never',
  'anywhere',
  'shot',
  'shots',
]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9:'\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(w => w.length > 2 && !stop.has(w));
/** Whether a phrase is in a prompt in substance: most of its meaningful words appear (word starts, so "curls" matches "curly"). */
function mentions(prompt: string, phrase: string) {
  const have = new Set(words(prompt).map(w => w.slice(0, 4))),
    need = words(phrase);
  if (!need.length) return true;
  return need.filter(w => have.has(w.slice(0, 4))).length / need.length >= 0.5;
}
/**
 * Character details and rules from the brief that a draft should carry but does not. A character's details apply when
 * the prompt names them; rules ("No text anywhere") apply to every draft. Returns short phrases, at most five.
 */
export function briefGaps(prompt: string, brief: string) {
  return briefGapList(prompt, brief).map(g => g.text);
}

/** A detail a shot can't show is not a gap: no boots in a close-up, no hair in a close-up of hands. */
const lowerBody = /\b(boots?|shoes?|trousers|pants|skirt|socks|wellingtons?|sneakers|jeans|legs?)\b/i;
const headAndFace =
  /\b(hair|bob|braid|curls?|fringe|bangs|freckles?|eyes?|face|scar|beard|eyebrows?|glasses|age|years?)\b/i;
/** Who the person is ("10-year-old girl") is covered once the prompt uses their name. */
const identity =
  /\b(\d+[- ]year[- ]old|years? old|girl|boy|woman|man|child|kid|teen(ager)?|female|male|non-binary|adult|elderly|(?:early|mid|late) \d0s|in (?:her|his|their) \d0s|\d0s)\b/i;

/** Missing brief details with the character they belong to (none for rules), so a fix can place them beside the name. */
export function briefGapList(
  prompt: string,
  brief: string,
  shot?: ShotFields,
): Array<{ who?: string; where?: string; text: string }> {
  if (!brief.trim()) return [];
  const out: Array<{ who?: string; where?: string; text: string }> = [];
  // A draft that records its shot says who is in frame and how it is framed; the wording is read only for older drafts.
  const framing = shot?.framing ?? prompt;
  const inShot = (first: string) => {
    const has = (list?: string[]) => list?.some(n => n.split(' ')[0]!.toLowerCase() === first.toLowerCase());
    if (has(shot?.offscreen)) return false;
    if (shot?.cast) return Boolean(has(shot.cast));
    return undefined;
  };
  const closeUp =
      /\b(close-?up|insert|macro|detail shot|waist-?up|chest-?up|head[- ]and[- ]shoulders|medium close|bust|tight on)\b/i.test(
        framing,
      ),
    hands = closeUp && /\bhands?\b/i.test(prompt);
  let section = '',
    anyNamed = false,
    lastName: string | undefined;
  for (const raw of brief.split('\n')) {
    const line = raw.replace(/[*_`]/g, '').trim();
    const heading =
      line.match(/^#+\s*(.+)$/)?.[1] ??
      (/^[A-Za-z ]{3,20}:?$/.test(line) && !line.includes(' ') ? line.replace(':', '') : '');
    if (heading) {
      section = heading.toLowerCase();
      continue;
    }
    const item = line.replace(/^(?:[-•]|\d+\.)\s*/, '');
    if (!item) continue;
    if (/character|cast|people/.test(section)) {
      const m = item.match(
        /^((?:(?:Dr|Mr|Mrs|Ms|Prof|Capt|Captain|Sir|Lady)\.?\s+)?\p{Lu}[\p{L}\p{N}'’-]+(?: \p{Lu}[\p{L}\p{N}'’-]+)?)\s*(?:\([^)]{0,30}\))?\s*[:–—-]\s*(.+)$/u,
      );
      if (!m) continue;
      m[1] = m[1]!.replace(/^(?:Dr|Mr|Mrs|Ms|Prof|Capt|Captain|Sir|Lady)\.?\s+/, '');
      // "Wardrobe:" or "Props:" lines belong to the characters above them.
      const generic = /^(wardrobe|costume|outfit|props?|look|appearance)$/i.test(m[1]!);
      const first = m[1]!.split(' ')[0]!;
      // A character the prompt puts out of the picture ("Asha is out of frame", "without Asha") has nothing to check.
      const listed = inShot(first);
      const absent =
        listed === false ||
        (listed === undefined &&
          new RegExp(
            `\\b${first}\\b[^.]{0,60}\\b(?:out of (?:the )?frame|off[- ]?(?:screen|camera|frame)|not (?:in|visible)|absent|has (?:gone|left)|already gone)|\\b(?:without|no sign of|absence of|empty of)\\s+${first}\\b`,
            'i',
          ).test(prompt));
      if (absent) {
        lastName = undefined;
        continue;
      }
      const named = listed ?? new RegExp('\\b' + first + '\\b', 'i').test(prompt);
      if (named) {
        anyNamed = true;
        lastName = m[1]!.split(' ')[0];
      }
      if (!(named || (generic && anyNamed))) continue;
      // A distant figure shows no freckles or scars: in a wide or tiny framing only the outfit and props are checked.
      const far =
        /\b(extreme wide|wide shot|wide establishing|establishing|silhouette|distant|aerial|from afar)\b/i.test(
          framing,
        ) || /^wide$/i.test(shot?.framing?.trim() ?? '');
      if (far && !generic) continue;
      for (const part of lookParts(m[2]!)
        .map(p =>
          p
            .trim()
            .replace(/\.$/, '')
            .replace(/^(and|or|with)\s+/i, '')
            // A label inside the line ("Wardrobe: mustard coat") is not part of the detail.
            .replace(/^(?:wardrobe|costume|outfit|clothes|clothing|look|appearance|props?|hair|face)\s*:\s*/i, '')
            // "She has a silver earring" is the detail "a silver earring".
            .replace(/^(?:she|he|they|it)\s+(?:has|have|wears|wear|is|are|carries|carry)\s+/i, ''),
        )
        .filter(p => p.length > 2 && !/^\d+(\s*years?\s*old)?$/i.test(p))) {
        if ((named && identity.test(part)) || (closeUp && lowerBody.test(part)) || (hands && headAndFace.test(part)))
          continue;
        // An instruction ("preserve her specific wardrobe") is not a visible detail to add to one prompt.
        if (abstractRule.test(part) || deliveryNote.test(part)) continue;
        // A state that belongs to particular shots ("in shot 4 it is mended") is not a detail every draft must carry.
        if (/\bshots?\s*\d/i.test(part)) continue;
        // Personality is not something a picture shows ("calm, dry humour", "curious").
        if (personality.test(part) || !isVisibleDetail(part)) continue;
        // Who someone is to someone else ("grandson", "his aunt") is not something a picture shows.
        if (relation.test(part)) continue;
        if (!mentions(prompt, part)) out.push({ who: lastName, text: part.charAt(0).toLowerCase() + part.slice(1) });
      }
    } else if (/place|location|setting|environment|world|set\b/.test(section)) {
      // Places hold continuity too: a shot set at the lighthouse carries the lighthouse's look. A close-up shows too
      // little of the place to check.
      const m = item.match(/^([A-Z][\w'’ -]{1,40}?)\s*[:–—]\s*(.+)$/);
      if (!m || closeUp) continue;
      const words = m[1]!
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !['the', 'and', 'of'].includes(w));
      const recorded = shot?.place?.toLowerCase();
      const here = recorded
        ? words.some(w => recorded.includes(w))
        : words.length > 0 && words.every(w => new RegExp('\\b' + w + '\\b', 'i').test(prompt));
      if (!here) continue;
      for (const part of lookParts(m[2]!)
        .map(p =>
          p
            .trim()
            .replace(/\.$/, '')
            .replace(/^(and|or|with)\s+/i, ''),
        )
        .filter(p => p.length > 2 && !abstractRule.test(p) && !deliveryNote.test(p) && !mentions(prompt, p)))
        out.push({ where: m[1]!.trim(), text: part.charAt(0).toLowerCase() + part.slice(1) });
    } else if (/rule|always|never|constraint/.test(section)) {
      // A rule about the project as a whole ("keep wardrobe consistent across shots") is not a visible detail to
      // put in one prompt; only concrete rules ("no text anywhere") are checked.
      // A negative ("no text, logos or watermarks") is not added as words: in a diffusion prompt, naming text invites it.
      if (/^(no|never|avoid|without|don.t|do not)\b/i.test(item)) continue;
      if (
        item.length <= 80 &&
        !abstractRule.test(item) &&
        !deliveryNote.test(item) &&
        !/\bshots?\s*\d/i.test(item) &&
        !mentions(prompt, item)
      )
        out.push({ text: item.charAt(0).toLowerCase() + item.slice(1).replace(/\.$/, '') });
    }
  }
  return out.filter((g, i) => out.findIndex(x => x.text === g.text) === i).slice(0, 5);
}

/** Adds missing details beside the character they describe ("Ines, with freckles,") and appends rules at the end. */
export function addBriefDetails(prompt: string, gaps: Array<{ who?: string; text: string }>) {
  let out = prompt.replace(/\s+$/, '');
  for (const who of [...new Set(gaps.map(g => g.who).filter((w): w is string => Boolean(w)))]) {
    const details = gaps
      .filter(g => g.who === who)
      .map(g => g.text)
      .join(', ');
    // Names in a brief are often capitalised differently ("MARA"); match any case, and when the prompt never names the
    // character, add the details as a sentence of their own so the fix always changes the prompt.
    const at = out.search(new RegExp('\\b' + who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\b(?!['’]s\\b)", 'i'));
    // "Mara, with a mustard raincoat," or, for a detail that is an action, "Mara, who carries a tin lantern,".
    const joiner = /^(?:carries|carry|wears|wear|has|have|holds|hold|is|are|keeps|walks|rides|uses)\b/i.test(details)
      ? 'who'
      : 'with';
    if (at >= 0) {
      // The whole name, not just its first word: "Marit Halvorsen, with …", never "Marit, with …, Halvorsen".
      const surname = out.slice(at + who.length).match(/^(?:\s+\p{Lu}[\p{L}'’-]+)+/u)?.[0] ?? '';
      const end = at + who.length + surname.length;
      const after = out.slice(end);
      // No doubled punctuation: before a comma or full stop the inserted phrase ends without its own comma.
      const close = /^\s*[,.;:!?]/.test(after) ? '' : ',';
      out = out.slice(0, end) + `, ${joiner} ${details}${close}` + after;
    } else out += (/[.!?]$/.test(out) ? ' ' : '. ') + `${nameCase(who)}: ${details}.`;
  }
  const rules = gaps.filter(g => !g.who).map(g => g.text[0]!.toUpperCase() + g.text.slice(1));
  return rules.length ? out + (/[.!?]$/.test(out) ? ' ' : '. ') + rules.join('. ') + '.' : out;
}

/** Prompt text for people: input tokens such as <Picture 1> become the input's name. */
export function readablePrompt(r: ImageRequest, project: Project, everywhere: JobRecord[] = []) {
  const labels = inputLabels(r.references ?? []);
  let text = r.prompt.replace(/\[\[([^\]]+)\]\]/g, '$1');
  for (const ref of r.references ?? []) {
    const label = labels.get(ref.id);
    if (label) text = text.split(label).join('“' + assetName(project, ref.asset_id, everywhere) + '”');
  }
  // The server names a reference beside its picture ("<image2> (Inez)"); the picture's own name already says it.
  text = text.replace(/(“[^”]+”) \(([^)]{1,60})\)/g, (m, q: string, who: string) =>
    q.toLowerCase().includes(who.toLowerCase()) ? q : m,
  );
  // Video prompts are structured for the model; show their sections as plain headings.
  const headings: Record<string, string> = {
    integrated_multimodal_description: 'Scene',
    subject_definitions: 'Subjects',
    scene_anchor: 'Setting',
    action_timeline: 'Action',
    camera_path: 'Camera',
    overall_soundscape: 'Sound',
    non_diegetic_music: 'Music',
    retention_analysis: 'Keep',
    detailed_description: 'Detail',
    summary: 'Summary',
  };
  text = text
    .split('\n')
    .filter(line => !/^\s*[a-z]+(?:_[a-z]+)+\s*:\s*N\/?A\.?\s*$/i.test(line))
    .join('\n');
  text = text.replace(
    /^(\s*)([a-z]+(?:_[a-z]+)+)\s*:\s*/gm,
    (_m, space: string, key: string) =>
      space + (headings[key] ?? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())) + ': ',
  );
  // Each <Subject N> is named by its definition ("<Subject 1>: Ada, a courier…" names Ada).
  const names = new Map<string, string>();
  for (const m of text.matchAll(/<\s*Subject\s*(\d+)\s*>\s*:\s*(?:the\s+)?([^,.;:(\n]{1,40})/gi)) {
    const name = m[2]!
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')
      .replace(/\s+(from|in|at|with|who|wearing)$/i, '');
    if (name && !names.has(m[1]!)) names.set(m[1]!, name);
  }
  // Only a shot tag that starts a line is a heading; one inside a sentence just names the shot.
  // Inside a video prompt, [Shot N] numbers the parts of this one clip, not the film's shots.
  return (
    text
      // <Subject 1> tags label people for the video model; a person reads the name alone.
      // "Ines (<Subject 1>)" reads "Ines"; "<Subject 1>: Ines…" at the start of a definition reads "Ines…".
      .replace(/\s*\(\s*<\s*Subject\s*\d+\s*>\s*\)/gi, '')
      .replace(/<\s*Subject\s*\d+\s*>\s*:\s*/gi, '')
      // A bare tag stands for the person: "a shot of <Subject 1> standing" reads "a shot of Ada standing".
      .replace(/(\s*)<\s*Subject\s*(\d+)\s*>/gi, (_m, sp: string, k: string) => (names.has(k) ? sp + names.get(k) : ''))
      .replace(/^(\s*)(\w+): \2\b\s*/gim, '$1$2: ')
      .replace(/^(\s*)(Detail|Summary|Keep): (Style|Look|Detail|Summary|Keep):\s*/gim, '$1$2: ')
      .replace(/^(\s*)Sound: Silen(ce|t)\.?\s*$/gim, '$1Audio: none')
      .replace(/:\s*:/g, ':')
      .replace(/\s\(\s*\)/g, '')
      .replace(/^(\s*)\[Shot (\d+)\]/gm, '$1Part $2:')
      .replace(/\[Shot (\d+)\]/g, 'part $1')
      // The video engine's own scaffolding sentence says nothing to a person; the source is shown beside the draft.
      .replace(scaffold, '')
      // Speaker tags such as "Ines (S2)" tell the video model who is who; a person needs only the name.
      .replace(/\s?\(S\d+\)/g, '')
  );
}

const sections: Array<[string, string]> = [
  ['integrated_multimodal_description', 'Scene'],
  ['subject_definitions', 'Subjects'],
  ['scene_anchor', 'Setting'],
  ['action_timeline', 'Action'],
  ['camera_path', 'Camera'],
  ['overall_soundscape', 'Sound'],
  ['non_diegetic_music', 'Music'],
  ['retention_analysis', 'Keep'],
  ['detailed_description', 'Detail'],
];
const naLine = /^\s*[a-z]+(?:_[a-z]+)+\s*:\s*N\/?A\.?\s*$/i;

/**
 * An editable, person-readable form of a prompt that converts back exactly: known sections become headings,
 * [Shot N] becomes "Shot N:", input tokens become quoted names, and N/A lines are set aside and restored.
 * Returns null when the prompt cannot be round-tripped safely (then the raw prompt is edited instead).
 */
/** The video engine's own scaffolding sentence (from the official animate format): needed by the model, noise to a person. */
const scaffold =
  /For the target video, at [\d.]+ seconds into the target video,[\s\S]{0,240}?(?:is )?(?:fully )?referenced\.[ \t]*/gi;

export function editablePrompt(r: ImageRequest, project: Project, everywhere: JobRecord[] = []) {
  const labels = inputLabels(r.references ?? []);
  const named = (r.references ?? [])
    .map(ref => ({ token: labels.get(ref.id) ?? '', name: '“' + assetName(project, ref.asset_id, everywhere) + '”' }))
    .filter(x => x.token);
  if (new Set(named.map(x => x.name)).size !== named.length) return null;
  // Tags inside a sentence become "part N" only when the prompt had them, so a person's own "part 2" is left alone.
  const mid = /\S[ \t]*\[Shot \d+\]/.test(r.prompt);
  const lines = r.prompt.split('\n'),
    hidden = lines.filter(l => naLine.test(l));
  let text = lines.filter(l => !naLine.test(l)).join('\n');
  // The scaffold stays out of the editor and goes back at the start of the scene when saved.
  const scaffolds = text.match(scaffold) ?? [];
  text = text.replace(scaffold, '');
  for (const [key, label] of sections)
    text = text.replace(new RegExp('^(\\s*)' + key + '\\s*:\\s*', 'gm'), '$1' + label + ': ');
  text = text.replace(/^(\s*)\[Shot (\d+)\]/gm, '$1Part $2:').replace(/\[Shot (\d+)\]/g, 'part $1');
  for (const { token, name } of named) text = text.split(token).join(name);
  const back = (edited: string) => {
    if (edited === text) return r.prompt;
    let out = edited;
    // Words added at the very end describe the picture: they go before the trailing Sound / Music sections, where a
    // later "make it silent" would otherwise replace them.
    if (edited.startsWith(text) && edited.length > text.length) {
      const added = edited.slice(text.length).trim();
      const tail = text.search(
        /\n\s*(?:Sound|Music):[^\n]*(?:\n(?!\s*(?:Scene|Subjects|Setting|Action|Camera|Part \d+):)[^\n]*)*\s*$/,
      );
      if (added && tail > 0) out = text.slice(0, tail).replace(/\s+$/, '') + ' ' + added + text.slice(tail);
    }
    if (scaffolds.length) {
      const lead = scaffolds.join(' ').trim() + ' ';
      out = /^(\s*)Scene:\s*/m.test(out) ? out.replace(/^(\s*)Scene:\s*/m, '$1Scene: ' + lead) : lead + out;
    }
    for (const { token, name } of named) out = out.split(name).join(token);
    out = out.replace(/^(\s*)Part (\d+):/gm, '$1[Shot $2]');
    if (mid) out = out.replace(/\bpart (\d+)\b/g, '[Shot $1]');
    for (const [key, label] of sections)
      out = out.replace(new RegExp('^(\\s*)' + label + ':\\s*', 'gm'), '$1' + key + ': ');
    return hidden.length ? out.replace(/\s+$/, '') + '\n' + hidden.join('\n') : out;
  };
  return text === r.prompt ? null : { text, back };
}

/** "MARA" or "mara" from a brief, written as a name ("Mara"). */
export const nameCase = (name: string) =>
  name === name.toUpperCase() || name === name.toLowerCase()
    ? name.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, c => c.toUpperCase())
    : name;

/** Instructions about keeping things consistent, as opposed to visible details. */
const abstractRule =
  /\b(continuity|consisten\w*|maintain|ensure|preserve|specific|match(es|ing)?|same as|across (all |every |the )?(shots|scenes|frames)|every shot|each shot)\b/i;

/** Character traits that describe a personality, not something a picture shows. */
/** Relationships ("grandson", "his aunt"): who someone is to another person, not something a picture shows. */
const relation =
  /^(?:(?:his|her|their|the)\s+)?(?:son|daughter|child|mother|father|mum|mom|dad|parent|brother|sister|sibling|aunt|uncle|niece|nephew|cousin|wife|husband|partner|friend|neighbou?r|apprentice|boss|grandson|granddaughter|grandmother|grandfather|grandchild)s?(?:\s+of\s+\w+)?$/i;

const personality =
  /\b(calm|kind|kindly|gentle|shy|brave|curious|stubborn|cheerful|grumpy|witty|humou?r|funny|wise|patient|anxious|nervous|proud|lonely|thoughtful|playful|sarcastic|optimistic|melancholic|cheeky|mischievous|quiet|serious|bold|clever|bright|warm|cold|stern|determined|fierce|tender|dreamy|restless|weary|tired|energetic|personality|temperament|loves|likes|hates|fears|dreams of)\b/i;

/** How the film is delivered ("2.39:1 widescreen via Crop", "24 fps") is a setting of the project, not words for a prompt. */
const deliveryNote =
  /\b(delivery|deliver(?:ed|s)?|aspect|ratio|crop(?:ped)?|letterbox\w*|widescreen|anamorphic|format|resolution|fps|frame rate|runtime|duration)\b|\b\d+(?:\.\d+)?\s*[:x×]\s*\d+\b/i;
