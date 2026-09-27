import {chatMentions,type MentionBinding} from '../../shared/chat-mentions.js';
import {inputLabels} from '../../shared/reference-labels.js';
import type {InputReference} from '../media.js';
type Asset={id:string;kind?:string};
type Scope={card_id:string;revision:number;references:InputReference[]};
/** Resolve at send time, then persist. Display numbering is never a source identifier. */
export function bindChatMentions(text:string,provided:MentionBinding[]|undefined,assets:Asset[],scope?:Scope):MentionBinding[]{
 if(provided!==undefined&&(!Array.isArray(provided)||provided.length>100))throw Error('Provide at most 100 input mention bindings.');
 const mentions=chatMentions(text),bindings:MentionBinding[]=[];
 for(const value of provided??[])if(!value||!mentions.some(m=>m.token===value.token&&m.asset_id===value.asset_id))throw Error('Input mention binding does not match the message.');
 const labels=inputLabels(scope?.references??[]);
 for(const mention of mentions){
  if(bindings.some(b=>b.token===mention.token))continue;
  const asset=assets.find(a=>a.id===mention.asset_id);if(!asset?.kind)throw Error('A mentioned input is no longer available in this chat.');
  const matches=(provided??[]).filter(b=>b.token===mention.token);
  if(matches.length>1)throw Error('This input mention has conflicting bindings.');
  const explicit=matches[0];
  if(explicit?.channel!==undefined&&explicit.channel!=='audio')throw Error('Unknown input mention channel.');
  if(explicit?.card_id!==undefined||explicit?.revision!==undefined||explicit?.input_settings!==undefined)throw Error('Mention revision scope is assigned by the server.');
  const binding:MentionBinding={token:mention.token,asset_id:asset.id};
  let inputId=explicit?.input_id;
  const audio=explicit?.channel==='audio'||(/^Audio \d+$/.test(mention.label)&&asset.kind==='video');
  if(audio&&asset.kind!=='video')throw Error('Soundtrack mentions require a video input. Audio files use their own input token.');
  if(!explicit&&scope){
   const matching=[...labels].filter(([id,label])=>label===`<${mention.label}>`&&scope.references.some(r=>r.id===(id.endsWith(':audio')?id.slice(0,-6):id)&&r.asset_id===asset.id));
   if(matching.length===1)inputId=matching[0]![0].replace(/:audio$/,'');
  }
  if(inputId!==undefined){
   const ref=scope?.references.find(r=>r.id===inputId&&r.asset_id===asset.id);
   if(!ref||!scope)throw Error('Mentioned input instance changed. Reinsert the reference from the current request.');
   binding.input_id=inputId;binding.card_id=scope.card_id;binding.revision=scope.revision;
   binding.input_settings={role:ref.role,...(ref.range??{}),...(ref.include_audio!==undefined?{include_audio:ref.include_audio}:{}),...(ref.framing?{framing:ref.framing}:{})};
  }
  if(audio)binding.channel='audio';
  bindings.push(binding);
 }
 return bindings;
}
/** Old messages without stored bindings resolve source IDs only, never current request labels. */
export function agentMentionContext(text:string,stored:MentionBinding[]|undefined,assets:Array<{handle:string;asset_id:string;kind:string}>,activeScopes:Scope[]=[]){
 const bindings:MentionBinding[]=stored??chatMentions(text).map(m=>({token:m.token,asset_id:m.asset_id,...(/^Audio \d+$/.test(m.label)&&assets.some(a=>a.asset_id===m.asset_id&&a.kind==='video')?{channel:'audio' as const}:{})}));
 const resolved=bindings.map(binding=>{
  const asset=assets.find(a=>a.asset_id===binding.asset_id);
  const active=Boolean(binding.input_id&&activeScopes.some(scope=>scope.card_id===binding.card_id&&scope.revision===binding.revision&&scope.references.some(ref=>ref.id===binding.input_id&&ref.asset_id===binding.asset_id)));
  return {...binding,source_handle:asset?.handle,available:Boolean(asset),...(binding.input_id?{historical_instance:!active}:{}),prompt_token:asset?`[[${active?binding.input_id:asset.handle}${binding.channel==='audio'?':audio':''}]]`:undefined};
 });
 let agentText=text;
 for(const binding of resolved)agentText=agentText.replaceAll(binding.token,binding.prompt_token??'[Input no longer available]');
 return {text:agentText,...(resolved.length?{mention_bindings:resolved}:{})};
}
