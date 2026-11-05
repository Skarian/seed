import type { ChatCard, ChatMessage, Project, ImageRequest, JobRecord } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { latest, assetName } from '../format.js';
import { inputLabels } from '../../../shared/reference-labels.js';

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

/** The crop shape a project plans to deliver, remembered on this device once a crop-later fix is accepted or a crop is saved. */
export const cropKey = (projectId: string) => 'seed.cropTo.' + projectId;
/** The owner chose to deliver at this shape: remember it here and ask the project page to save it with the project. */
export function chooseFrame(projectId: string, frame: string) {
  localStorage.setItem(cropKey(projectId), frame);
  dispatchEvent(new CustomEvent('seed:frame', { detail: { projectId, frame } }));
}
/** A soft check is advice (it never turns Make into "Make anyway"); the others are mismatches with what was asked. */
/** What a check is about, so the app can act on it without reading its wording. */
export type CheckCode = 'shape' | 'length' | 'sound' | 'added-sound' | 'continuity' | 'unused-input';
export type Check = { code: CheckCode; text: string; fixes: Fix[]; soft?: boolean };

/** What the user explicitly asked for in their latest messages: shape, length and sound. Newest wins. */
export function askedFor(messages: ChatMessage[]) {
  const said: { aspect?: Aspect | 'portrait' | 'landscape'; other?: string; seconds?: number; silent?: boolean } = {};
  for (const m of [...messages]
    .reverse()
    .filter(x => x.role === 'user')
    .slice(0, 3)) {
    const t = m.text.toLowerCase();
    if (!said.aspect && !said.other) {
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
      const square =
        /\bsquare\b(?![\s-]*(?:face|faced|jaw|chin|shoulders?|head|glasses|neck|window|room|tower|stones?|tiles?|building))/.test(
          t,
        );
      const portrait =
        /\b(?:vertical|portrait(?!\s+of\b)(?![\s-]*(?:lens|lighting|mode)))\b/.test(t) &&
        !/\bportrait(?:\s+orientation)?\s+of\b/.test(t);
      const landscape = /\b(?:landscape|horizontal|widescreen)\b(?![\s-]*(?:painting|photography|artist|of\b))/.test(t);
      said.aspect = exact ?? (square ? '1:1' : portrait ? 'portrait' : landscape ? 'landscape' : undefined);
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

/** Where a draft differs from what was asked, with one-tap fixes. Unsupported asks get the supported choices. */
export function checkDraft(card: ChatCard, project: Project, siblings = 1): Check[] {
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
  const asked = trigger && forAll ? askedFor([trigger]) : {};
  const aspect = r.output.aspect;
  if (asked.aspect && aspect !== 'source') {
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
  if (asked.other && aspect !== 'source') {
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
      (project.frame === asked.other ||
        (typeof localStorage !== 'undefined' &&
          project.id !== undefined &&
          localStorage.getItem(cropKey(project.id)) === asked.other));
    if (!settled)
      out.push({
        code: 'shape',
        text: `You asked for ${asked.other}, which Seed can't make directly. This draft is ${names[aspect]}.${croppable ? ` After it's made, Crop turns it into ${asked.other} on this device, no GPU.` : ''}`,
        fixes,
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
  const gaps = briefGapList(r.prompt, project.brief ?? '');
  if (gaps.length) {
    const whose = [...new Set(gaps.map(g => g.who).filter(Boolean))];
    const parts = [
      ...whose.map(
        w =>
          `${w}’s ${gaps
            .filter(g => g.who === w)
            .map(g => g.text)
            .join(', ')}`,
      ),
      ...gaps.filter(g => !g.who).map(g => `“${g.text}”`),
    ];
    out.push({
      code: 'continuity',
      soft: true,
      text: `Continuity check, not in this prompt: ${parts.join('; ')}.`,
      fixes: [
        {
          label:
            whose.length === 1
              ? `Add ${whose[0]}’s missing details to this prompt`
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
  /\b(\d+[- ]year[- ]old|years? old|girl|boy|woman|man|child|kid|teen(ager)?|keeper|lighthouse keeper)\b/i;

/** Missing brief details with the character they belong to (none for rules), so a fix can place them beside the name. */
export function briefGapList(prompt: string, brief: string): Array<{ who?: string; text: string }> {
  if (!brief.trim()) return [];
  const out: Array<{ who?: string; text: string }> = [];
  const closeUp = /\b(close-?up|insert|macro|detail shot)\b/i.test(prompt),
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
      const m = item.match(/^([A-Z][\w'’-]+(?: [A-Z][\w'’-]+)?)\s*[:–—-]\s*(.+)$/);
      if (!m) continue;
      // "Wardrobe:" or "Props:" lines belong to the characters above them.
      const generic = /^(wardrobe|costume|outfit|props?|look|appearance)$/i.test(m[1]!);
      const named = new RegExp('\\b' + m[1]!.split(' ')[0] + '\\b', 'i').test(prompt);
      if (named) {
        anyNamed = true;
        lastName = m[1]!.split(' ')[0];
      }
      if (!(named || (generic && anyNamed))) continue;
      // A distant figure shows no freckles or scars: in a wide or tiny framing only the outfit and props are checked.
      const far =
        /\b(extreme wide|wide shot|wide establishing|establishing|tiny|small in (the )?frame|silhouette|distant|aerial|from afar)\b/i.test(
          prompt,
        );
      if (far && !generic) continue;
      for (const part of m[2]!
        .split(/[,;]|\.\s/)
        .map(p =>
          p
            .trim()
            .replace(/\.$/, '')
            .replace(/^(and|or|with)\s+/i, ''),
        )
        .filter(p => p.length > 2 && !/^\d+(\s*years?\s*old)?$/i.test(p))) {
        if ((named && identity.test(part)) || (closeUp && lowerBody.test(part)) || (hands && headAndFace.test(part)))
          continue;
        if (!mentions(prompt, part)) out.push({ who: lastName, text: part.charAt(0).toLowerCase() + part.slice(1) });
      }
    } else if (/rule|always|never|constraint/.test(section)) {
      // A rule about the project as a whole ("keep wardrobe consistent across shots") is not a visible detail to
      // put in one prompt; only concrete rules ("no text anywhere") are checked.
      const abstract =
        /\b(continuity|consisten\w*|maintain|ensure|match(es|ing)?|same as|across (all |every |the )?(shots|scenes|frames)|every shot|each shot)\b/i;
      if (item.length <= 80 && !abstract.test(item) && !mentions(prompt, item))
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
    const at = out.search(new RegExp('\\b' + who + '\\b'));
    if (at >= 0) out = out.slice(0, at + who.length) + ` (${details})` + out.slice(at + who.length);
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
  // Only a shot tag that starts a line is a heading; one inside a sentence just names the shot.
  // Inside a video prompt, [Shot N] numbers the parts of this one clip, not the film's shots.
  return (
    text
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

/** A silent clip should not keep describing sound: rewrite the prompt's Sound section (if any) to silence. */
export function silencedPrompt(prompt: string) {
  const lines = prompt.split('\n');
  // "Sound:" as people write it, or the video format's own overall_soundscape field.
  const head = /^\s*(?:#+\s*)?(?:sound|audio|overall_soundscape)\s*:/i;
  const at = lines.findIndex(l => head.test(l));
  if (at < 0) return prompt;
  // The section runs until the next "Label:" line, [Shot N] part or blank line.
  let end = at + 1;
  while (
    end < lines.length &&
    lines[end]!.trim() &&
    !/^\s*(?:#+\s*)?(?:[A-Z][\w ]{1,24}|[a-z]+(?:_[a-z]+)+)\s*:|^\s*\[Shot \d+\]/.test(lines[end]!)
  )
    end++;
  const label = lines[at]!.match(head)![0];
  return [...lines.slice(0, at), label + ' Silence.', ...lines.slice(end)].join('\n');
}
