import { videoRequest } from './video.js';
import { editRequest } from './image-edit.js';
import type {ImageRequest} from '../shared/generation.js';
export type {ImageRequest} from '../shared/generation.js';
import { randomBytes } from 'node:crypto';


export function imageRequest(value: unknown): ImageRequest {
  if(value && typeof value==='object' && ('note' in value || 'resolved_seeds' in value || 'loras' in value)) {
    const {note,resolved_seeds,loras,...rest}=value as ImageRequest;
    const request=imageRequest(rest);
    if(request.workflow==='image-to-image' && loras?.length)throw Error('Image editing does not support LoRAs.');
    if(loras!==undefined&&(!Array.isArray(loras)||loras.length>3||loras.some(l=>!l||Object.keys(l).some(k=>!['id','revision','scale'].includes(k))||typeof l.id!=='string'||typeof l.revision!=='string'||!Number.isFinite(l.scale)||l.scale<0||l.scale>4)))throw Error('Check the LoRA selection.');
    if(note!==undefined&&(typeof note!=='string'||note.length>4000))throw Error('Keep the note under 4000 characters.');
    if(resolved_seeds!==undefined&&(!Array.isArray(resolved_seeds)||resolved_seeds.length!==request.count||resolved_seeds.some(seed=>typeof seed!=='string'||! /^(0|[1-9][0-9]{0,15})$/.test(seed)||BigInt(seed)>9007199254740991n)))throw Error('Check the output seeds.');
    return {...request,...(loras?{loras}:{}),...(note?.trim()?{note:note.trim()}:{}),...(resolved_seeds?{resolved_seeds}: {})};
  }
  const v = value as ImageRequest;
  if(v?.workflow==='image-to-image')return editRequest(v);
  if (v?.workflow === 'text-to-video' || v?.workflow === 'reference-to-video') return videoRequest(v);
  if (!v || Object.keys(v).some(k => !['workflow', 'prompt', 'mode', 'output', 'seed', 'count'].includes(k))
      || v.workflow !== 'text-to-image' || typeof v.prompt !== 'string' || !v.prompt.trim() || v.prompt.length > 5000
      || !['sfw', 'nsfw'].includes(v.mode) || !v.output || Object.keys(v.output).some(k => !['aspect', 'size'].includes(k)) || !['16:9', '9:16'].includes(v.output.aspect) || v.output.size !== '1mp') throw new Error('Check the image settings.');
  const count = v.count ?? 1, seed = v.seed ?? 'random';
  if (!Number.isInteger(count) || count < 1 || count > 16 || typeof seed !== 'string' || (seed !== 'random' && (!/^(0|[1-9][0-9]{0,15})$/.test(seed) || BigInt(seed) + BigInt(count - 1) > 9007199254740991n))) throw new Error('Check the generation count and seed.');
  return { workflow: v.workflow, prompt: v.prompt, mode: v.mode, output: { aspect: v.output.aspect, size: '1mp' }, seed, count };
}

export function seeds(request: ImageRequest) {
  if(request.resolved_seeds)return [...request.resolved_seeds];
  const result = new Set<string>();
  while (result.size < request.count) result.add(request.seed === 'random' ? String(randomBytes(6).readUIntBE(0, 6)) : String(BigInt(request.seed) + BigInt(result.size)));
  return [...result];
}

