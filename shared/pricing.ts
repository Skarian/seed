import type {ImageRequest} from '../server/workflows.js';
import type {LoraSelection} from '../server/loras.js';
export type PriceInput={workflow:ImageRequest['workflow'];mode:ImageRequest['mode'];aspect:string;size:string;count:number;duration?:number;loras:LoraSelection[];references:Array<{kind:string;role:string;duration?:number}>};
export type Estimate={id:string;currency:'USD';per_item:number;total:number;count:number;endpoint:string;billable_units:number;unit:string;breakdown:string;expires_at:string};
export function priceInput(request:ImageRequest):PriceInput{return {workflow:request.workflow,mode:request.mode,aspect:request.output.aspect,size:request.output.size,count:request.count,duration:request.output.duration_seconds,loras:request.loras??[],references:(request.references??[]).map(r=>({kind:r.kind,role:r.role,...(r.kind==='video'?{duration:r.range?.duration_seconds}:{})}))};}
export function money(value:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:value<0.1?4:2}).format(value);}
