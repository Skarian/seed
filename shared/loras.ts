export type LoraFamily = 'krea2' | 'h3';
export type LoraRoute = 'image' | 'fl' | 'ref';
export type LoraSource = {
  provider: 'civitai'; model_id: number; version_id: number; file_id: number;
  url: string; sha256: string; size_bytes: number;
};
export type LoraSourceManifest = {
  id: string; name: string; revision: string; route: LoraRoute; path: string;
  url: string; sha256: string; size_bytes: number; source: LoraSource;
};
export const loraWorkflowLabels: Record<LoraRoute, string> = {
  image: 'Images',
  fl: 'Clips from words or a start frame',
  ref: 'Clips that follow a reference',
};
export const loraFamilyLabels: Record<LoraFamily, string> = { krea2: 'Krea 2', h3: 'MiniMax H3' };
/**
 * A suggested use for each file of a style, so a normal import needs no expert routing. Names decide when they can
 * ("ref", "i2v"); otherwise one file takes the first use, and as many files as uses take them in order. Unclear
 * cases stay unassigned for the owner to choose.
 */
export function suggestLoraMapping(family: LoraFamily, files: LoraFilePreview[]): Record<number, LoraRoute> {
  const routes = familyRoutes(family), usable = files.filter(f => f.supported), out: Record<number, LoraRoute> = {};
  const hint = (name: string): LoraRoute | undefined => family === 'krea2' ? 'image' : /ref(erence)?[^a-z]|[-_]ref\b|reference/i.test(name) ? 'ref' : /(^|[^a-z])(t2v|i2v|fl|frame|text)([^a-z]|$)/i.test(name) ? 'fl' : undefined;
  for (const f of usable) { const r = hint(f.name); if (r && !Object.values(out).includes(r)) out[f.id] = r; }
  const left = routes.filter(r => !Object.values(out).includes(r)), unassigned = usable.filter(f => !out[f.id]);
  if (unassigned.length && unassigned.length <= left.length && (usable.length === 1 || usable.length === routes.length)) unassigned.forEach((f, i) => { out[f.id] = left[i]!; });
  return out;
}
export function familyRoutes(family: LoraFamily): LoraRoute[] {
  return family === 'krea2' ? ['image'] : ['fl', 'ref'];
}
export type LoraFilePreview = { id: number; name: string; size_bytes: number; supported: boolean };
export type LoraVersionPreview = {
  id: number;
  name: string;
  base_model: string;
  family: LoraFamily | null;
  supported: boolean;
  trigger_words: string[];
  files: LoraFilePreview[];
};
export type LoraPreview = { name: string; model_id: number; versions: LoraVersionPreview[] };
export type LoraGuidance = {
  name: string;
  description: string;
  default_scale: number;
  trigger_words: string[];
};
export type LoraGroup = LoraGuidance & {
  id: string;
  version?: string;
  family: LoraFamily;
  availability: 'all' | 'spicy';
  enabled: boolean;
  source_url?: string;
  files: Array<{
    id: string;
    name: string;
    route: LoraRoute;
    compatibility: 'untested' | 'verified';
    source_status: 'ready' | 'needs_source';
  }>;
};
export type ImportState =
  | 'queued'
  | 'downloading'
  | 'validating'
  | 'uploading'
  | 'ready'
  | 'failed';
export type LoraImportActivity = {
  id: string;
  name: string;
  version?: string;
  state: ImportState;
  created_at: string;
  updated_at: string;
  error?: string;
  files: Array<{
    name: string;
    route: LoraRoute;
    state: ImportState;
    bytes: number;
    total: number;
    error?: string;
  }>;
};
