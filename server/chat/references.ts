import type { ImageRequest } from '../workflows.js';
import {inputLabels,promptBindings,remapReferences} from '../../shared/reference-labels.js';
export function chatReferenceLabels(request:ImageRequest){return inputLabels(request.references??[]);}
export function validateChatReferences(request:ImageRequest){
  const allowed=new Set(chatReferenceLabels(request).values());
  if(request.prompt.includes('[removed reference]')||[...request.prompt.matchAll(/<(?:Picture|Video|Audio) [1-9][0-9]*>|<image[1-9][0-9]*>/g)].some(m=>!allowed.has(m[0])))throw Error('Update the prompt to replace its missing reference labels.');
}
/** Preserve label-to-input-instance meaning when order changes without a prompt edit. */
export function preserveChatLabels(previous:ImageRequest,next:ImageRequest){
  if(previous.prompt!==next.prompt)return next;
  const before=promptBindings(previous.references??[]),after=promptBindings(next.references??[]);
  return {...next,prompt:remapReferences(next.prompt,before,after)};
}
