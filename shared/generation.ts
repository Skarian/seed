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
  note?: string;
  resolved_seeds?: string[];
  prompt: string;
  mode: "sfw" | "nsfw";
  references?: InputReference[];
  audio?: { output: "generated" | "silent" };
  seed: string;
  count: number;
};
type Output = {
  aspect: "16:9" | "9:16" | "source";
  size: ResolutionSize;
  duration_seconds?: number;
  format?: "video" | "images";
};
export type GenerationRequest = GenerationFields & (
  | { workflow: "image-to-image"; output: Output & { aspect: "source"; size: ImageSize } }
  | { workflow: "text-to-image" | "text-to-video" | "reference-to-video"; output: Output & { aspect: "16:9" | "9:16" } }
);
/** Compatibility name for existing callers and persisted jobs. */
export type ImageRequest = GenerationRequest;

/** Form edits stay in their workflow; workflow changes create/restore a separate draft. */
export function patchGeneration(request:GenerationRequest, patch:Partial<GenerationRequest>):GenerationRequest {
  const fields={...request,...patch};
  if(request.workflow==='image-to-image')return {...fields,workflow:'image-to-image',output:{aspect:'source',size:(patch.output?.size??request.output.size) as ImageSize},loras:undefined,audio:undefined,steps:undefined,detail:undefined};
  if(request.workflow==='text-to-image'){delete fields.steps;delete fields.detail;}
  const output=patch.output??request.output;
  return {...fields,workflow:request.workflow,output:{...output,aspect:output.aspect==='source'?request.output.aspect:output.aspect}};
}
