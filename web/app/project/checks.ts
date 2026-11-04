import type { ChatCard, ChatMessage, Project, ImageRequest } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { latest } from '../format.js';
import { inputLabels } from '../../../shared/reference-labels.js';

type Aspect = '16:9' | '9:16' | '1:1' | '4:5';
export type Fix = { label: string; patch: (r: ImageRequest) => Record<string, unknown>; action?: 'edit-myself'; assets?: string[] };
export type Check = { text: string; fixes: Fix[] };

/** What the user explicitly asked for in their latest messages: shape, length and sound. Newest wins. */
export function askedFor(messages: ChatMessage[]) {
  const said: { aspect?: Aspect | 'portrait' | 'landscape'; seconds?: number; silent?: boolean } = {};
  for (const m of [...messages].reverse().filter(x => x.role === 'user').slice(0, 3)) {
    const t = m.text.toLowerCase();
    if (!said.aspect) {
      const exact = t.match(/\b(4:5|1:1|16:9|9:16)\b/)?.[1] as Aspect | undefined;
      said.aspect = exact ?? (/\bsquare\b/.test(t) ? '1:1' : /\b(portrait|vertical|tall)\b/.test(t) ? 'portrait' : /\b(landscape|horizontal|widescreen|wide)\b/.test(t) ? 'landscape' : undefined);
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
  const at = project.messages.findIndex(m => m.id === latest(card).run_id);
  const trigger = at > 0 ? [...project.messages.slice(0, at)].reverse().find(m => m.role === 'user') : undefined;
  const forAll = siblings <= 1 || /\b(all|every|each|both|them)\b/i.test(trigger?.text ?? '');
  const asked = trigger && forAll ? askedFor([trigger]) : {};
  const aspect = r.output.aspect;
  if (asked.aspect && aspect !== 'source') {
    const portrait = aspect === '9:16' || aspect === '4:5';
    const ok = asked.aspect === 'portrait' ? portrait : asked.aspect === 'landscape' ? aspect === '16:9' : asked.aspect === aspect;
    if (!ok) {
      const want = asked.aspect === 'portrait' ? (video ? '9:16' : '4:5') : asked.aspect === 'landscape' ? '16:9' : asked.aspect;
      if (video && (want === '1:1' || want === '4:5')) out.push({ text: `You asked for ${names[want]}, which video can't make. This draft is ${names[aspect]}.`, fixes: (['16:9', '9:16'] as const).filter(a => a !== aspect).map((a): Fix => ({ label: 'Use ' + names[a], patch: withAspect(a) })).concat([{ label: 'Keep ' + names[aspect], patch: () => ({}) }]) });
      else out.push({ text: `You asked for ${names[want]}; this draft is ${names[aspect]}.`, fixes: [{ label: 'Make it ' + names[want], patch: withAspect(want as Aspect) }] });
    }
  }
  if (video && asked.seconds && asked.seconds >= 5 && asked.seconds <= 15 && r.output.duration_seconds !== asked.seconds)
    out.push({ text: `You asked for ${asked.seconds} seconds; this draft is ${r.output.duration_seconds ?? 5}.`, fixes: [{ label: `Make it ${asked.seconds} s`, patch: x => ({ ...strip(x), output: { ...x.output, duration_seconds: asked.seconds } }) }] });
  if (video && asked.silent !== undefined && (r.audio?.output === 'silent') !== asked.silent)
    out.push({ text: asked.silent ? 'You asked for silence; this draft has sound.' : 'You asked for sound; this draft is silent.', fixes: [{ label: asked.silent ? 'Make it silent' : 'Add sound', patch: x => ({ ...strip(x), audio: { output: asked.silent ? 'silent' : 'generated' } }) }] });
  // An attachment that the draft does not use (it is made from words only).
  const runMessage = project.messages.findIndex(m => m.id === latest(card).run_id);
  const asking = runMessage > 0 ? [...project.messages.slice(0, runMessage)].reverse().find(m => m.role === 'user') : undefined;
  const used = new Set((r.references ?? []).map(x => x.asset_id));
  const unused = (asking?.assets ?? []).filter(a => !used.has(a));
  if (unused.length && !(r.references ?? []).length) out.push({ text: `Your attached ${unused.length === 1 ? 'image is' : 'files are'} not used by this draft; it is made from words only.`, fixes: [{ label: 'Make it as an edit of the attached image', patch: () => ({}), action: 'edit-myself', assets: unused }] });
  return out;
}

/** Prompt text for people: input tokens such as <Picture 1> become the input's name. */
export function readablePrompt(r: ImageRequest, project: Project) {
  const labels = inputLabels(r.references ?? []), names = new Map((project.asset_manifest ?? []).map(a => [a.id, a.name]));
  let text = r.prompt.replace(/\[\[([^\]]+)\]\]/g, '$1');
  for (const ref of r.references ?? []) { const label = labels.get(ref.id); if (label) text = text.split(label).join('“' + (names.get(ref.asset_id) ?? 'input') + '”'); }
  // Video prompts are structured for the model; show their sections as plain headings.
  const headings: Record<string, string> = { integrated_multimodal_description: 'Scene', subject_definitions: 'Subjects', scene_anchor: 'Setting', action_timeline: 'Action', camera_path: 'Camera', overall_soundscape: 'Sound', non_diegetic_music: 'Music', retention_analysis: 'Keep', detailed_description: 'Detail', summary: 'Summary' };
  text = text.split('\n').filter(line => !/^\s*[a-z]+(?:_[a-z]+)+\s*:\s*N\/?A\.?\s*$/i.test(line)).join('\n');
  text = text.replace(/^(\s*)([a-z]+(?:_[a-z]+)+)\s*:\s*/gm, (_m, space: string, key: string) => space + (headings[key] ?? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())) + ': ');
  return text.replace(/\[Shot (\d+)\]/g, 'Shot $1:');
}
