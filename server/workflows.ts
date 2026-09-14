import { videoRequest, videoGraph } from './video.js';
import type { InputReference, PreparedReference } from './media.js';
import { randomBytes } from 'node:crypto';

export type Preset = { filename: string; sha256: string; strength_model: number; revision: string };
export type Capabilities = { revision: string; ready: boolean; nsfw: Preset | null; workspace_id: string; engine_session_id: string; video?: { image_export?:boolean; duration_step?:number; native_export?:boolean; quality?:{fast:boolean;high:boolean}; profile_revision?:string; ready:boolean; nsfw: Partial<Record<'fl'|'ref',Preset>> } };
export type ImageRequest = { note?: string; resolved_seeds?: string[]; workflow: 'text-to-image' | 'text-to-video' | 'reference-to-video'; capabilities_revision: string; prompt: string; mode: 'sfw' | 'nsfw'; quality?: 'fast' | 'high'; output: { aspect: '16:9' | '9:16'; size: '1mp' | '720p' | 'native'; duration_seconds?: number; format?: 'video' | 'images' }; references?: InputReference[]; audio?: {output:'generated'|'silent'}; seed: string; count: number };

export function imageRequest(value: unknown): ImageRequest {
  if(value && typeof value==='object' && ('note' in value || 'resolved_seeds' in value)) {
    const {note,resolved_seeds,...rest}=value as ImageRequest;
    const request=imageRequest(rest);
    if(note!==undefined&&(typeof note!=='string'||note.length>4000))throw Error('Keep the note under 4000 characters.');
    if(resolved_seeds!==undefined&&(!Array.isArray(resolved_seeds)||resolved_seeds.length!==request.count||resolved_seeds.some(seed=>typeof seed!=='string'||! /^(0|[1-9][0-9]{0,15})$/.test(seed)||BigInt(seed)>9007199254740991n)))throw Error('Check the output seeds.');
    return {...request,...(note?.trim()?{note:note.trim()}:{}),...(resolved_seeds?{resolved_seeds}: {})};
  }
  const v = value as ImageRequest;
  if (v?.workflow === 'text-to-video' || v?.workflow === 'reference-to-video') return videoRequest(v);
  if (!v || Object.keys(v).some(k => !['workflow', 'capabilities_revision', 'prompt', 'mode', 'output', 'seed', 'count'].includes(k))
      || v.workflow !== 'text-to-image' || typeof v.capabilities_revision !== 'string' || typeof v.prompt !== 'string' || !v.prompt.trim() || v.prompt.length > 12000
      || !['sfw', 'nsfw'].includes(v.mode) || !v.output || Object.keys(v.output).some(k => !['aspect', 'size'].includes(k)) || !['16:9', '9:16'].includes(v.output.aspect) || v.output.size !== '1mp') throw new Error('Check the image settings.');
  const count = v.count ?? 1, seed = v.seed ?? 'random';
  if (!Number.isInteger(count) || count < 1 || count > 16 || typeof seed !== 'string' || (seed !== 'random' && (!/^(0|[1-9][0-9]{0,15})$/.test(seed) || BigInt(seed) + BigInt(count - 1) > 9007199254740991n))) throw new Error('Check the generation count and seed.');
  return { workflow: v.workflow, capabilities_revision: v.capabilities_revision, prompt: v.prompt, mode: v.mode, output: { aspect: v.output.aspect, size: '1mp' }, seed, count };
}

export function seeds(request: ImageRequest) {
  if(request.resolved_seeds)return [...request.resolved_seeds];
  const result = new Set<string>();
  while (result.size < request.count) result.add(request.seed === 'random' ? String(randomBytes(6).readUIntBE(0, 6)) : String(BigInt(request.seed) + BigInt(result.size)));
  return [...result];
}

export function graphFor(request: ImageRequest, id: string, seed: string, preset: Preset | null, references: PreparedReference[] = []) {
  if(request.workflow !== 'text-to-image') return videoGraph(request,id,seed,preset,references);
  if (request.mode === 'nsfw' && !preset) throw new Error('The NSFW LoRA is not available on this pod.');
  const [width, height] = request.output.aspect === '16:9' ? [1280, 720] : [720, 1280];
  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2_turbo_int8_convrot.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: request.prompt } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '7': { class_type: 'KSampler', inputs: { model: [request.mode === 'nsfw' ? '10' : '1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], seed: Number(seed), steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'seed/' + id + '/image' } },
  };
  if (request.mode === 'nsfw') graph['10'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: preset!.filename, strength_model: preset!.strength_model } };
  return graph;
}

