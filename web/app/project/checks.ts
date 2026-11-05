import type { ChatCard, ChatMessage, Project, ImageRequest, JobRecord } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { latest, assetName } from '../format.js';
import { inputLabels } from '../../../shared/reference-labels.js';

/** The shapes Crop offers, including film ratios; checks promise a crop only to one of these. */
export const cropShapes = [['1:1', 1], ['4:5', 4 / 5], ['3:2', 3 / 2], ['2:3', 2 / 3], ['16:9', 16 / 9], ['9:16', 9 / 16], ['1.85:1', 1.85], ['21:9', 21 / 9], ['2.39:1', 2.39]] as const;
type Aspect = '16:9' | '9:16' | '1:1' | '4:5';
export type Fix = { label: string; patch: (r: ImageRequest) => Record<string, unknown>; action?: 'edit-myself'; assets?: string[] };
/** A soft check is advice (it never turns Make into "Make anyway"); the others are mismatches with what was asked. */
export type Check = { text: string; fixes: Fix[]; soft?: boolean };

/** What the user explicitly asked for in their latest messages: shape, length and sound. Newest wins. */
export function askedFor(messages: ChatMessage[]) {
  const said: { aspect?: Aspect | 'portrait' | 'landscape'; other?: string; seconds?: number; silent?: boolean } = {};
  for (const m of [...messages].reverse().filter(x => x.role === 'user').slice(0, 3)) {
    const t = m.text.toLowerCase();
    if (!said.aspect && !said.other) {
      // A ratio Seed cannot make directly (3:2, 21:9, 2:3…): remember it so the plan can say so.
      // A clock time ("stopped at 6:17", "6:17 pm") is scene content, not a shape; decimal ratios such as 2.39:1 count.
      const ratio = t.match(/(?<![\d.])(\d{1,2}(?:\.\d{1,2})?):(\d{1,2})\b(?!\s*(?:am|pm|a\.m|p\.m))/);
      const clock = ratio && (/\b(at|clock|time|stopped|reads?|shows?|o'clock|midnight|noon)\s*$/.test(t.slice(0, ratio.index).trim().split(/\s+/).slice(-2).join(' ')) || (!ratio[1]!.includes('.') && Number(ratio[2]) > 21));
      if (ratio && !clock && !['4:5', '1:1', '16:9', '9:16'].includes(ratio[0]) && Number(ratio[1]) > 0 && Number(ratio[2]) > 0 && Number(ratio[1]) <= 32 && Number(ratio[2]) <= 32) { said.other = ratio[0]; continue; }
      const exact = t.match(/\b(4:5|1:1|16:9|9:16)\b/)?.[1] as Aspect | undefined;
      // Shape words describe the frame, not a face, a room or a camera move: "square face", "a wide shot" and
      // "a portrait of Mara" are not canvas requests.
      const square = /\bsquare\b(?![\s-]*(?:face|faced|jaw|chin|shoulders?|head|glasses|neck|window|room|tower|stones?|tiles?|building))/.test(t);
      const portrait = /\b(?:vertical|portrait(?!\s+of\b)(?![\s-]*(?:lens|lighting|mode)))\b/.test(t) && !/\bportrait(?:\s+orientation)?\s+of\b/.test(t);
      const landscape = /\b(?:landscape|horizontal|widescreen)\b(?![\s-]*(?:painting|photography|artist|of\b))/.test(t);
      said.aspect = exact ?? (square ? '1:1' : portrait ? 'portrait' : landscape ? 'landscape' : undefined);
    }
    if (said.seconds === undefined) { const s = t.match(/\b(\d{1,2})[- ]?(?:seconds?|secs?|s)\b/); if (s) said.seconds = Number(s[1]); }
    if (said.silent === undefined) { if (/\b(silent|no sound|no audio|without (?:sound|audio)|mute)\b/.test(t)) said.silent = true; else if (/\b(with sound|with audio|sound of|soundtrack)\b/.test(t)) said.silent = false; }
  }
  return said;
}

const names: Record<string, string> = { '16:9': 'landscape 16:9', '9:16': 'portrait 9:16', '1:1': 'square', '4:5': 'portrait 4:5' };
const withAspect = (aspect: Aspect) => (r: ImageRequest) => ({ ...strip(r), output: { ...r.output, aspect } });
function strip(r: ImageRequest) { const { workflow: _w, mode: _m, resolved_seeds: _s, ...rest } = r as ImageRequest & { resolved_seeds?: unknown }; return rest as Record<string, unknown> & { output: ImageRequest['output'] }; }

/** Where a draft differs from what was asked, with one-tap fixes. Unsupported asks get the supported choices. */
export function checkDraft(card: ChatCard, project: Project, siblings = 1): Check[] {
  const r = latest(card).request, kind = kindOf[r.workflow], video = isVideoKind(kind), out: Check[] = [];
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
    const ok = asked.aspect === 'portrait' ? portrait : asked.aspect === 'landscape' ? aspect === '16:9' : asked.aspect === aspect;
    if (!ok) {
      const want = asked.aspect === 'portrait' ? (video ? '9:16' : '4:5') : asked.aspect === 'landscape' ? '16:9' : asked.aspect;
      if (video && (want === '1:1' || want === '4:5')) out.push({ text: `You asked for ${names[want]}, which video can't make, and Seed can't crop a video afterwards. This draft is ${names[aspect]}.`, fixes: (['16:9', '9:16'] as const).filter(a => a !== aspect).map((a): Fix => ({ label: 'Use ' + names[a], patch: withAspect(a) })).concat([{ label: 'Keep ' + names[aspect], patch: () => ({}) }]) });
      else out.push({ text: `You asked for ${names[want]}; this draft is ${names[aspect]}.`, fixes: [{ label: 'Make it ' + names[want], patch: withAspect(want as Aspect) }] });
    }
  }
  if (asked.other && aspect !== 'source') {
    const [w, h] = asked.other.split(':').map(Number) as [number, number], want = w / h;
    const supported: Aspect[] = video ? ['16:9', '9:16'] : ['16:9', '1:1', '4:5', '9:16'];
    const value = (a: Aspect) => { const [x, y] = a.split(':').map(Number) as [number, number]; return x / y; };
    // The closest supported shape that still contains the asked one, so a crop loses as little as possible.
    const closest = [...supported].sort((a, b) => Math.abs(Math.log(value(a) / want)) - Math.abs(Math.log(value(b) / want)))[0]!;
    const fixes: Fix[] = closest !== aspect ? [{ label: 'Use ' + names[closest], patch: withAspect(closest) }] : [];
    // Promise a crop only to a shape Crop actually offers.
    const croppable = !video && cropShapes.some(([s]) => s === asked.other);
    fixes.push({ label: croppable ? `Keep ${names[aspect]}, crop to ${asked.other} after` : 'Keep ' + names[aspect], patch: () => ({}) });
    out.push({ text: `You asked for ${asked.other}, which Seed can't make directly. This draft is ${names[aspect]}.${croppable ? ` After it's made, Crop turns it into ${asked.other} on this device, no GPU.` : ''}`, fixes });
  }
  if (video && asked.seconds && asked.seconds >= 5 && asked.seconds <= 15 && r.output.duration_seconds !== asked.seconds)
    out.push({ text: `You asked for ${asked.seconds} seconds; this draft is ${r.output.duration_seconds ?? 5}.`, fixes: [{ label: `Make it ${asked.seconds} s`, patch: x => ({ ...strip(x), output: { ...x.output, duration_seconds: asked.seconds } }) }] });
  if (video && asked.silent !== undefined && (r.audio?.output === 'silent') !== asked.silent)
    out.push({ text: asked.silent ? 'You asked for silence; this draft has sound.' : 'You asked for sound; this draft is silent.', fixes: [{ label: asked.silent ? 'Make it silent' : 'Add sound', patch: x => ({ ...strip(x), audio: { output: asked.silent ? 'silent' : 'generated' } }) }] });
  // Sound the person never mentioned is a creative choice: say so, and make silence one tap.
  if (video && asked.silent === undefined && trigger && !/\b(sound|audio|music|ambien\w*|noise|voice|dialog\w*|speak\w*|sings?|score)\b/i.test(trigger.text) && r.audio?.output !== 'silent')
    out.push({ text: 'Seed added sound to this clip, which you didn’t ask for.', fixes: [{ label: 'Make it silent', patch: x => ({ ...strip(x), audio: { output: 'silent' } }) }, { label: 'Keep the sound', patch: () => ({}) }] });
  // Brief details that apply to this draft but are missing from its prompt. Words only: this checks the request, not the picture.
  const gaps = briefGaps(r.prompt, project.brief ?? '');
  if (gaps.length) out.push({ soft: true, text: `Continuity check: this prompt doesn't mention ${gaps.join(', ')}.`, fixes: [{ label: gaps.length === 1 ? 'Include this detail' : 'Include these details', patch: x => ({ ...strip(x), prompt: x.prompt.replace(/\s+$/, '') + (/[.!?]$/.test(x.prompt.trim()) ? ' ' : '. ') + gaps.map(g => g[0]!.toUpperCase() + g.slice(1)).join('. ') + '.' }) }, { label: 'Not visible in this shot', patch: () => ({}) }] });
  // An attachment that the draft does not use (it is made from words only).
  const runMessage = at;
  const asking = runMessage > 0 ? [...project.messages.slice(0, runMessage)].reverse().find(m => m.role === 'user') : undefined;
  const used = new Set((r.references ?? []).map(x => x.asset_id));
  // Every message that shaped this draft counts: an image attached at the start is still unused after a follow-up.
  const askedBy = (runId: string) => {
    const reply = project.messages.findIndex(m => m.id === runId);
    return reply > 0 ? [...project.messages.slice(0, reply)].reverse().find(m => m.role === 'user') : undefined;
  };
  const attached = card.revisions.flatMap(v => (v.run_id ? askedBy(v.run_id)?.assets : undefined) ?? []);
  const unused = [...new Set([...(asking?.assets ?? []), ...attached])].filter(a => !used.has(a));
  if (unused.length && !(r.references ?? []).length) out.push({ text: `Your attached ${unused.length === 1 ? 'image is' : 'files are'} not used by this draft; it is made from words only.`, fixes: [{ label: 'Make it as an edit of the attached image', patch: () => ({}), action: 'edit-myself', assets: unused }] });
  return out;
}

const stop = new Set(['the', 'and', 'with', 'her', 'his', 'their', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'over', 'through', 'small', 'old', 'years', 'year', 'from', 'into', 'every', 'always', 'never', 'anywhere', 'shot', 'shots']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9:'\s-]/g, ' ').split(/[\s-]+/).filter(w => w.length > 2 && !stop.has(w));
/** Whether a phrase is in a prompt in substance: most of its meaningful words appear (word starts, so "curls" matches "curly"). */
function mentions(prompt: string, phrase: string) {
  const have = new Set(words(prompt).map(w => w.slice(0, 4))), need = words(phrase);
  if (!need.length) return true;
  return need.filter(w => have.has(w.slice(0, 4))).length / need.length >= 0.5;
}
/**
 * Character details and rules from the brief that a draft should carry but does not. A character's details apply when
 * the prompt names them; rules ("No text anywhere") apply to every draft. Returns short phrases, at most five.
 */
export function briefGaps(prompt: string, brief: string) {
  if (!brief.trim()) return [];
  const out: string[] = [];
  let section = '', anyNamed = false;
  for (const raw of brief.split('\n')) {
    const line = raw.replace(/[*_`]/g, '').trim();
    const heading = line.match(/^#+\s*(.+)$/)?.[1] ?? (/^[A-Za-z ]{3,20}:?$/.test(line) && !line.includes(' ') ? line.replace(':', '') : '');
    if (heading) { section = heading.toLowerCase(); continue; }
    const item = line.replace(/^(?:[-•]|\d+\.)\s*/, '');
    if (!item) continue;
    if (/character|cast|people/.test(section)) {
      const m = item.match(/^([A-Z][\w'’-]+(?: [A-Z][\w'’-]+)?)\s*[:–—-]\s*(.+)$/);
      if (!m) continue;
      // "Wardrobe:" or "Props:" lines belong to the characters above them.
      const generic = /^(wardrobe|costume|outfit|props?|look|appearance)$/i.test(m[1]!);
      const named = new RegExp('\\b' + m[1]!.split(' ')[0] + '\\b', 'i').test(prompt);
      if (named) anyNamed = true;
      if (!(named || (generic && anyNamed))) continue;
      // A distant figure shows no freckles or scars: in a wide or tiny framing only the outfit and props are checked.
      const far = /\b(extreme wide|wide shot|wide establishing|establishing|tiny|small in (the )?frame|silhouette|distant|aerial|from afar)\b/i.test(prompt);
      if (far && !generic) continue;
      for (const part of m[2]!.split(/[,;]|\.\s/).map(p => p.trim().replace(/\.$/, '').replace(/^(and|or|with)\s+/i, '')).filter(p => p.length > 2 && !/^\d+(\s*years?\s*old)?$/i.test(p)))
        if (!mentions(prompt, part)) out.push(part.charAt(0).toLowerCase() + part.slice(1));
    } else if (/rule|always|never|constraint/.test(section)) {
      if (item.length <= 80 && !mentions(prompt, item)) out.push(item.charAt(0).toLowerCase() + item.slice(1).replace(/\.$/, ''));
    }
  }
  return [...new Set(out)].slice(0, 5);
}

/** Prompt text for people: input tokens such as <Picture 1> become the input's name. */
export function readablePrompt(r: ImageRequest, project: Project, everywhere: JobRecord[] = []) {
  const labels = inputLabels(r.references ?? []);
  let text = r.prompt.replace(/\[\[([^\]]+)\]\]/g, '$1');
  for (const ref of r.references ?? []) { const label = labels.get(ref.id); if (label) text = text.split(label).join('“' + assetName(project, ref.asset_id, everywhere) + '”'); }
  // Video prompts are structured for the model; show their sections as plain headings.
  const headings: Record<string, string> = { integrated_multimodal_description: 'Scene', subject_definitions: 'Subjects', scene_anchor: 'Setting', action_timeline: 'Action', camera_path: 'Camera', overall_soundscape: 'Sound', non_diegetic_music: 'Music', retention_analysis: 'Keep', detailed_description: 'Detail', summary: 'Summary' };
  text = text.split('\n').filter(line => !/^\s*[a-z]+(?:_[a-z]+)+\s*:\s*N\/?A\.?\s*$/i.test(line)).join('\n');
  text = text.replace(/^(\s*)([a-z]+(?:_[a-z]+)+)\s*:\s*/gm, (_m, space: string, key: string) => space + (headings[key] ?? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())) + ': ');
  // Only a shot tag that starts a line is a heading; one inside a sentence just names the shot.
  // Inside a video prompt, [Shot N] numbers the parts of this one clip, not the film's shots.
  return text.replace(/^(\s*)\[Shot (\d+)\]/gm, '$1Part $2:').replace(/\[Shot (\d+)\]/g, 'part $1')
    // The video engine's own scaffolding sentence says nothing to a person; the source is shown beside the draft.
    .replace(/For the target video, at [\d.]+ seconds into the target video,[^.]*?(?:is )?(?:fully )?referenced\.\s*/gi, '');
}

const sections: Array<[string, string]> = [['integrated_multimodal_description', 'Scene'], ['subject_definitions', 'Subjects'], ['scene_anchor', 'Setting'], ['action_timeline', 'Action'], ['camera_path', 'Camera'], ['overall_soundscape', 'Sound'], ['non_diegetic_music', 'Music'], ['retention_analysis', 'Keep'], ['detailed_description', 'Detail']];
const naLine = /^\s*[a-z]+(?:_[a-z]+)+\s*:\s*N\/?A\.?\s*$/i;

/**
 * An editable, person-readable form of a prompt that converts back exactly: known sections become headings,
 * [Shot N] becomes "Shot N:", input tokens become quoted names, and N/A lines are set aside and restored.
 * Returns null when the prompt cannot be round-tripped safely (then the raw prompt is edited instead).
 */
export function editablePrompt(r: ImageRequest, project: Project, everywhere: JobRecord[] = []) {
  const labels = inputLabels(r.references ?? []);
  const named = (r.references ?? []).map(ref => ({ token: labels.get(ref.id) ?? '', name: '“' + assetName(project, ref.asset_id, everywhere) + '”' })).filter(x => x.token);
  if (new Set(named.map(x => x.name)).size !== named.length) return null;
  // Tags inside a sentence become "part N" only when the prompt had them, so a person's own "part 2" is left alone.
  const mid = /\S[ \t]*\[Shot \d+\]/.test(r.prompt);
  const lines = r.prompt.split('\n'), hidden = lines.filter(l => naLine.test(l));
  let text = lines.filter(l => !naLine.test(l)).join('\n');
  for (const [key, label] of sections) text = text.replace(new RegExp('^(\\s*)' + key + '\\s*:\\s*', 'gm'), '$1' + label + ': ');
  text = text.replace(/^(\s*)\[Shot (\d+)\]/gm, '$1Part $2:').replace(/\[Shot (\d+)\]/g, 'part $1');
  for (const { token, name } of named) text = text.split(token).join(name);
  const back = (edited: string) => {
    if (edited === text) return r.prompt;
    let out = edited;
    for (const { token, name } of named) out = out.split(name).join(token);
    out = out.replace(/^(\s*)Part (\d+):/gm, '$1[Shot $2]');
    if (mid) out = out.replace(/\bpart (\d+)\b/g, '[Shot $1]');
    for (const [key, label] of sections) out = out.replace(new RegExp('^(\\s*)' + label + ':\\s*', 'gm'), '$1' + key + ': ');
    return hidden.length ? out.replace(/\s+$/, '') + '\n' + hidden.join('\n') : out;
  };
  return text === r.prompt ? null : { text, back };
}
