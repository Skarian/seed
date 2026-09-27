import type { GenerationRequest, InputReference } from '../shared/generation.js';
import { MAX_EDIT_IMAGES } from '../shared/workflows.js';
import { VideoRequestError } from './video.js';

export function editRequest(value: any): GenerationRequest {
  const issues: Array<{field:string;message:string}> = [];
  const add = (field:string,message:string) => issues.push({field,message});
  if (Object.keys(value).some(k=>!['workflow','mode','prompt','references','output','seed','count'].includes(k))) add('request','Unsupported image editing setting.');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 5000) add('prompt','Describe your edit in 1–5000 characters.');
  if (!['sfw','nsfw'].includes(value.mode)) add('mode','Invalid mode.');
  if (!value.output || value.output.aspect !== 'source' || value.output.size !== '1mp' || Object.keys(value.output).some(k=>!['aspect','size'].includes(k))) add('output','Image editing follows the source shape at about 1 MP.');
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
  return {workflow:'image-to-image', mode:value.mode, prompt:value.prompt.trim(), references:[...refs.filter(r=>r.role==='source'),...refs.filter(r=>r.role==='reference')],output:{aspect:'source',size:'1mp'},seed,count};
}

export function editDimensions(width:number,height:number) {
  if (!Number.isFinite(width)||!Number.isFinite(height)||width<32||height<32||width*height>100_000_000||width/height>4||height/width>4) throw Error('Choose an image at least 32 pixels on each side, up to 100 megapixels, with an aspect ratio between 1:4 and 4:1.');
  const scale=Math.min(1,Math.sqrt(1024*1024/(width*height)));
  return {width:Math.max(32,Math.round(width*scale/32)*32),height:Math.max(32,Math.round(height*scale/32)*32)};
}
