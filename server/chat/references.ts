import type { ImageRequest } from '../workflows.js';
export function chatReferenceLabels(request:ImageRequest){
  const refs=request.references??[],labels=new Map<string,string>();let audio=0;
  for(const ref of refs)if(ref.kind==='video'&&ref.include_audio)labels.set(ref.asset_id+':audio',`<Audio ${++audio}>`);
  const counts={image:0,video:0,audio};
  for(const ref of refs)if(ref.role==='reference')labels.set(ref.asset_id,`<${{image:'Picture',video:'Video',audio:'Audio'}[ref.kind]} ${++counts[ref.kind]}>`);
  if(refs.length===1&&refs[0]!.kind==='image'&&refs[0]!.role==='first_frame')labels.set(refs[0]!.asset_id,'<Picture 1>');
  return labels;
}
export function validateChatReferences(request:ImageRequest){
  const allowed=new Set(chatReferenceLabels(request).values());
  if(request.prompt.includes('[removed reference]')||[...request.prompt.matchAll(/<(?:Picture|Video|Audio) [1-9][0-9]*>/g)].some(m=>!allowed.has(m[0])))throw Error('Update the prompt to replace its missing reference labels.');
}
/** Preserve label-to-asset meaning when the reference order changes without a prompt edit. */
export function preserveChatLabels(previous:ImageRequest,next:ImageRequest){
  if(previous.prompt!==next.prompt)return next;
  const before=chatReferenceLabels(previous),after=chatReferenceLabels(next);
  const replacements=new Map([...before].map(([id,label])=>[label,after.get(id)??'[removed reference]']));
  return {...next,prompt:next.prompt.replace(/<(?:Picture|Video|Audio) [1-9][0-9]*>/g,label=>replacements.get(label)??label)};
}
