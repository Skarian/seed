import {Type} from '@earendil-works/pi-ai';
import type {AgentTool} from '@earendil-works/pi-agent-core';
import type {ToolAsset} from './request-tools.js';
import {visualContext} from './visual-context.js';

type MediaAsset={id:string;kind:string;relative_path:string;metadata?:{duration?:number}};
export interface ReadInputOptions {
 data:string;
 assets:Array<ToolAsset & {aliases?:string[]}>;
 getAsset:(id:string)=>MediaAsset|undefined;
}
/** Construct once per agent run so the inspection budget cannot reset between calls. */
export function createReadInputTool(options:ReadInputOptions):AgentTool {
 let inspections=0,returnedFrames=0;
 return {
  name:'read_input',label:'Inspect input',
  description:'Inspect an attached image or sample a specific video clip when the overview frames are not enough to understand the requested scene or action. Optional; do not call before every request. Returns a few timestamped frames, not continuous video or audio. At most three inspections per turn.',
  parameters:Type.Object({
   asset:Type.String({minLength:1,description:'Copy a supplied asset handle or known asset id. Do not use Picture/Video prompt labels.'}),
   start_seconds:Type.Optional(Type.Number({minimum:0,description:'Video only: source clip start in seconds.'})),
   duration_seconds:Type.Optional(Type.Number({exclusiveMinimum:0,description:'Video only: source clip duration. Omit to inspect the remaining source.'}))
  },{additionalProperties:false}),
  execute:async(_call,raw)=>{
   if(inspections>=3||returnedFrames>=12)throw Error('Inspection budget reached. Use the frames already returned; at most three inspections and twelve frames are allowed per turn.');
   inspections++;
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Provide an asset handle and optional video clip times.');
   const input=raw as Record<string,unknown>;
   if(Object.keys(input).some(key=>!['asset','start_seconds','duration_seconds'].includes(key)))throw Error('Use only asset, start_seconds and duration_seconds.');
   if(typeof input.asset!=='string')throw Error('Copy a supplied asset handle.');
   const candidates=options.assets.filter(asset=>asset.handle===input.asset||asset.asset_id===input.asset||asset.aliases?.includes(input.asset as string));
   const ids=[...new Set(candidates.map(asset=>asset.asset_id))];
   if(ids.length!==1)throw Error('Unknown or ambiguous asset. Copy a supplied asset handle.');
   const asset=options.getAsset(ids[0]!);
   if(!asset)throw Error('This input is no longer available.');
   if(!['image','video'].includes(asset.kind))throw Error('This tool can inspect images and video frames only. It cannot listen to audio.');
   const ranges=new Map<string,{start_seconds:number;duration_seconds:number}>();
   if(asset.kind==='image'){
    if(input.start_seconds!==undefined||input.duration_seconds!==undefined)throw Error('Clip times apply only to video. Omit both for an image.');
   }else if(input.start_seconds!==undefined||input.duration_seconds!==undefined){
    const start=input.start_seconds??0;
    const duration=input.duration_seconds??(asset.metadata?.duration===undefined?undefined:asset.metadata.duration-Number(start));
    if(typeof start!=='number'||!Number.isFinite(start)||start<0||typeof duration!=='number'||!Number.isFinite(duration)||duration<=0)throw Error('Provide a nonnegative numeric start_seconds and positive numeric duration_seconds.');
    if(asset.metadata?.duration!==undefined&&start+duration>asset.metadata.duration+0.001)throw Error(`The clip exceeds this source's ${asset.metadata.duration} second duration. Choose a range within the source.`);
    ranges.set(asset.id,{start_seconds:start,duration_seconds:duration});
   }
   // Each inspection returns at most three images. Repeated inspections consume the same budget.
   const visual=await visualContext(options.data,[asset],ranges);
   const images=visual.images.slice(0,12-returnedFrames),evidence=visual.evidence.slice(0,images.length);
   returnedFrames+=images.length;
   const details={ok:images.length>0,asset_id:asset.id,kind:asset.kind,source_duration_seconds:asset.metadata?.duration,
    ...(ranges.has(asset.id)?{requested_range:ranges.get(asset.id)}:{}),visual_evidence_in_order:evidence,unavailable_inputs:visual.unavailable_inputs,
    evidence_note:'These are sampled still frames, not a continuous video. Events between samples may be missing. Audio has not been supplied; do not claim to hear it.',
    remaining_inspections:3-inspections,remaining_frame_budget:12-returnedFrames};
   if(!images.length)throw Error(JSON.stringify({...details,error:'No readable visual evidence was returned. Do not infer this input\'s appearance.'}));
   return {content:[{type:'text',text:JSON.stringify(details)},...images],details};
  }
 };
}
