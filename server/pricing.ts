import {randomUUID,createHash} from 'node:crypto';
import {credential} from './credential-store.js';
import {FalError} from './fal-errors.js';
import type {StudioPaths} from './storage.js';
import type {PriceInput,Estimate} from '../shared/pricing.js';
import {priceInput} from '../shared/pricing.js';
import type {ImageRequest} from './workflows.js';
import {loraRoute} from './fal-request.js';
import type {Loras} from './loras.js';
export function normalizePriceInput(raw:any):PriceInput {
  if(!raw||!['text-to-image','text-to-video','reference-to-video'].includes(raw.workflow)||!['sfw','nsfw'].includes(raw.mode)||!['16:9','9:16'].includes(raw.aspect)||!Number.isInteger(raw.count)||raw.count<1||raw.count>16)throw Error('Complete the output settings to calculate a price.');
  const video=raw.workflow!=='text-to-image';
  if(raw.size!==(video?'768p':'1mp')||video&&(!Number.isInteger(raw.duration)||raw.duration<5||raw.duration>15))throw Error('Choose a supported resolution and duration.');
  const references=raw.references??[],loras=raw.loras??[];
  if(!Array.isArray(references)||references.length>12||references.some(r=>!r||!['image','video','audio'].includes(r.kind)||!['reference','first_frame','last_frame'].includes(r.role)||r.kind!=='image'&&r.role!=='reference'||r.kind==='video'&&(!Number.isFinite(r.duration)||r.duration<2||r.duration>15)))throw Error('Choose valid reference clip lengths for the estimate.');
  if(!Array.isArray(loras)||loras.length>3||loras.some(l=>!l||typeof l.id!=='string'||typeof l.revision!=='string'||!Number.isFinite(l.scale)))throw Error('Check the LoRA selection.');
  if(raw.workflow!=='reference-to-video'&&references.length||references.some(r=>r.role==='reference')&&references.some(r=>r.role!=='reference'))throw Error('Use either general references or frame guides.');
  return {workflow:raw.workflow,mode:raw.mode,aspect:raw.aspect,size:raw.size,count:raw.count,...(video?{duration:raw.duration}:{}),loras:loras.map(l=>({id:l.id,revision:l.revision,scale:l.scale})),references:references.map(r=>({kind:r.kind,role:r.role,...(r.kind==='video'?{duration:r.duration}:{})}))};
}
export function billingUnits(input:PriceInput){
  const image=input.workflow==='text-to-image',route=loraRoute(input);
  const endpoint=(image?'fal-ai/krea-2/turbo':input.workflow==='text-to-video'?'minimax/h3/text-to-video':route==='fl'?'minimax/h3/image-to-video':'minimax/h3/reference-to-video')+(input.loras.length?'/lora':'');
  const referenceSeconds=input.references.filter(r=>r.kind==='video').reduce((sum,r)=>sum+r.duration!,0);
  // Verified against this account's fal billing: binary megapixels; 768P is
  // 1.2 base units, and selected reference-video seconds are billed as input.
  const each=image?1280*720/(1024*1024):(input.duration!+referenceSeconds)*1.2;
  return {endpoint,each,unit:image?'megapixels':'seconds',breakdown:image?'1280 × 720 PNG':`${input.duration}s output${referenceSeconds?` + ${referenceSeconds}s video references`:''} · 768p${input.loras.length?' · LoRA':''}`};
}
const fingerprint=(input:PriceInput)=>createHash('sha256').update(JSON.stringify(normalizePriceInput(input))).digest('hex');
export class Pricing {
  private rates=new Map<string,{price:number;unit:string;until:number;key:string}>();
  private quotes=new Map<string,{estimate:Estimate;fingerprint:string}>();
  constructor(private paths:StudioPaths,private loras:Loras,private fetcher:typeof fetch=fetch){}
  clear(){this.rates.clear();this.quotes.clear();}
  async estimate(raw:unknown):Promise<Estimate>{
    const input=normalizePriceInput(raw);this.loras.resolve(input.loras,loraRoute(input),input.mode);
    const key=credential(this.paths,'falKey');if(!key)throw Error('Add your fal key in Admin → Credentials to see prices.');
    const units=billingUnits(input),keyHash=createHash('sha256').update(key).digest('hex');
    let rate=this.rates.get(units.endpoint);
    if(!rate||rate.until<Date.now()||rate.key!==keyHash){
      let response:Response;try{response=await this.fetcher('https://api.fal.ai/v1/models/pricing?endpoint_id='+encodeURIComponent(units.endpoint),{headers:{Authorization:'Key '+key},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Cannot reach fal pricing. Retry when the connection is available.');}
      const body=await response.json().catch(()=>null);if(!response.ok)throw new FalError(response.status,body,response.headers.get('retry-after'));
      const row=body?.prices?.find((p:any)=>p.endpoint_id===units.endpoint);
      if(!row||row.currency!=='USD'||row.unit!==units.unit||!Number.isFinite(row.unit_price)||row.unit_price<0)throw Error('fal returned an unsupported price. Refresh pricing before generating.');
      rate={price:row.unit_price,unit:row.unit,until:Date.now()+60000,key:keyHash};this.rates.set(units.endpoint,rate);
    }
    const per_item=Number((units.each*rate.price).toFixed(10));
    const estimate:Estimate={id:randomUUID(),currency:'USD',per_item,total:Number((per_item*input.count).toFixed(10)),count:input.count,endpoint:units.endpoint,billable_units:units.each*input.count,unit:units.unit,breakdown:units.breakdown,expires_at:new Date(Date.now()+10*60000).toISOString()};
    for(const [id,quote] of this.quotes)if(Date.parse(quote.estimate.expires_at)<Date.now())this.quotes.delete(id);
    if(this.quotes.size>5000)this.quotes.delete(this.quotes.keys().next().value!);
    this.quotes.set(estimate.id,{estimate,fingerprint:fingerprint(input)});return estimate;
  }
  accept(id:unknown,request:ImageRequest){
    const quote=typeof id==='string'?this.quotes.get(id):undefined;
    if(!quote||Date.parse(quote.estimate.expires_at)<Date.now()||quote.fingerprint!==fingerprint(priceInput(request)))throw Error('The cost preview changed or expired. Refresh the estimate before generating.');
    return {...quote.estimate};
  }
}
