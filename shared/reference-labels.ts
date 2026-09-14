export type LabelInput={asset_id:string;kind:'image'|'video'|'audio';role:string;include_audio?:boolean};
/** Model slots, including soundtracks extracted from video inputs. */
export function inputLabels(refs:LabelInput[]){
 const labels=new Map<string,string>();let audio=0;
 for(const ref of refs)if(ref.kind==='video'&&ref.role==='reference'&&ref.include_audio)labels.set(ref.asset_id+':audio',`<Audio ${++audio}>`);
 const counts={image:0,video:0,audio};
 for(const ref of refs)if(ref.role==='reference')labels.set(ref.asset_id,`<${{image:'Picture',video:'Video',audio:'Audio'}[ref.kind]} ${++counts[ref.kind]}>`);
 if(!refs.some(ref=>ref.role==='reference')){const first=refs.find(ref=>ref.kind==='image'&&ref.role==='first_frame');if(first)labels.set(first.asset_id,'<Picture 1>');}
 return labels;
}
export function remapReferences(prompt:string,before:Map<string,string>,after:Map<string,string>){
 const replacements=new Map([...before].map(([id,label])=>[label,after.get(id)??'[removed reference]']));
 return prompt.replace(/<(?:Picture|Video|Audio) [1-9][0-9]*>/g,label=>replacements.get(label)??label);
}
