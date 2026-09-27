export type LabelInput={id?:string;asset_id:string;kind:'image'|'video'|'audio';role:string;include_audio?:boolean};
export const inputLabelPatternSource='(?:(?:Picture|Video|Audio) [1-9][0-9]*|image[1-9][0-9]*)';
/** Both video and image-editing labels reserve their numbered composer slots. */
export function parseInputLabel(label:string):{kind:LabelInput['kind'];number:number}|undefined{
 const match=/^<(?:(Picture|Video|Audio) ([1-9][0-9]*)|image([1-9][0-9]*))>$/.exec(label);
 if(!match)return;
 return {kind:match[1]==='Video'?'video':match[1]==='Audio'?'audio':'image',number:Number(match[2]??match[3])};
}
/** Model slots are keyed by input INSTANCE, not its source file. Id-less composer
 * assets may use their asset id until a request instance exists. */
export function inputLabels(refs:LabelInput[]){
 if(refs.some(ref=>ref.role==='source')) return new Map([...refs.filter(r=>r.role==='source'),...refs.filter(r=>r.role!=='source')].map((ref,i)=>[ref.id??ref.asset_id,`<image${i+1}>`]));
 const labels=new Map<string,string>();let audio=0;
 for(const ref of refs)if(ref.kind==='video'&&ref.role==='reference'&&ref.include_audio)labels.set((ref.id??ref.asset_id)+':audio',`<Audio ${++audio}>`);
 const counts={image:0,video:0,audio};
 for(const ref of refs)if(ref.role==='reference')labels.set(ref.id??ref.asset_id,`<${{image:'Picture',video:'Video',audio:'Audio'}[ref.kind]} ${++counts[ref.kind]}>`);
 if(!refs.some(ref=>ref.role==='reference')){const first=refs.find(ref=>ref.kind==='image'&&ref.role==='first_frame');if(first)labels.set(first.id??first.asset_id,'<Picture 1>');}
 return labels;
}
/** Bind unnumbered frame guides too, so role changes cannot silently retarget them. */
export function promptBindings(refs:LabelInput[]){
 const bindings=inputLabels(refs);
 for(const ref of refs)if(ref.kind==='image'&&!bindings.has(ref.id??ref.asset_id)){
  if(ref.role==='first_frame')bindings.set(ref.id??ref.asset_id,'the opening-frame guide');
  if(ref.role==='last_frame')bindings.set(ref.id??ref.asset_id,'the ending-frame guide');
 }
 return bindings;
}
export const promptReferencePattern=new RegExp('<'+inputLabelPatternSource+'>|\\bthe (?:opening|ending)-frame guide\\b','g');
export function remapReferences(prompt:string,before:Map<string,string>,after:Map<string,string>){
 const replacements=new Map([...before].map(([id,label])=>[label,after.get(id)??'[removed reference]']));
 return prompt.replace(promptReferencePattern,label=>replacements.get(label)??label);
}
