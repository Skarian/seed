import {bindChatMentions,agentMentionContext} from './mentions.js';

import {loraRoute,isVideoWorkflow} from '../../shared/workflows.js';
import type {MentionBinding} from '../../shared/chat-mentions.js';
import {createReadInputTool} from './read-input.js';
import {requestToolSchemas,prepareToolRequest,requestToolRules,requestToolResultError,toolInputLabels,toolPromptBindings,toolPromptReferencePattern,type ToolAsset} from './request-tools.js';
import {visualContext} from './visual-context.js';
import {recordTurnEvent,finishTurn} from './transcript.js';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Agent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { ChatView, ChatMode, ChatWorkflow, ChatGroup, ChatCard, ChatRevision } from '../../shared/chat.js';
import type { StudioPaths } from '../storage.js';
import { imageRequest, seeds, type ImageRequest } from '../workflows.js';
import type { Jobs } from '../jobs.js';
import { createChatAgent, type ChatAccounting } from './provider.js';
import { chatCredential } from './credentials.js';
import { chatPromptSnapshot, chatWorkflows, chatTitlePrompt } from './prompts.js';
import { chatReferenceLabels, preserveChatLabels, validateChatReferences } from './references.js';
import { compactConversation, settingsOnlyMessage, type ConversationSummary } from './context.js';

/** Agent snapshots mirror the flat tool fields; canonical requests remain persisted unchanged. */
function agentRequest(request:ImageRequest,assets:ToolAsset[]=[]){
  const bindings=new Map([...toolPromptBindings(request.references??[])].map(([id,label])=>[label,'[['+id+']]']));
  const prompt=process.env.SEED_AGENT_REFERENCE_MODE!=='direct'?request.prompt.replace(toolPromptReferencePattern,label=>bindings.get(label)??label):request.prompt;
  return {prompt,batch_size:request.count,seed:request.seed,aspect_ratio:request.output.aspect,size:request.output.size,loras:request.loras??[],
    ...(request.note?{note:request.note}:{}),...(request.mode==='nsfw'?{mode:request.mode}:{}),
    ...(isVideoWorkflow(request.workflow)?{duration_seconds:request.output.duration_seconds,audio_output:request.audio?.output}:{}),
    ...(request.references?{inputs:request.references.map(ref=>({id:ref.id,asset:assets.find(a=>a.asset_id===ref.asset_id)?.handle??ref.asset_id,role:ref.role,
      ...(ref.framing?{framing:ref.framing}:{}),...(ref.range??{}),...(ref.kind==='video'?{include_audio:Boolean(ref.include_audio)}:{})}))}:{})};
}
interface StoredChat extends ChatView {title_manual?:boolean;title_accounting?:ChatAccounting[];title_error?:string;summary?:ConversationSummary;runs:Array<{id:string;workflow?:ChatWorkflow|null;source_assets?:string[];target_request_id?:string;prompt:ReturnType<typeof chatPromptSnapshot>;accounting:ChatAccounting[];messages:AgentMessage[];state:string;summary?:ConversationSummary}>}
const terminal=['completed','failed','cancelled'];
const latest=(card:ChatCard)=>card.revisions.at(-1)!;
const openGroup=(chat:ChatView)=>chat.groups.find(g=>!['released','stopped'].includes(g.state));
const now=()=>new Date().toISOString();

export class Chats {
  private listeners=new Map<string,Set<(value:unknown)=>void>>();
  subscribe(id:string,listener:(value:unknown)=>void){this.get(id);let group=this.listeners.get(id);if(!group){group=new Set();this.listeners.set(id,group);}group.add(listener);return()=>{group!.delete(listener);if(!group!.size)this.listeners.delete(id);};}
  private agents=new Map<string,Agent>();
  private tasks=new Map<string,Promise<void>>();
  private preparing=new Set<string>();
  private titles=new Map<string,{agent:Agent;task:Promise<void>}>();
  constructor(private db:Database.Database,private paths:StudioPaths,private jobs:Jobs,
    private transport?:typeof fetch) {
    for(const row of db.prepare('SELECT body_json FROM chats').all() as {body_json:string}[]) {
      const chat=JSON.parse(row.body_json) as StoredChat;
      let changed=false;
      for(const card of chat.groups.flatMap(g=>g.cards))for(const revision of card.revisions)for(const id of revision.job_ids){const job=jobs.get(id);if(job&&!job.source){job.source={chat_id:chat.id,card_id:card.id,revision:revision.number};db.prepare('UPDATE jobs SET snapshot_json=? WHERE id=?').run(JSON.stringify(job),id);}}
      if(chat.groups.some(g=>g.after_message_id===undefined)){for(const group of chat.groups)if(group.after_message_id===undefined)group.after_message_id=chat.messages.at(-1)?.id??null;changed=true;}
      for(const group of chat.groups){
        if(group.state!=='reviewing'||!group.cards.length||group.cards.some(c=>latest(c).decision==='undecided'||latest(c).job_ids.length))continue;
        if(group.cards.some(c=>latest(c).decision==='approved')){
          if(!group.submission_error){group.submission_error=chat.activity==='preparing'?'Preparation was interrupted by server restart. Retry to continue.':'These approved requests did not start. Retry to continue.';changed=true;}
        }else{group.state='released';delete group.submission_error;changed=true;}
      }
      if(chat.activity==='thinking'||chat.activity==='preparing'){
        if(chat.activity==='thinking')chat.error='Interrupted by server restart. Send a message to continue.';
        chat.activity='idle';changed=true;
        for(const run of chat.runs)if(run.state==='running')run.state='interrupted';for(const message of chat.messages)if(message.transcript?.state==='running'){finishTurn(message.transcript,'failed');message.transcript.error='Interrupted by server restart.';}
      }
      if(changed)this.save(chat);
    }
  }
  private save(chat:StoredChat){
    chat.updated_at=now();this.db.prepare('INSERT INTO chats VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body_json=excluded.body_json').run(chat.id,chat.mode,JSON.stringify(chat));
    for(const listener of this.listeners.get(chat.id)??[]){
      try{listener({version:chat.version,partial:chat.partial??'',partial_reasoning:chat.partial_reasoning??'',activity:chat.activity,error:chat.error,stream_message:[...chat.messages].reverse().find(m=>m.transcript)});}
      catch{this.listeners.get(chat.id)?.delete(listener); /* A disconnected observer cannot undo a committed save. */}
    }
  }
  private get(id:string):StoredChat{const row=this.db.prepare('SELECT body_json FROM chats WHERE id=?').get(id) as {body_json:string}|undefined;if(!row)throw Error('Chat not found.');return JSON.parse(row.body_json);}
  private event(chat:StoredChat,text:string){chat.messages.push({id:randomUUID(),role:'event',text,assets:[],created_at:now()});}
  private jobIds(chat:ChatView){return [...new Set(chat.groups.flatMap(g=>g.cards.flatMap(c=>c.revisions.flatMap(r=>r.job_ids))))];}
  private activeJobs(chat:ChatView){return this.jobIds(chat).map(id=>this.jobs.get(id)).filter(job=>job&&!terminal.includes(job.state));}
  private generating(chat:ChatView){return this.activeJobs(chat).some(job=>!['needs_attention','blocked'].includes(job!.state)&&!job!.recovery_blocked&&!this.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(job!.id));}
  private busy(chat:ChatView){return this.tasks.has(chat.id)||this.preparing.has(chat.id)||this.generating(chat);}
  private checkVersion(chat:ChatView,version:number){if(chat.version!==version)throw Error('Chat changed in another tab. Refresh and send again.');}
  view(id:string){const chat=this.get(id);const {runs,...view}=chat;
    view.activity=this.tasks.has(id)?'thinking':this.preparing.has(id)?'preparing':this.generating(chat)?'generating':'idle';
    for(const job of this.jobIds(chat).map(id=>this.jobs.get(id)))for(const asset of job?.outputs??[])if(!chat.assets.includes(asset))chat.assets.push(asset);
    return {...view,asset_manifest:this.contextAssets(chat),jobs:this.jobIds(chat).map(id=>this.jobs.get(id)).filter(Boolean).map(job=>this.jobs.publicJob(job!)),accounting:[...runs.flatMap(run=>run.accounting),...(chat.title_accounting??[])]};
  }
  list(mode:ChatMode){return (this.db.prepare('SELECT id FROM chats WHERE mode=?').all(mode) as {id:string}[]).map(row=>{const c=this.view(row.id);return {id:c.id,title:c.title,last_reply_id:c.messages.filter(m=>m.role==='assistant').at(-1)?.id??'',activity:c.activity,error:c.error??c.groups.find(g=>g.state==='reviewing'&&g.submission_error)?.submission_error??c.jobs.find(j=>j?.state==='failed')?.error,status:c.jobs.some(j=>j?.state==='failed')?'Failed':c.jobs.length&&c.jobs.every(j=>j&&terminal.includes(j.state))?'Completed':'',updated_at:c.updated_at};}).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));}
  create(mode:ChatMode){const id=randomUUID();this.save({id,mode,title:'New chat',workflow:null,version:0,epoch:0,reasoning:true,messages:[],groups:[],assets:[],runs:[],activity:'idle',error:null,created_at:now(),updated_at:now()});return this.view(id);}
  settings(id:string,version:number,values:{title?:string;workflow?:ChatWorkflow|null;reasoning?:boolean}){
    const chat=this.get(id);this.checkVersion(chat,version);if(this.busy(chat))throw Error('Stop this chat before changing its settings.');
    if(values.title!==undefined){if(!values.title.trim()||values.title.length>120)throw Error('Choose a title of 1–120 characters.');chat.title=values.title.trim();chat.title_manual=true;}
    if(values.workflow!==undefined){if(values.workflow!==null&&!Object.hasOwn(chatWorkflows,values.workflow))throw Error('Unknown workflow.');chat.workflow=values.workflow;}
    if(values.reasoning!==undefined)chat.reasoning=values.reasoning;
    chat.version++;this.save(chat);return this.view(id);
  }
  delete(id:string){const chat=this.get(id);if(this.busy(chat))throw Error('Stop generation before deleting this chat, then try again.');if(this.activeJobs(chat).length)throw Error('Remote cancellation or output saving is still pending. Check the worker status and try deletion after it settles.');this.titles.get(id)?.agent.abort();this.db.prepare('DELETE FROM chats WHERE id=?').run(id);}
  stop(id:string){this.titles.get(id)?.agent.abort();const chat=this.get(id);chat.epoch++;chat.version++;chat.activity='idle';
    for(const run of chat.runs)if(run.state==='running')run.state='stopped';for(const message of chat.messages)if(message.transcript?.state==='running')finishTurn(message.transcript,'stopped');
    for(const group of chat.groups)if(group.state!=='released')group.state='stopped';
    this.db.transaction(()=>{this.jobs.stopJobs(this.jobIds(chat));this.save(chat);})();
    this.agents.get(id)?.abort();return this.view(id);
  }
  private assertAssets(chat:StoredChat,ids:string[],allowExisting=true){
    if(ids.length>24||new Set(ids).size!==ids.length)throw Error('Choose up to 24 distinct assets.');
    for(const id of ids){
      const asset=this.jobs.media.get(id);if(!asset||(asset.metadata.state??'ready')!=='ready')throw Error('An attached asset is missing or still uploading.');
      const row=this.db.prepare(`SELECT COALESCE(json_extract(metadata_json,'$.mode'),(SELECT json_extract(snapshot_json,'$.request.mode') FROM jobs WHERE jobs.id=json_extract(assets.metadata_json,'$.job_id')),'sfw') mode FROM assets WHERE id=?`).get(id) as {mode:string};
      if(!(allowExisting&&chat.assets.includes(id))&&row.mode!==chat.mode)throw Error('Choose assets available in this chat.');
    }
  }
  private contextAssets(chat:StoredChat){return chat.assets.map(id=>{const asset=this.jobs.media.get(id);const own=this.db.prepare('SELECT note FROM asset_notes WHERE id=?').get(id) as {note:string}|undefined;
    const inherited=this.db.prepare('SELECT n.note FROM sequence_frames f JOIN asset_notes n ON n.id=f.sequence_id WHERE f.asset_id=?').get(id) as {note:string}|undefined;
    return {id,name:asset?.name??'Missing media',kind:asset?.kind,metadata:asset?.metadata,note:own?.note||inherited?.note||''};});}
  private request(chat:StoredChat,workflow:ChatWorkflow,raw:unknown,previous?:ImageRequest):ImageRequest{
    const value=raw as Record<string,unknown>;
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Provide request settings.');
    if(chat.mode==='sfw'&&Object.hasOwn(value,'mode'))throw Error('This request cannot supply a mode field.');
    let request:ImageRequest;
    request=imageRequest({...value,workflow,mode:chat.mode==='sfw'?'sfw':value.mode??'nsfw'});
    if(previous){request=preserveChatLabels(previous,request);if(value.note===undefined&&previous.note)request.note=previous.note;}
    validateChatReferences(request);
    if(request.workflow!=='image-to-image')this.jobs.loras.resolve(request.loras,loraRoute(request),request.mode);
    for(const ref of request.references??[])if(!chat.assets.includes(ref.asset_id))throw Error('Reference must be provided in this conversation.');
    this.assertAssets(chat,[...new Set((request.references??[]).map(r=>r.asset_id))]);return request;
  }
  private revision(chat:StoredChat,request:ImageRequest,number:number,sourceJobId?:string):ChatRevision{
    const notes=Object.fromEntries(this.contextAssets(chat).filter(a=>request.references?.some(r=>r.asset_id===a.id)).map(a=>[a.id,a.note]));
    return {number,request,notes,decision:'undecided',job_ids:[],...(sourceJobId?{source_job_id:sourceJobId}:{}),after_message_id:chat.messages.at(-1)?.id??null};
  }
  private workflowTools(id:string,epoch:number,workflow:ChatWorkflow,runId:string,assets:ToolAsset[],target?:string):AgentTool[] {
    const initial=this.get(id),snapshots=new Map(initial.groups.flatMap(g=>g.cards).map(c=>[c.id,latest(c).number]));
    const schemas=requestToolSchemas(workflow,initial.mode,this.jobs.loras.list(initial.mode).filter(l=>l.source_status==='ready').some(l=>workflow==='text-to-image'?l.route==='image':workflow==='text-to-video'?l.route==='fl':l.route!=='image'));
    const referenceMode=process.env.SEED_AGENT_REFERENCE_MODE!=='direct'?'stable':'direct';
    return (['create','edit'] as const).map(operation=>({
      name:operation+'_request',label:operation==='create'?'Create request':'Edit request',
      description:operation==='create'?'Prepare one new request for user review. Does not generate media.':'Change an existing request. Copy request_id from context. Send only changed fields; all omitted fields stay unchanged.',
      parameters:schemas[operation],
      execute:async(_call,raw)=>{
        try{
          const current=this.get(id);
          if(current.epoch!==epoch||current.workflow!==workflow)throw Error('This run is no longer active.');
          let group=openGroup(current);
          if(group&&group.workflow!==workflow)throw Error('Resolve the current review before changing workflows.');
          const value=raw as Record<string,unknown>;
          const editId=operation==='edit'?String(value.request_id):target;
          const card=editId?group?.cards.find(c=>c.id===editId):undefined;
          if(editId&&!card)throw Error('Request not found. Use a request_id listed in current review. A failed create has no request_id.');
          if(card&&snapshots.get(card.id)!==latest(card).number)throw Error('Request changed after this agent started. Read the current request before editing; no changes were saved.');
          const request=prepareToolRequest({workflow,mode:current.mode,assets,previous:card?latest(card).request:undefined,referenceMode},value);
          for(const ref of request.references??[])if(!current.assets.includes(ref.asset_id))throw Error('Input is not attached to this chat.');
          this.assertAssets(current,[...new Set((request.references??[]).map(r=>r.asset_id))]);
          validateChatReferences(request);
          if(request.workflow!=='image-to-image')this.jobs.loras.resolve(request.loras,loraRoute(request),request.mode);
          if(!group){group={id:randomUUID(),after_message_id:[...current.messages].reverse().find(m=>m.role==='user')?.id??null,workflow,state:'assembling',cards:[]};current.groups.push(group);}
          let saved:ChatCard;
          if(card){
            card.revisions.push(this.revision(current,request,latest(card).number+1,latest(card).source_job_id));saved=card;
          }else{
            if(group.cards.length>=16)throw Error('A review supports at most 16 requests.');
            saved={id:randomUUID(),workflow,revisions:[this.revision(current,request,1)]};group.cards.push(saved);
          }
          latest(saved).run_id=runId;snapshots.set(saved.id,latest(saved).number);if(target===saved.id)target=undefined;
          delete group.submission_error;
          this.save(current);
          const result={ok:true,saved:true,request_id:saved.id,revision:latest(saved).number,request:agentRequest(request,assets),reference_labels:Object.fromEntries(toolInputLabels(request.references??[]))};
          return {content:[{type:'text' as const,text:JSON.stringify(result)}],details:result};
        }catch(error){throw Error(JSON.stringify(requestToolResultError(error,operation)));}
      }
    }));
  }
  send(id:string,input:{version:number;text:string;assets:string[];mention_bindings?:MentionBinding[];card_id?:string;revision?:number;attach_request?:boolean}){
    const chat=this.get(id);this.checkVersion(chat,input.version);if(this.busy(chat))throw Error('This chat is busy. Stop it before sending another message.');
    if(!input.text.trim()||input.text.length>16000)throw Error('Write a message of 1–16000 characters.');
    const key=chatCredential(this.paths);if(!key)throw Error('Add your OpenRouter key in Admin → Credentials.');
    for(const job of this.jobIds(chat).map(id=>this.jobs.get(id)))for(const asset of job?.outputs??[])if(!chat.assets.includes(asset))chat.assets.push(asset);
    this.assertAssets(chat,input.assets);
    for(const asset of input.assets)if(!chat.assets.includes(asset))chat.assets.push(asset);
    const group=openGroup(chat);
    let target:ChatCard|undefined;
    if(input.card_id){target=group?.cards.find(c=>c.id===input.card_id);if(!target||latest(target).number!==input.revision)throw Error('This card changed or already started. Refresh it.');if(target.workflow!==chat.workflow)throw Error('Switch to this card’s workflow before sending feedback.');}
    if(input.attach_request&&!target)throw Error('Choose the request to attach.');
    const contextCards=target?[target]:(group??[...chat.groups].reverse().find(g=>g.workflow===chat.workflow))?.cards??[];
    const mentionBindings=bindChatMentions(input.text,input.mention_bindings,this.contextAssets(chat),target?{card_id:target.id,revision:latest(target).number,references:latest(target).request.references??[]}:undefined);
    this.assertAssets(chat,mentionBindings.map(binding=>binding.asset_id));
    const inherited=settingsOnlyMessage(input.text)?[]:contextCards.flatMap(c=>latest(c).request.references?.map(r=>r.asset_id)??[]);
    const priorInputs=[...chat.messages].reverse().find(m=>m.role==='user'&&m.assets.length)?.assets??[];
    const selected=[...new Set([...input.assets,...mentionBindings.map(binding=>binding.asset_id),...inherited,...(!input.assets.length&&!inherited.length&&!settingsOnlyMessage(input.text)?priorInputs:[])])];
    if(selected.filter(id=>this.jobs.media.get(id)?.kind==='image').length>9)throw Error('Choose at most nine images for this message.');
    const snapshot=chatPromptSnapshot(this.paths,chat.mode,chat.workflow);
    snapshot.system+='\n\n'+requestToolRules(process.env.SEED_AGENT_REFERENCE_MODE!=='direct'?'stable':'direct',chat.workflow??undefined);
    snapshot.hash=createHash('sha256').update(JSON.stringify({version:snapshot.version,system:snapshot.system,summarySystem:snapshot.summarySystem})).digest('hex');
    chat.messages.push({id:randomUUID(),role:'user',text:input.text,mention_bindings:mentionBindings,assets:input.assets,...(input.attach_request&&target?{request_attachment:{card_id:target.id,revision:latest(target).number,request:structuredClone(latest(target).request),notes:structuredClone(latest(target).notes)}}:{}),created_at:now()});
    const needsTitle=chat.messages.filter(m=>m.role==='user').length===1&&!chat.title_manual;
    if(group)group.state='revising';chat.activity='thinking';chat.error=null;chat.partial='';chat.partial_reasoning='';chat.version++;
    const run={id:randomUUID(),workflow:chat.workflow,source_assets:[...input.assets],target_request_id:target?.id,prompt:snapshot,accounting:[] as ChatAccounting[],messages:[] as AgentMessage[],state:'running'};chat.runs.push(run);chat.messages.push({id:run.id,role:'assistant',text:'',assets:[],created_at:now(),transcript:{started_at:now(),state:'running',steps:[]}});this.save(chat);
    const task=this.run(chat.id,chat.epoch,run.id,key,snapshot,selected,target?.id,contextCards.map(c=>c.id)).finally(()=>{if(this.tasks.get(id)===task){this.tasks.delete(id);this.agents.delete(id);}});this.tasks.set(id,task);if(needsTitle){try{this.generateTitle(id,input.text,key);}catch(error){const current=this.get(id);current.title_error=(error as Error).message;this.save(current);}}return this.view(id);
  }
  private generateTitle(id:string,firstMessage:string,key:string){
    const agent=createChatAgent({apiKey:key,systemPrompt:chatTitlePrompt(this.paths),reasoning:false,maxTokens:128,fetch:this.transport,onAccounting:value=>{try{const chat=this.get(id);chat.title_accounting=[value];this.save(chat);}catch{/* Chat may have been deleted. */}}});
    const task=(async()=>{try{await agent.prompt(firstMessage);const final=agent.state.messages.at(-1);if(final?.role!=='assistant'||final.stopReason!=='stop')throw Error('Title generation did not complete.');const title=final.content.filter(p=>p.type==='text').map(p=>p.text).join('').trim().replace(/^['"“”]+|['"“”]+$/g,'').replace(/\s+/g,' ').slice(0,70);if(!title)throw Error('Title generation returned no title.');const chat=this.get(id);if(!chat.title_manual){chat.title=title;this.save(chat);}}catch(error){try{const chat=this.get(id);chat.title_error=(error as Error).message;this.save(chat);}catch{/* Chat was deleted. */}}finally{this.titles.delete(id);}})();
    this.titles.set(id,{agent,task});
  }
  private async run(id:string,epoch:number,runId:string,key:string,snapshot:ReturnType<typeof chatPromptSnapshot>,selected:string[],target?:string,contextCardIds:string[]=[]){
    try{
      const chat=this.get(id);
      const ranges=new Map<string,Array<{start_seconds:number;duration_seconds:number;input_id:string}>>();
      for(const ref of chat.groups.flatMap(g=>g.cards).filter(c=>contextCardIds.includes(c.id)).flatMap(c=>latest(c).request.references??[])){if(ref.range)ranges.set(ref.asset_id,[...(ranges.get(ref.asset_id)??[]),{...ref.range,input_id:ref.id}]);}
      const visual=await visualContext(this.paths.data,selected.map(assetId=>this.jobs.media.get(assetId)).filter(Boolean),ranges);
      const images=visual.images,imageIds=visual.evidence.filter(e=>e.type==='image').map(e=>e.asset_id),unavailableImages=visual.unavailable;
      if(this.get(id).epoch!==epoch)return;
      const manifest=this.contextAssets(chat),group=openGroup(chat);
      const toolAssets=manifest.map((a,index)=>({handle:'input'+(index+1),asset_id:a.id,kind:a.kind as 'image'|'video'|'audio',duration_seconds:Number(a.metadata?.duration)||undefined})).filter(a=>a.kind);
      const defaultLabels=toolInputLabels(toolAssets.map(a=>({id:a.handle,asset_id:a.asset_id,kind:a.kind,role:'reference' as const})));
      const availableInputs=toolAssets.map(a=>({...a,...(process.env.SEED_AGENT_REFERENCE_MODE==='direct'?{prompt_label:defaultLabels.get(a.handle)}:{}),...(a.kind==='video'?{soundtrack_token:'[['+a.handle+':audio]]',soundtrack_usage:'Set include_audio true to use this soundtrack.'}:{}),prompt_token:'[['+a.handle+']]',name:manifest.find(m=>m.id===a.asset_id)?.name}));

      const account=(value:ChatAccounting)=>{const c=this.get(id),r=c.runs.find(r=>r.id===runId)!;const prior=value.id?r.accounting.findIndex(v=>v.id===value.id):-1;if(prior<0)r.accounting.push(value);else r.accounting[prior]=value;this.save(c);};
      const history=chat.messages.filter(m=>m.role!=='event'&&m.id!==runId).map(m=>({role:m.role==='assistant'?'assistant':'user',...agentMentionContext(m.text,m.mention_bindings,toolAssets,chat.groups.flatMap(g=>g.cards).filter(c=>contextCardIds.includes(c.id)).map(c=>({card_id:c.id,revision:latest(c).number,references:latest(c).request.references??[]})))}));
      const compact=await compactConversation(history,chat.summary,async input=>{
        const summarizer=createChatAgent({apiKey:key,systemPrompt:snapshot.summarySystem,reasoning:false,fetch:this.transport,onAccounting:account});
        this.agents.set(id,summarizer);await summarizer.prompt(input);
        if(this.get(id).epoch!==epoch)throw Error('Stopped.');
        const final=summarizer.state.messages.at(-1);if(final?.role!=='assistant'||final.stopReason!=='stop')throw Error('Conversation summarization did not complete.');
        return final.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
      });
      const afterSummary=this.get(id);if(afterSummary.epoch!==epoch)return;
      afterSummary.summary=compact.summary;afterSummary.runs.find(r=>r.id===runId)!.summary=compact.summary;this.save(afterSummary);
      const currentRun=chat.runs.find(r=>r.id===runId)!;
      let previousAttempt;
      if(!currentRun.source_assets?.length){
        for(const priorRun of [...chat.runs].reverse().filter(r=>r.id!==runId)){
          if(priorRun.workflow!==chat.workflow||priorRun.target_request_id!==currentRun.target_request_id)break;
          previousAttempt=[...(chat.messages.find(m=>m.id===priorRun.id)?.transcript?.steps??[])].reverse().find(s=>s.kind==='tool'&&['create_request','edit_request'].includes(s.name??''));
          if(previousAttempt||priorRun.source_assets?.length)break;
        }
      }
      let previousResult:unknown=previousAttempt?.result;
      const previousText=(previousAttempt?.result as any)?.content?.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n');
      if(previousText){try{previousResult=JSON.parse(previousText);}catch{previousResult={message:previousText.slice(0,3000),truncated:previousText.length>3000};}}
      const last_attempt=previousAttempt&&previousAttempt.state!=='succeeded'?{tool:previousAttempt.name,input:previousAttempt.input,saved:false,result:previousResult}:undefined;
      const available_loras=this.jobs.loras.list(chat.mode).filter(l=>l.source_status==='ready').filter(l=>chat.workflow==='text-to-image'?l.route==='image':chat.workflow==='text-to-video'?l.route==='fl':chat.workflow==='reference-to-video'?l.route!=='image':false).map(l=>({id:l.id,revision:l.revision,name:l.name,version:l.version,description:l.description??'',trigger_words:l.trigger_words??[],source_status:l.source_status,default_scale:l.default_scale,min_scale:l.min_scale,max_scale:l.max_scale,compatible_with:l.route==='image'?'Krea images':l.route==='fl'?'Text to video and first/last-frame guides':'General image/video/audio references'}));
      const context=JSON.stringify({available_loras,worker_policy:"Approved requests queue for a compatible worker. Workers are rented and quit by the owner in the GPU panel; no chat tool acquires compute. LoRA files are installed only when a new worker launches. A catalog entry does not imply every running worker has it. Do not quote per-generation costs.",last_attempt,earlier_conversation_summary:compact.summary?.text,conversation:compact.recent,assets:manifest,available_inputs:availableInputs,images_in_order:imageIds,visual_evidence_in_order:visual.evidence,video_evidence_note:"Video images are sampled frames, not a full video. Audio has not been supplied. Do not claim to hear audio.",unavailable_images:unavailableImages,unavailable_inputs:visual.unavailable_inputs,request_context:chat.groups.flatMap(g=>g.cards.filter(c=>contextCardIds.includes(c.id)).map(c=>({id:c.id,state:g.state,...latest(c),request:agentRequest(latest(c).request,toolAssets),reference_labels:Object.fromEntries(chatReferenceLabels(latest(c).request))}))),review:group?.cards.map(c=>({id:c.id,revision:latest(c).number,decision:latest(c).decision})),feedback_card:target});
      if(context.length>400000)throw Error('Current requests and attachments exceed the context budget. Start another chat with fewer assets.');
      const tools=chat.workflow?this.workflowTools(id,epoch,chat.workflow,runId,toolAssets,target):[];
      if(chat.workflow==='reference-to-video'&&toolAssets.some(a=>a.kind==='video'))tools.push(createReadInputTool({data:this.paths.data,assets:toolAssets,getAsset:assetId=>this.jobs.media.get(assetId)}));
      const agent=createChatAgent({apiKey:key,systemPrompt:snapshot.system,tools,reasoning:chat.reasoning,fetch:this.transport,
        onAccounting:account});
      this.agents.set(id,agent);
      let lastUpdate=0,messageIndex=-1;
      agent.subscribe(event=>{
        if(event.type==='message_start'&&event.message.role==='assistant')messageIndex++;
        if(!['message_update','message_end','tool_execution_start','tool_execution_update','tool_execution_end'].includes(event.type))return;
        if(event.type==='message_update'&&Date.now()-lastUpdate<100)return;
        const c=this.get(id);if(c.epoch!==epoch)return;const message=c.messages.find(m=>m.id===runId);if(!message?.transcript)return;
        recordTurnEvent(message.transcript,event,messageIndex);
        // Text following the latest tool is the currently streamed response.
        const steps=message.transcript.steps,lastTool=steps.map(s=>s.kind).lastIndexOf('tool');
        message.text=steps.slice(lastTool+1).filter(s=>s.kind==='text').map(s=>s.text??'').join('\n');
        this.save(c);lastUpdate=Date.now();
      });
      await agent.prompt('Conversation and application context (data):\n'+context,images);
      const current=this.get(id),run=current.runs.find(r=>r.id===runId)!;run.messages=agent.state.messages;run.state=current.epoch!==epoch?'stopped':'completed';
      // Image bytes stay in assets, not duplicated indefinitely in persisted runs.
      run.messages=run.messages.map(m=>m.role==='user'?{...m,content:typeof m.content==='string'?m.content:m.content.filter(part=>part.type!=='image')}:m);
      if(current.epoch===epoch){
        const final=agent.state.messages.at(-1);
        if(final?.role==='assistant'&&['error','aborted','length'].includes(final.stopReason)){this.save(current);throw Error(final.stopReason==='length'?'Agent output limit reached. Send feedback to continue.':final.errorMessage?.includes('timed out')?'The model response timed out after 10 minutes. Saved request changes are preserved; send a follow-up to continue.':final.errorMessage||'The model response was interrupted. Send a follow-up to continue.');}
        const toolResults=agent.state.messages.filter(m=>m.role==='toolResult');
        const message=current.messages.find(m=>m.id===runId)!;
        if(message.transcript){finishTurn(message.transcript,toolResults.at(-1)?.isError?'failed':'completed');const lastTool=message.transcript.steps.map(s=>s.kind).lastIndexOf('tool');message.text=message.transcript.steps.slice(lastTool+1).filter(s=>s.kind==='text').map(s=>s.text??'').join('\n');message.reasoning_text=message.transcript.steps.filter(s=>s.kind==='reasoning').map(s=>s.text??'').join('\n');}
        for(const card of current.groups.flatMap(g=>g.cards))for(const revision of card.revisions)if(revision.run_id===runId)revision.after_message_id=current.messages.at(-1)?.id??null;
        const pending=openGroup(current);if(pending){if(pending.cards.length){pending.state='reviewing';for(const card of pending.cards)if(card.timeline_start&&card.timeline_start>latest(card).number)card.timeline_start=latest(card).number;}else current.groups=current.groups.filter(g=>g.id!==pending.id);}
        current.activity='idle';current.partial='';current.partial_reasoning='';
      }
      this.save(current);
    }catch(error){const current=this.get(id);current.runs.find(r=>r.id===runId)!.state='failed';if(current.epoch===epoch){const message=current.messages.find(m=>m.id===runId);if(message?.transcript){finishTurn(message.transcript,'failed');message.transcript.error=(error as Error).message;}current.error=(error as Error).message;current.activity='idle';const pending=openGroup(current);if(pending?.cards.length){pending.state='reviewing';for(const card of pending.cards)if(card.timeline_start&&card.timeline_start>latest(card).number)card.timeline_start=latest(card).number;}}this.save(current);}
  }
  revise(id:string,cardId:string,number:number,raw:unknown){const chat=this.get(id);if(this.tasks.has(id)||this.preparing.has(id))throw Error('Wait for the request to finish preparing.');const group=openGroup(chat),card=group?.cards.find(c=>c.id===cardId);if(!group||!card||latest(card).number!==number)throw Error('Request changed or already started.');card.revisions.push(this.revision(chat,this.request(chat,card.workflow,raw,latest(card).request),number+1,latest(card).source_job_id));delete group.submission_error;chat.version++;this.save(chat);return this.view(id);}
  async decide(id:string,cardId:string,number:number,decision:'approved'|'denied'){
    const chat=this.get(id);if(this.tasks.has(id)||this.preparing.has(id))throw Error('Wait for this chat to finish.');const group=openGroup(chat),card=group?.cards.find(c=>c.id===cardId);
    if(!group||group.state!=='reviewing'||!card||latest(card).number!==number)throw Error('Review the current completed proposal.');
    if(decision==='approved'&&!latest(card).approved_snapshot){

      const current=this.get(id);
      if(current.version!==chat.version||current.epoch!==chat.epoch||this.tasks.has(id)||this.preparing.has(id))throw Error('Chat changed during approval. Review again.');
      latest(card).notes=this.revision(chat,latest(card).request,number).notes;
      latest(card).request.resolved_seeds=seeds(latest(card).request);latest(card).approved_snapshot=true;
    }
    if(latest(card).decision!==decision)delete group.submission_error;
    latest(card).decision=decision;
    const settled=group.cards.every(c=>latest(c).decision!=='undecided'),prepare=settled&&group.cards.some(c=>latest(c).decision==='approved');
    if(settled){delete group.submission_error;chat.activity=prepare?'preparing':'idle';if(!prepare)group.state='released';}
    // Persist the handoff together with the final decision, before any async work.
    chat.version++;this.save(chat);
    if(prepare)await this.release(id,group.id,chat.epoch);
    return this.view(id);
  }
  private async release(id:string,groupId:string,epoch:number){
    this.preparing.add(id);
    try{await this.jobs.serialize(async()=>{
      const chat=this.get(id),group=chat.groups.find(g=>g.id===groupId);if(chat.epoch!==epoch||group?.state!=='reviewing')return;

      const approved=group.cards.filter(c=>latest(c).decision==='approved');
      const staged:Array<Awaited<ReturnType<Jobs['prepareSubmission']>>>=[];
      for(const card of approved){this.assertAssets(chat,[...new Set((latest(card).request.references??[]).map(r=>r.asset_id))]);staged.push(await this.jobs.prepareSubmission(latest(card).request,`${group.id}-${card.id}-${latest(card).number}`,{chat_id:id,card_id:card.id,revision:latest(card).number,...(latest(card).source_job_id?{job_id:latest(card).source_job_id}:{})}));}
      // Recheck approval after asynchronous media preparation.
      const final=this.get(id);if(final.epoch!==chat.epoch||final.version!==chat.version)throw Error('Review was stopped or changed.');
      this.db.transaction(()=>{for(let i=0;i<staged.length;i++)latest(approved[i]!).job_ids=staged[i]!.commit().jobs.map(j=>j.id);group.state='released';chat.activity='idle';delete group.submission_error;this.save(chat);})();
    });}catch(error){const chat=this.get(id),group=chat.groups.find(g=>g.id===groupId);if(chat.epoch===epoch&&group?.state==='reviewing'){group.submission_error=(error as Error).message;chat.activity='idle';this.save(chat);}}
    // Keep the guard until stopped preparation drains; its finally must not clear a newer attempt.
    finally{this.preparing.delete(id);}
  }
  branch(jobIds:string[],fresh:boolean,draft=false){
    if(!jobIds.length||jobIds.length>16||new Set(jobIds).size!==jobIds.length)throw Error('Choose one request to branch.');
    const originals=jobIds.map(id=>{const job=this.jobs.get(id);if(!job)throw Error('Job no longer available.');return job;});
    const original=originals[0]!;
    if(originals.some(j=>j.submission_id!==original.submission_id))throw Error('Choose outputs from one request.');
    return this.db.transaction(()=>{
      const chat=original.source?.chat_id?this.get(original.source.chat_id):this.get(this.create(original.request.mode).id);
      if(this.tasks.has(chat.id)||this.preparing.has(chat.id)||openGroup(chat))throw Error('Resolve or stop current proposals in the original chat first.');
      const request={...original.request,count:originals.length,seed:fresh?'random':original.seed,resolved_seeds:fresh?undefined:originals.map(j=>j.seed)};
      chat.assets=[...new Set([...chat.assets,...(request.references??[]).map(r=>r.asset_id)])];
      const workflow=request.workflow as ChatWorkflow;
      chat.workflow=workflow;
      chat.groups.push({id:randomUUID(),after_message_id:chat.messages.at(-1)?.id??null,workflow,state:'reviewing',cards:[{id:randomUUID(),workflow,...(draft?{timeline_start:2}:{}),revisions:[{...this.revision(chat,request,1),source_job_id:original.id}]}]});
      chat.version++;this.save(chat);return this.view(chat.id);
    })();
  }
  repeat(id:string,cardId:string,number:number,fresh:boolean,failedOnly=false,jobId?:string){const chat=this.get(id);if(this.tasks.has(id)||this.preparing.has(id)||openGroup(chat))throw Error('Resolve or stop current proposals first.');const card=chat.groups.flatMap(g=>g.cards).find(c=>c.id===cardId),revision=card?.revisions.find(r=>r.number===number);if(!card||!revision)throw Error('Revision not found.');
    const originals=revision.job_ids.map(id=>this.jobs.get(id)).filter(j=>j&&(!failedOnly||j.state==='failed')&&(!jobId||j.id===jobId));
    if(jobId&&!originals.length)throw Error('Output not found in this request.');
    if(failedOnly&&!originals.length)throw Error('No definitively failed jobs to retry.');
    const requests=[{...revision.request,count:originals.length||revision.request.count,seed:fresh?'random':jobId?originals[0]!.seed:revision.request.seed,resolved_seeds:!fresh&&originals.length?originals.map(j=>j!.seed):undefined}];
    const group:ChatGroup={id:randomUUID(),after_message_id:chat.messages.at(-1)?.id??null,workflow:card.workflow,state:'reviewing',cards:requests.map(request=>({id:randomUUID(),workflow:card.workflow,revisions:[this.revision(chat,request,1)]}))};chat.groups.push(group);chat.version++;this.save(chat);return this.view(id);
  }
  restore(id:string,cardId:string,number:number,raw:unknown){
    const chat=this.get(id);if(this.tasks.has(id)||this.preparing.has(id)||openGroup(chat))throw Error('Resolve or stop current proposals first.');
    const source=chat.groups.flatMap(g=>g.cards).find(c=>c.id===cardId),prior=source?.revisions.find(r=>r.number===number);
    if(!source||!prior)throw Error('Revision not found.');
    const request=this.request(chat,source.workflow,raw,prior.request);
    const card:ChatCard={timeline_start:latest(source).number+1,id:randomUUID(),workflow:source.workflow,revisions:[...source.revisions,this.revision(chat,request,latest(source).number+1)]};
    chat.groups.push({id:randomUUID(),after_message_id:chat.messages.at(-1)?.id??null,workflow:source.workflow,state:'reviewing',cards:[card]});chat.version++;this.save(chat);return this.view(id);
  }
  async close(){for(const title of this.titles.values())title.agent.abort();await Promise.allSettled([...this.titles.values()].map(t=>t.task));for(const [id] of this.agents)this.stop(id);await Promise.allSettled([...this.tasks.values()]);}
}
