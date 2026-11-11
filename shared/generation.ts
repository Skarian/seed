import type { ImageSize, ResolutionSize } from './resolution.js';
/** Provider-independent generation requests shared by the UI and coordinator. */
export type LoraSelection = { id: string; revision: string; scale: number };
export type InputReference = {
  id: string;
  asset_id: string;
  kind: "image" | "video" | "audio";
  role: "source" | "reference" | "first_frame" | "last_frame";
  framing?: "fit" | "fill";
  range?: { start_seconds: number; duration_seconds: number };
  include_audio?: boolean;
};
type GenerationFields = {
  steps?: import('./video-settings.js').VideoSteps;
  detail?: import('./video-settings.js').VideoDetail;
  target?:import('./local-worker.js').ExecutionTarget;
  loras?: LoraSelection[];
  /** Its place in a film or set: shot number, cast, framing, delivery shape. */
  shot?: ShotFields;
  /** Edit drafts only: "klein" for FLUX 3 Image Klein; left out for Qwen Image Edit. */
  engine?: "klein";
  /** A short name for the draft in the user's words, e.g. "Cat on the sill". */
  title?: string;
  note?: string;
  resolved_seeds?: string[];
  prompt: string;
  mode: "sfw" | "nsfw";
  references?: InputReference[];
  audio?: { output: "generated" | "silent" };
  seed: string;
  count: number;
};
/**
 * What a draft is, as fields rather than prose: its place in a film or set, who is in the frame, how it is framed and
 * the shape it is delivered at. Seed fills these when it drafts; checks and the shot board read them instead of
 * guessing from titles and wording.
 */
export type ShotFields = {
  /** Shot (or page) number in the film or set, 1-based. */
  number?: number;
  /** Short shot name, e.g. "Causeway Wide". */
  name?: string;
  /** Characters visible in this shot, by the names the brief uses. */
  cast?: string[];
  /** Characters in the scene but deliberately out of frame. */
  offscreen?: string[];
  /** The place, by the name the brief uses. */
  place?: string;
  /** Framing in film terms: wide, medium, close-up, insert, two-shot… */
  framing?: string;
  /** Lens focal length in millimetres, when the user named one. */
  lens_mm?: number;
  /** The shape the result is delivered at ("2.39:1"), when it differs from the shape the model makes. */
  delivery?: string;
};
const shotText = (v: unknown, max: number) => typeof v === 'string' && v.trim() && v.trim().length <= max;
/** Validates shot fields from a tool or an edit; throws a plain message when a field is wrong. */
export function normalizeShot(value: unknown): ShotFields | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('Check the shot details.');
  const v = value as Record<string, unknown>,
    out: ShotFields = {};
  for (const k of Object.keys(v))
    if (!['number', 'name', 'cast', 'offscreen', 'place', 'framing', 'lens_mm', 'delivery'].includes(k))
      throw Error('Unknown shot detail: ' + k + '.');
  if (v.number !== undefined) {
    if (!Number.isInteger(v.number) || (v.number as number) < 1 || (v.number as number) > 999) throw Error('Give the shot a number from 1 to 999.');
    out.number = v.number as number;
  }
  for (const k of ['name', 'place', 'framing'] as const)
    if (v[k] !== undefined) {
      if (!shotText(v[k], 60)) throw Error('Keep the shot ' + k + ' under 60 characters.');
      out[k] = (v[k] as string).trim();
    }
  for (const k of ['cast', 'offscreen'] as const)
    if (v[k] !== undefined) {
      if (!Array.isArray(v[k]) || (v[k] as unknown[]).length > 12 || (v[k] as unknown[]).some(x => !shotText(x, 40)))
        throw Error('List up to 12 character names for ' + k + '.');
      out[k] = [...new Set((v[k] as string[]).map(x => x.trim()))];
    }
  if (v.lens_mm !== undefined) {
    if (!Number.isInteger(v.lens_mm) || (v.lens_mm as number) < 4 || (v.lens_mm as number) > 1200) throw Error('Give the lens in millimetres.');
    out.lens_mm = v.lens_mm as number;
  }
  if (v.delivery !== undefined) {
    if (typeof v.delivery !== 'string' || !/^\d{1,2}(\.\d{1,2})?:\d{1,2}(\.\d{1,2})?$/.test(v.delivery)) throw Error('Give the delivery shape as a ratio, e.g. 2.39:1.');
    out.delivery = v.delivery;
  }
  return Object.keys(out).length ? out : undefined;
}
/** Still images also come square and in 4:5 portrait; video stays 16:9 or 9:16. */
export const imageAspects = ["16:9", "9:16", "1:1", "4:5"] as const;
export type ImageAspect = typeof imageAspects[number];
type Output = {
  aspect: ImageAspect | "source";
  size: ResolutionSize;
  duration_seconds?: number;
  format?: "video" | "images";
};
export type GenerationRequest = GenerationFields & (
  // FLUX 3 Image Klein reads the images as references and can make any image shape; Qwen keeps the source shape.
  | { workflow: "image-to-image"; output: Output & { aspect: "source" | ImageAspect; size: ImageSize } }
  | { workflow: "text-to-image"; output: Output & { aspect: ImageAspect } }
  | { workflow: "text-to-video" | "reference-to-video"; output: Output & { aspect: "16:9" | "9:16" } }
);
/** Compatibility name for existing callers and persisted jobs. */
export type ImageRequest = GenerationRequest;

/** A silent clip should not keep describing sound: rewrite the prompt's Sound section (if any) to "Silence.".
 * A section that already says it is silent is left as written, so `silencedPrompt(p) === p` means "already silent". */
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
  if (/^(silence|silent|none|n\/a)\.?$/i.test(lines.slice(at, end).join(' ').slice(label.length).trim())) return prompt;
  return [...lines.slice(0, at), label + ' Silence.', ...lines.slice(end)].join('\n');
}
