import type { WorkflowId } from './studio.js';
export const workflows = {
  'text-to-image': { label: 'Text to image', worker: 'image', output: 'image', inputs: false, adapters: true },
  'image-to-image': { label: 'Image to image', worker: 'image', output: 'image', inputs: true, adapters: false },
  'text-to-video': { label: 'Text to video', worker: 'video', output: 'video', inputs: false, adapters: true },
  'reference-to-video': { label: 'Reference to video', worker: 'video', output: 'video', inputs: true, adapters: true },
} as const;
export const isVideoWorkflow = (workflow: string) => workflow === 'text-to-video' || workflow === 'reference-to-video';
export const usesInputs = (workflow: string) => workflow === 'image-to-image' || workflow === 'reference-to-video';
export const supportsLoras = (workflow: string) => workflow !== 'image-to-image';
export const QWEN_PROFILE = 'qwen-edit-int8-v1';
export const QWEN_SETTINGS = {model:'Qwen-Image-2.1',dit_precision:'INT8 ConvRot',encoder_precision:'INT8 ConvRot',vae_precision:'BF16',sampler:'euler',scheduler:'simple',steps:25,cfg:1,denoise:1,cache:{node:'QwenImage21Cache',device:'auto',dtype:'default'},model_revision:'9a44dbdb47cefd046be9c0a13476192f34c8db8e',comfy_revision:'b5cc8830279eae909a59de030af1e50761c36751'} as const;
export const MAX_EDIT_IMAGES = 10;
export function supportsWorkflow(worker: { worker_class: string; workflows?: string[] }, workflow: string) {
  const definition = workflows[workflow as WorkflowId];
  return !!definition && worker.worker_class === definition.worker &&
    (worker.workflows ? worker.workflows.includes(workflow) : workflow !== 'image-to-image');
}
export function executionRoute(request: { workflow: string; references?: Array<{role: string}> }) {
  return request.workflow === 'image-to-image' ? 'image-edit' : loraRoute(request);
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
