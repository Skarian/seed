import { videoProfile, type VideoDetail } from './video-settings.js';
import type { WorkflowId } from './studio.js';
export const workflows = {
  'text-to-image': { label: 'Text to image', worker: 'image', output: 'image', inputs: false, adapters: true },
  'image-to-image': { label: 'Image to image', worker: 'image', output: 'image', inputs: true, adapters: false },
  'text-to-video': { label: 'Text to video', worker: 'video', output: 'video', inputs: false, adapters: true },
  'reference-to-video': { label: 'Reference to video', worker: 'video', output: 'video', inputs: true, adapters: true },
} as const;
export const isVideoWorkflow = (workflow: string) => workflow === 'text-to-video' || workflow === 'reference-to-video';
export const usesInputs = (workflow: string) => workflow === 'image-to-image' || workflow === 'reference-to-video';
export const QWEN_PROFILE = 'qwen-edit-int8-v1';
export const QWEN_SETTINGS = {model:'Qwen-Image-2.1',dit_precision:'INT8 ConvRot',encoder_precision:'INT8 ConvRot',vae_precision:'BF16',sampler:'euler',scheduler:'simple',steps:25,cfg:1,denoise:1,cache:{node:'QwenImage21Cache',device:'auto',dtype:'default'},model_revision:'9a44dbdb47cefd046be9c0a13476192f34c8db8e',comfy_revision:'b5cc8830279eae909a59de030af1e50761c36751'} as const;
export const MAX_EDIT_IMAGES = 10;
// From Comfy-Org/workflow_templates image_flux3_klein_distilled_image_edit.json, without the optional prompt upsampler.
export const KLEIN_PROFILE = 'flux3-klein-int8-v1';
export const KLEIN_SETTINGS = {model:'FLUX 3 Image Klein',checkpoint:'distilled',dit_precision:'INT8 ConvRot',encoder:'Qwen3-VL-4B INT8 ConvRot',vae:'FLUX.2 VAE',sampler:'euler',scheduler:'simple',steps:16,cfg:1,denoise:1,reference_megapixels:1,model_revision:'9d36114cf7a2e03a45c28f5cc4987d20ebfdb6c1'} as const;
/** The worker capability for Klein edits; Qwen edits use plain image-to-image. */
export const KLEIN_CAPABILITY = 'image-to-image:klein';
export const usesKlein = (request: { workflow: string; engine?: string }) => request.workflow === 'image-to-image' && request.engine === 'klein';
/** What a worker must advertise to take this request. */
export const capabilityFor = (request: { workflow: string; engine?: string }) => usesKlein(request) ? KLEIN_CAPABILITY : request.workflow;
export const executionProfile = (request: { workflow: string; engine?: string; steps?: number; detail?: VideoDetail }) =>
  usesKlein(request) ? KLEIN_PROFILE : request.workflow === 'image-to-image' ? QWEN_PROFILE : isVideoWorkflow(request.workflow) ? videoProfile(request) : 'krea-turbo-int8-v1';
export function supportsWorkflow(worker: { worker_class: string; workflows?: string[] }, workflow: string) {
  const base = workflow.split(':')[0]!;
  const definition = workflows[base as WorkflowId];
  return !!definition && worker.worker_class === definition.worker &&
    (worker.workflows ? worker.workflows.includes(workflow) : base !== 'image-to-image');
}
export function executionRoute(request: { workflow: string; engine?: string; references?: Array<{role: string}> }) {
  return usesKlein(request) ? 'image-klein' : request.workflow === 'image-to-image' ? 'image-edit' : loraRoute(request);
}
export function loraRoute(request: {
  workflow: string;
  references?: Array<{ role: string }>;
}): "image" | "fl" | "ref" {
  if (request.workflow === 'image-to-image') throw Error('Image editing does not support LoRAs.');
  return request.workflow === "text-to-image"
    ? "image"
    : (request.workflow === "reference-to-video" &&
          !request.references?.length) ||
        request.references?.some((ref) => ref.role === "reference")
      ? "ref"
      : "fl";
}
