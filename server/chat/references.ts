import type { ImageRequest } from '../workflows.js';
import {inputLabels,remapReferences} from '../../shared/reference-labels.js';
export function chatReferenceLabels(request:ImageRequest){return inputLabels(request.references??[]);}
export function validateChatReferences(request:ImageRequest){
  const allowed=new Set(chatReferenceLabels(request).values());
  if(request.prompt.includes('[removed reference]')||[...request.prompt.matchAll(/<(?:Picture|Video|Audio) [1-9][0-9]*>/g)].some(m=>!allowed.has(m[0])))throw Error('Update the prompt to replace its missing reference labels.');
}
/** Preserve label-to-asset meaning when the reference order changes without a prompt edit. */
export function preserveChatLabels(previous:ImageRequest,next:ImageRequest){
  if(previous.prompt!==next.prompt)return next;
  const before=chatReferenceLabels(previous),after=chatReferenceLabels(next);
  return {...next,prompt:remapReferences(next.prompt,before,after)};
}
