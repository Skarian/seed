import type { ImageRequest, JobRecord, Project, ChatCard, ChatRevision, ChatGroup } from './api.js';
import { kindOf, kindLabels, isVideoKind, type Kind } from './api.js';
import { jobState } from '../../shared/jobs.js';
import { progressParts } from '../../shared/generation-progress.js';
import { sizeName } from './project/requests.js';

export const money = (n: number) => n < 0.01 && n > 0 ? '<$0.01' : '$' + n.toFixed(2);
export const rate = (n: number) => '$' + n.toFixed(2) + '/h';
export const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
export function relativeTime(iso: string, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso); const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days === 0) return 'Today'; if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? 'long' : undefined, month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
export function duration(seconds: number) {
  if (seconds < 60) return Math.round(seconds) + ' s';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const latest = (card: ChatCard) => card.revisions.at(-1)!;
export const kindOfRequest = (r: ImageRequest): Kind => kindOf[r.workflow];

/** A draft's name: its title, or the first words of its prompt. */
export function titleOf(r: ImageRequest | undefined) {
  if (!r) return 'Untitled';
  if (r.title?.trim()) return r.title.trim();
  const clean = r.prompt.replace(/\[\[[^\]]+\]\]|<[^>]+>|\[[^\]]*\]\(asset:[^)]+\)/g, '').replace(/\s+/g, ' ').trim();
  const first = clean.split(/[.,;:\n]/)[0] ?? clean;
  const words = first.split(' ').slice(0, 6).join(' ');
  return (words.length > 48 ? words.slice(0, 46) + '…' : words) || kindLabels[kindOfRequest(r)];
}
export function shapeLabel(r: ImageRequest) {
  if (r.output.aspect === 'source') return 'Source shape';
  return ({ '9:16': 'Portrait 9:16', '16:9': 'Landscape', '1:1': 'Square', '4:5': 'Portrait 4:5' } as Record<string, string>)[r.output.aspect] ?? 'Landscape';
}
export const shapeClass = (r?: ImageRequest, w?: number, h?: number) => {
  if (w && h) return w > h * 1.15 ? 'landscape' : h > w * 1.15 ? 'portrait' : 'square';
  if (!r) return 'square';
  return r.output.aspect === '9:16' ? 'portrait' : r.output.aspect === '4:5' ? 'portrait45' : r.output.aspect === '16:9' ? 'landscape' : 'square';
};
export function sizeLabel(r: ImageRequest) { return sizeName(r.workflow, String(r.output.size), r.output.aspect); }
export function targetLabel(t: string | undefined, host?: string) { return t === 'cloud' ? 'Cloud GPU' : t === 'local' ? 'Seed PC' + (host ? ' (' + host + ')' : '') : 'Auto'; }
export function countLabel(r: ImageRequest) {
  const video = isVideoKind(kindOfRequest(r));
  return '×' + r.count + (video ? ' · ' + (r.output.duration_seconds ?? 5) + ' s' : '');
}
/** Settings chips for a request, as [key, label] so a plan can show shared ones once. */
export function settingChips(r: ImageRequest, styleName: (id: string) => string): Array<[string, string]> {
  const kind = kindOfRequest(r), video = isVideoKind(kind);
  const chips: Array<[string, string]> = [['kind', kindLabels[kind]], ['engine', ({ image: 'Krea 2', edit: 'Qwen Image Edit', video: 'MiniMax H3', animate: 'MiniMax H3' } as const)[kind]], ['shape', shapeLabel(r)], ['size', sizeLabel(r)], ['count', (video ? plural(r.count, 'clip') : plural(r.count, 'image'))]];
  if (video) chips.push(['length', (r.output.duration_seconds ?? 5) + ' s'], ['sound', r.audio?.output === 'silent' ? 'Silent' : 'With sound'], ['detail', r.detail === 'full' ? 'Full detail' : 'Fast']);
  for (const l of r.loras ?? []) chips.push(['style:' + l.id, styleName(l.id) + (l.scale !== 1 ? ' · ' + l.scale : '')]);
  chips.push(['target', targetLabel(r.target)]);
  return chips;
}
export function outputsOf(cards: ChatCard[], decided: (c: ChatCard) => boolean) {
  return cards.filter(decided).reduce((n, c) => n + latest(c).request.count, 0);
}
export const outputNoun = (r: ImageRequest | undefined, n: number) => !r ? plural(n, 'output') : isVideoKind(kindOfRequest(r)) ? plural(n, 'clip') : plural(n, 'image');

/** What changed between two revisions, in plain words. */
export function changesBetween(a: ChatRevision | undefined, b: ChatRevision, styleName: (id: string) => string) {
  if (!a) return [];
  const x = a.request, y = b.request, out: string[] = [];
  if (x.count !== y.count) out.push(`${x.count} → ${y.count} ${isVideoKind(kindOfRequest(y)) ? 'clips' : 'images'}`);
  if (x.output.aspect !== y.output.aspect) out.push(`${shapeLabel(x)} → ${shapeLabel(y)}`);
  if (x.output.size !== y.output.size) out.push(`${sizeLabel(x)} → ${sizeLabel(y)}`);
  if (x.output.duration_seconds !== y.output.duration_seconds && y.output.duration_seconds) out.push(`${x.output.duration_seconds ?? 5} s → ${y.output.duration_seconds} s`);
  if (x.audio?.output !== y.audio?.output && y.audio) out.push(y.audio.output === 'silent' ? 'now silent' : 'now with sound');
  const xs = (x.loras ?? []).map(l => l.id).join(), ys = (y.loras ?? []).map(l => l.id).join();
  if (xs !== ys) out.push(ys ? 'style: ' + (y.loras ?? []).map(l => styleName(l.id)).join(', ') : 'style removed');
  if ((x.references ?? []).length !== (y.references ?? []).length) out.push(`${(x.references ?? []).length} → ${(y.references ?? []).length} inputs`);
  if (x.target !== y.target) out.push('runs on ' + targetLabel(y.target));
  if (x.prompt !== y.prompt) out.push(...promptChanges(x.prompt, y.prompt));
  if (x.title !== y.title && y.title && x.title) out.push(`renamed “${x.title}” → “${y.title}”`);
  return out;
}

const stop = new Set('a an the and or of in on at to with for from by as is are be this that its it into over under near very more less'.split(' '));
/** The meaningful words a prompt gained and lost, e.g. “+ fern, empty top · − moths”. */
export function promptChanges(before: string, after: string) {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w)));
  const a = words(before), b = words(after);
  const added = [...b].filter(w => !a.has(w)).slice(0, 6), removed = [...a].filter(w => !b.has(w)).slice(0, 6);
  if (!added.length && !removed.length) return ['prompt reworded'];
  return [[added.length ? '+ ' + added.join(', ') : '', removed.length ? '− ' + removed.join(', ') : ''].filter(Boolean).join(' · ')];
}

/* ---------- Job states shown to people ---------- */
export type TileState = { label: string; tone: 'live' | 'done' | 'bad' | 'wait' | 'off'; percent?: number; cancellable: boolean };
export function tileState(job: JobRecord, now = Date.now()): TileState {
  const state = jobState(job);
  if (state === 'completed') return { label: 'Done', tone: 'done', cancellable: false };
  if (state === 'cancelled') return { label: 'Cancelled', tone: 'off', cancellable: false };
  if (state === 'failed' || state === 'blocked') return { label: job.error ? 'Failed · ' + job.error : 'Failed', tone: 'bad', cancellable: false };
  if (state === 'unknown') return { label: 'Lost contact', tone: 'bad', cancellable: false };
  if (state === 'cancelling') return { label: 'Cancelling…', tone: 'wait', cancellable: false };
  if (state === 'saving') return { label: 'Saving', tone: 'live', cancellable: false };
  if (state === 'queued') return { label: job.waiting_reason ? 'Waiting for GPU' : 'Queued', tone: 'wait', cancellable: true };
  if (job.progress) {
    const parts = progressParts(job.progress, job.request.workflow, now);
    const name = parts.name === 'Generating' || parts.name === 'Editing' ? 'Making' : parts.name;
    return { label: name + (parts.detail ? ' · ' + parts.detail : ''), tone: 'live', percent: job.progress.percent, cancellable: true };
  }
  return { label: state === 'starting' ? 'Starting' : 'Making', tone: 'live', cancellable: true };
}
export const isDone = (j: JobRecord) => jobState(j) === 'completed';
export const isFailed = (j: JobRecord) => ['failed', 'blocked'].includes(jobState(j));

/** A group's jobs in output order. */
export function groupJobs(project: Project, group: ChatGroup) {
  const ids = group.cards.flatMap(c => latest(c).decision === 'approved' ? latest(c).job_ids : []);
  return ids.map(id => project.jobs.find(j => j.id === id)).filter((j): j is JobRecord => Boolean(j));
}
export function cardJobs(project: Project, card: ChatCard) {
  return latest(card).job_ids.map(id => project.jobs.find(j => j.id === id)).filter((j): j is JobRecord => Boolean(j));
}

/** GPU time for some outputs of one workflow, from this project's recent saved jobs. Null until something comparable has run. */
export function estimateSeconds(jobs: JobRecord[], workflow: string, outputs: number): number | null {
  const per = jobs.filter(j => j.request.workflow === workflow && j.state === 'completed' && j.metrics?.elapsed_to_saved_seconds)
    .slice(-10).map(j => j.metrics!.elapsed_to_saved_seconds! / Math.max(1, j.outputs.length || j.request.count)).sort((a, b) => a - b);
  return per.length ? per[Math.floor(per.length / 2)]! * outputs : null;
}
export const estimateText = (seconds: number | null) => seconds === null ? 'time not known until the first result' : 'about ' + duration(Math.max(5, Math.round(seconds / 5) * 5));
