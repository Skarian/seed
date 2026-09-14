import {ResizablePrompt} from './resizable-prompt.js';
import {PromptInput} from './prompt-input.js';
import type {ComposerHandle} from './inline-composer.js';
import {inputLabels,remapReferences} from '../shared/reference-labels.js';
import React,{useRef} from 'react';
import type {ImageRequest} from '../server/workflows.js';
import {RequestInputs} from './request-inputs.js';
import {AspectPicker,BatchPicker,LengthPicker,SeedControl} from './request-controls.js';
export type RequestAsset={id:string;name:string;kind:'image'|'video'|'audio';note:string;metadata?:{duration?:number;width?:number;height?:number}};
export function RequestFields({request,assets,mode,disabled=false,step=1,onChange,onPreview}:{request:ImageRequest;assets:RequestAsset[];mode:'sfw'|'nsfw';disabled?:boolean;step?:number;onChange:(request:ImageRequest)=>void;onPreview:(id:string)=>void}){
 const promptEditor=useRef<ComposerHandle>(null);
 const labels=inputLabels(request.references??[]);
 const mentions=[...labels].map(([id,token])=>{const ref=request.references!.find(r=>r.asset_id===(id.endsWith(':audio')?id.slice(0,-6):id))!,asset=assets.find(a=>a.id===ref.asset_id);return {id,token,label:token.slice(1,-1),name:(asset?.name??'Input')+(id.endsWith(':audio')?' · soundtrack':''),kind:ref.kind,url:'/api/v1/assets/'+ref.asset_id+'/content',onPreview:()=>onPreview(ref.asset_id)};});
 mentions.sort((a,b)=>(request.references??[]).findIndex(r=>r.asset_id===(a.id.endsWith(':audio')?a.id.slice(0,-6):a.id))-(request.references??[]).findIndex(r=>r.asset_id===(b.id.endsWith(':audio')?b.id.slice(0,-6):b.id))||Number(a.id.endsWith(':audio'))-Number(b.id.endsWith(':audio')));
 const video=request.workflow!=='text-to-image';
 const change=(values:Partial<ImageRequest>)=>onChange({...request,...values,...(values.count!==undefined||values.seed!==undefined?{resolved_seeds:undefined}:{})});
 const output=(values:Partial<ImageRequest['output']>)=>change({output:{...request.output,...values}});
 return <fieldset disabled={disabled}><div><div className="request-prompt-heading"><label htmlFor="review-prompt">Prompt</label></div>{request.workflow==='reference-to-video'?<PromptInput ref={promptEditor} id="review-prompt" value={request.prompt} mentions={mentions} disabled={disabled} onChange={prompt=>change({prompt})}/>:<ResizablePrompt><textarea id="review-prompt" value={request.prompt} onChange={e=>change({prompt:e.target.value})}/></ResizablePrompt>}</div>
 {request.workflow==='reference-to-video'&&<RequestInputs references={request.references??[]} assets={assets} labels={labels} onInsert={token=>promptEditor.current?.insert(token+' ')} onChange={references=>change({references,prompt:remapReferences(request.prompt,labels,inputLabels(references))})} onPreview={onPreview}/>}
 <div className="review-settings"><div><span className="review-field-label">Aspect ratio</span><AspectPicker value={request.output.aspect} disabled={disabled} onChange={aspect=>output({aspect})}/></div><label>Batch size<BatchPicker value={request.count} onChange={count=>change({count})}/></label>{video&&<><label>Length<LengthPicker value={request.output.duration_seconds??5} step={step} onChange={duration_seconds=>output({duration_seconds})}/></label><label>Quality<select value={request.quality??'fast'} onChange={e=>change({quality:e.target.value as 'fast'|'high',output:{...request.output,size:e.target.value==='high'?'native':request.output.size}})}><option value="fast">Fast</option><option value="high">High</option></select></label></>}</div>
 <details className="review-disclosure" open={request.note?.trim()?true:undefined}><summary>Note</summary><label><span className="sr-only">Note</span><input maxLength={4000} placeholder="Optional note for the generated assets" value={request.note??''} onChange={e=>change({note:e.target.value})}/></label></details>
 <details className="review-disclosure"><summary>Advanced settings</summary><div className="review-settings"><SeedControl random={request.seed==='random'} value={request.seed} onChange={(random,seed)=>change({seed:random?'random':seed})}/>{mode==='nsfw'&&<label>Mode<select value={request.mode} onChange={e=>change({mode:e.target.value as 'sfw'|'nsfw'})}><option value="sfw">Standard</option><option value="nsfw">Spicy</option></select></label>}{video&&<><label>Export<select value={request.output.format??'video'} onChange={e=>output({format:e.target.value as 'video'|'images'})}><option value="video">Video</option><option value="images">Images</option></select></label><label>Soundtrack<select value={request.audio?.output??'generated'} onChange={e=>change({audio:{output:e.target.value as 'generated'|'silent'}})}><option value="generated">Generated</option><option value="silent">Silent</option></select></label></>}</div></details>
 </fieldset>;
}
