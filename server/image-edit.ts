import type { GenerationRequest, InputReference } from '../shared/generation.js';
import { MAX_EDIT_IMAGES } from '../shared/workflows.js';
import { imageAspects } from '../shared/generation.js';
import { VideoRequestError } from './video.js';
import { isResolutionSize } from '../shared/resolution.js';
export { editDimensions } from '../shared/resolution.js';

export function editRequest(value: any): GenerationRequest {
  const issues: Array<{field:string;message:string}> = [];
  const add = (field:string,message:string) => issues.push({field,message});
  if (Object.keys(value).some(k=>!['workflow','engine','mode','prompt','references','output','seed','count'].includes(k))) add('request','Unsupported image editing setting.');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 5000) add('prompt','Describe your edit in 1–5000 characters.');
  if (!['sfw','nsfw'].includes(value.mode)) add('mode','Invalid mode.');
  const klein = value.engine === 'klein';
  if (value.engine !== undefined && !klein) add('engine','Choose FLUX 3 Image Klein, or leave the engine out for Qwen.');
  if (!value.output || (value.output.aspect !== 'source' && !(klein && (imageAspects as readonly string[]).includes(value.output.aspect))) || !isResolutionSize('image-to-image',value.output.size,process.env.SEED_QUALIFY_RESOLUTIONS==='1') || Object.keys(value.output).some(k=>!['aspect','size'].includes(k))) add('output',klein?'Choose a supported image shape and resolution.':'Choose a supported image resolution; editing follows the source shape.');
  const refs: InputReference[] = Array.isArray(value.references) ? value.references : [];
  if (!refs.length || refs.length > MAX_EDIT_IMAGES) add('references',`Choose a source image and up to ${MAX_EDIT_IMAGES-1} reference images.`);
  const ids = new Set<string>();
  refs.forEach((r,index)=>{
    if (!r || Object.keys(r).some(k=>!['id','asset_id','kind','role'].includes(k)) || r.kind !== 'image' || !['source','reference'].includes(r.role) || typeof r.id !== 'string' || !/^[-\w]{1,100}$/.test(r.id) || typeof r.asset_id !== 'string' || !/^[-\w]{1,100}$/.test(r.asset_id) || ids.has(r.id)) add(`references[${index}]`,'Choose a valid, distinct image input.');
    if(r) ids.add(r.id);
  });
  if (refs.filter(r=>r?.role==='source').length !== 1) add('references','Choose exactly one source image to edit.');
  const seed=value.seed??'random', count=value.count??1;
  if (!Number.isInteger(count)||count<1||count>16) add('count','Choose a quantity from 1 to 16.');
  if (typeof seed!=='string'||(seed!=='random'&&(!/^(0|[1-9][0-9]{0,15})$/.test(seed)||BigInt(seed)+BigInt(Number.isInteger(count)?count-1:0)>9007199254740991n))) add('seed','Choose a valid seed or Random.');
  if (issues.length) throw new VideoRequestError(issues);
  return {workflow:'image-to-image', ...(klein?{engine:'klein' as const}:{}), mode:value.mode, prompt:value.prompt.trim(), references:[...refs.filter(r=>r.role==='source'),...refs.filter(r=>r.role==='reference')],output:{aspect:klein?value.output.aspect:'source',size:value.output.size},seed,count};
}
