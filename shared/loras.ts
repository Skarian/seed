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
  fl: 'Text / frame-guided video',
  ref: 'Reference video',
};
export const loraFamilyLabels: Record<LoraFamily, string> = { krea2: 'Krea 2', h3: 'MiniMax H3' };
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
