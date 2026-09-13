import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { Type, type ImageContent } from '@earendil-works/pi-ai';
import type { Agent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { ChatView, ChatMode, ChatWorkflow, ChatGroup, ChatCard, ChatRevision } from '../../shared/chat.js';
import type { StudioPaths } from '../storage.js';
import { imageRequest, type ImageRequest } from '../workflows.js';
import type { Jobs } from '../jobs.js';
import { createChatAgent, type ChatAccounting } from './provider.js';
import { chatCredential } from './credentials.js';
import { chatPromptSnapshot, chatWorkflows } from './prompts.js';
import { chatReferenceLabels, preserveChatLabels, validateChatReferences } from './references.js';
import { compactConversation, type ConversationSummary } from './context.js';

interface StoredChat extends ChatView {summary?:ConversationSummary;runs:Array<{id:string;prompt:ReturnType<typeof chatPromptSnapshot>;accounting:ChatAccounting[];messages:AgentMessage[];state:string;summary?:ConversationSummary}>}
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
  constructor(private db:Database.Database,private paths:StudioPaths,private jobs:Jobs,
    private transport?:typeof fetch) {
    for(const row of db.prepare('SELECT body_json FROM chats').all() as {body_json:string}[]) {
      const chat=JSON.parse(row.body_json) as StoredChat;
      if(chat.groups.some(g=>g.after_message_id===undefined)){for(const group of chat.groups)if(group.after_message_id===undefined)group.after_message_id=chat.messages.at(-1)?.id??null;this.save(chat);}
      if(chat.activity==='thinking'||chat.activity==='preparing'){
        chat.activity='idle';chat.error='Interrupted by server restart. Send a message to continue.';
        for(const run of chat.runs)if(run.state==='running')run.state='interrupted';
        this.save(chat);
      }
    }
  }
  private save(chat:StoredChat){chat.updated_at=now();this.db.prepare('INSERT INTO chats VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body_json=excluded.body_json').run(chat.id,chat.mode,JSON.stringify(chat));for(const listener of this.listeners.get(chat.id)??[])listener({partial:chat.partial??'',partial_reasoning:chat.partial_reasoning??'',activity:chat.activity,error:chat.error});}
  private get(id:string):StoredChat{const row=this.db.prepare('SELECT body_json FROM chats WHERE id=?').get(id) as {body_json:string}|undefined;if(!row)throw Error('Chat not found.');return JSON.parse(row.body_json);}
  private event(chat:StoredChat,text:string){chat.messages.push({id:randomUUID(),role:'event',text,assets:[],created_at:now()});}
  private jobIds(chat:ChatView){return [...new Set(chat.groups.flatMap(g=>g.cards.flatMap(c=>c.revisions.flatMap(r=>r.job_ids))))];}
  private activeJobs(chat:ChatView){return this.jobIds(chat).map(id=>this.jobs.get(id)).filter(job=>job&&!terminal.includes(job.state));}
  private generating(chat:ChatView){return this.activeJobs(chat).some(job=>job!.state!=='needs_attention'&&!this.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(job!.id));}
  private busy(chat:ChatView){return this.tasks.has(chat.id)||this.preparing.has(chat.id)||this.generating(chat);}
  private checkVersion(chat:ChatView,version:number){if(chat.version!==version)throw Error('Chat changed in another tab. Refresh and send again.');}
  view(id:string){const chat=this.get(id);const {runs,...view}=chat;
    view.activity=this.tasks.has(id)?'thinking':this.preparing.has(id)?'preparing':this.generating(chat)?'generating':'idle';
    for(const job of this.jobIds(chat).map(id=>this.jobs.get(id)))for(const asset of job?.outputs??[])if(!chat.assets.includes(asset))chat.assets.push(asset);
    return {...view,asset_manifest:this.contextAssets(chat),jobs:this.jobIds(chat).map(id=>this.jobs.get(id)).filter(Boolean),accounting:runs.flatMap(run=>run.accounting)};
  }
  list(mode:ChatMode){return (this.db.prepare('SELECT id FROM chats WHERE mode=?').all(mode) as {id:string}[]).map(row=>{const c=this.view(row.id);return {id:c.id,title:c.title,activity:c.activity,error:c.error??c.jobs.find(j=>j?.state==='failed')?.error,status:c.jobs.some(j=>j?.state==='failed')?'Failed':c.jobs.length&&c.jobs.every(j=>j&&terminal.includes(j.state))?'Completed':'',updated_at:c.updated_at};}).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));}
  create(mode:ChatMode){const id=randomUUID();this.save({id,mode,title:'New chat',workflow:null,version:0,epoch:0,reasoning:true,messages:[],groups:[],assets:[],runs:[],activity:'idle',error:null,created_at:now(),updated_at:now()});return this.view(id);}
  settings(id:string,version:number,values:{title?:string;workflow?:ChatWorkflow|null;reasoning?:boolean}){
    const chat=this.get(id);this.checkVersion(chat,version);if(this.busy(chat))throw Error('Stop this chat before changing its settings.');
    if(values.title!==undefined){if(!values.title.trim()||values.title.length>120)throw Error('Choose a title of 1–120 characters.');chat.title=values.title.trim();}
    if(values.workflow!==undefined){if(values.workflow!==null&&!Object.hasOwn(chatWorkflows,values.workflow))throw Error('Unknown workflow.');chat.workflow=values.workflow;}
    if(values.reasoning!==undefined)chat.reasoning=values.reasoning;
    chat.version++;this.save(chat);return this.view(id);
  }
  delete(id:string){const chat=this.get(id);if(this.busy(chat))throw Error('Stop generation before deleting this chat, then try again.');if(this.activeJobs(chat).length)throw Error('Remote cancellation or output saving is still pending. Reconnect the worker and try deletion after it settles.');this.db.prepare('DELETE FROM chats WHERE id=?').run(id);}
  stop(id:string){const chat=this.get(id);chat.epoch++;chat.version++;chat.activity='idle';
    for(const run of chat.runs)if(run.state==='running')run.state='stopped';
    for(const group of chat.groups)if(group.state!=='released')group.state='stopped';
    this.db.transaction(()=>{this.jobs.stopJobs(this.jobIds(chat));this.event(chat,'Stopped this chat. Completed media is preserved.');this.save(chat);})();
    this.agents.get(id)?.abort();return this.view(id);
  }
  private assertAssets(chat:StoredChat,ids:string[],allowExisting=true){
    if(ids.length>24||new Set(ids).size!==ids.length)throw Error('Choose up to 24 distinct assets.');
    for(const id of ids){
      const asset=this.jobs.media.get(id);if(!asset||(asset.metadata.state??'ready')!=='ready')throw Error('An attached asset is missing or still uploading.');
      const row=this.db.prepare(`SELECT COALESCE(json_extract(metadata_json,'$.mode'),(SELECT json_extract(snapshot_json,'$.request.mode') FROM jobs WHERE jobs.id=json_extract(assets.metadata_json,'$.job_id')),'sfw') mode FROM assets WHERE id=?`).get(id) as {mode:string};
      if(!(allowExisting&&chat.assets.includes(id))&&row.mode!==chat.mode)throw Error('Choose assets from this chat’s mode.');
    }
  }
  private contextAssets(chat:StoredChat){return chat.assets.map(id=>{const asset=this.jobs.media.get(id);const own=this.db.prepare('SELECT note FROM asset_notes WHERE id=?').get(id) as {note:string}|undefined;
    const inherited=this.db.prepare('SELECT n.note FROM sequence_frames f JOIN asset_notes n ON n.id=f.sequence_id WHERE f.asset_id=?').get(id) as {note:string}|undefined;
    return {id,name:asset?.name??'Missing media',kind:asset?.kind,metadata:asset?.metadata,note:own?.note||inherited?.note||''};});}
  private request(chat:StoredChat,workflow:ChatWorkflow,raw:unknown,previous?:ImageRequest):ImageRequest{
    const value=raw as Record<string,unknown>;
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Provide request settings.');
    if(chat.mode==='sfw'&&Object.hasOwn(value,'mode'))throw Error('Standard requests cannot supply a mode field.');
    let request=imageRequest({...value,workflow,mode:chat.mode==='sfw'?'sfw':value.mode??'nsfw',capabilities_revision:this.jobs.capabilities?.revision??'offline'});
    if(previous)request=preserveChatLabels(previous,request);
    validateChatReferences(request);
    for(const ref of request.references??[])if(!chat.assets.includes(ref.asset_id))throw Error('Reference must be provided in this conversation.');
    this.assertAssets(chat,(request.references??[]).map(r=>r.asset_id));return request;
  }
  private revision(chat:StoredChat,request:ImageRequest,number:number):ChatRevision{
    const notes=Object.fromEntries(this.contextAssets(chat).filter(a=>request.references?.some(r=>r.asset_id===a.id)).map(a=>[a.id,a.note]));
    return {number,request,notes,decision:'undecided',job_ids:[]};
  }
  private workflowTool(id:string,epoch:number,workflow:ChatWorkflow):AgentTool {
    const chat=this.get(id);
    const reference=Type.Object({id:Type.String(),asset_id:Type.String(),kind:Type.Union([Type.Literal('image'),Type.Literal('video'),Type.Literal('audio')]),role:Type.Union([Type.Literal('reference'),Type.Literal('first_frame'),Type.Literal('last_frame')]),framing:Type.Optional(Type.Union([Type.Literal('fit'),Type.Literal('fill')])),range:Type.Optional(Type.Object({start_seconds:Type.Number(),duration_seconds:Type.Number()})),include_audio:Type.Optional(Type.Boolean())},{additionalProperties:false});
    const fields={prompt:Type.String({minLength:1,maxLength:12000}),seed:Type.String({pattern:'^(random|0|[1-9][0-9]{0,15})$',description:'Use random unless the user specifies a numeric seed. Numeric seed plus count minus one must not exceed 9007199254740991.'}),count:Type.Integer({minimum:1,maximum:16}),output:Type.Object({aspect:Type.Union([Type.Literal('16:9'),Type.Literal('9:16')]),size:workflow==='text-to-image'?Type.Literal('1mp'):Type.Union([Type.Literal('720p'),Type.Literal('native')]),...(workflow==='text-to-image'?{}:{duration_seconds:Type.Integer({minimum:5,maximum:15}),format:Type.Optional(Type.Union([Type.Literal('video'),Type.Literal('images')]))})},{additionalProperties:false}),...(workflow!=='text-to-image'?{references:Type.Optional(Type.Array(reference,{maxItems:12})),quality:Type.Optional(Type.Union([Type.Literal('fast'),Type.Literal('high')])),audio:Type.Optional(Type.Object({output:Type.Union([Type.Literal('generated'),Type.Literal('silent')])}))}:{}),...(chat.mode==='nsfw'?{mode:Type.Optional(Type.Union([Type.Literal('sfw'),Type.Literal('nsfw')]))}:{})};
    const parameters=Type.Object({operations:Type.Array(Type.Union([
      Type.Object({operation:Type.Literal('create'),request:Type.Object(fields,{additionalProperties:false})},{additionalProperties:false}),
      Type.Object({operation:Type.Literal('revise'),request_id:Type.String(),expected_revision:Type.Integer(),changes:Type.Partial(Type.Object(fields,{additionalProperties:false})),replace_prompt:Type.Optional(Type.Object({old:Type.String({minLength:1}),new:Type.String()}))},{additionalProperties:false}),
    ]),{minItems:1,maxItems:16})},{additionalProperties:false});
    return {name:chatWorkflows[workflow].tool,label:chatWorkflows[workflow].label,description:'Create or revise review cards for this workflow. Never runs generation. Only a successful tool result creates a card. If rejected, correct the settings or explain the failure; never claim the card is ready. Revisions use exact expected_revision and changed fields. Prompt replacements must match exactly once.',parameters,
      execute:async(_call,params)=>{
        const current=this.get(id);if(current.epoch!==epoch||current.workflow!==workflow)throw Error('This workflow run is no longer active.');
        let group=openGroup(current);if(group&&group.workflow!==workflow)throw Error('Resolve or stop the outstanding review group first.');
        if(!group){group={id:randomUUID(),after_message_id:current.messages.at(-1)?.id??null,workflow,state:'assembling',cards:[]};current.groups.push(group);}
        const results=[];
        for(const op of (params as any).operations){
          if(op.operation==='create'){if(group.cards.length>=16)throw Error('A review group supports at most 16 cards.');const card={id:randomUUID(),workflow,revisions:[this.revision(current,this.request(current,workflow,op.request),1)]};group.cards.push(card);results.push({id:card.id,revision:1});}
          else {const card=group.cards.find(c=>c.id===op.request_id);if(!card||latest(card).number!==op.expected_revision)throw Error('Request revision changed. Use its current revision.');
            const raw:any={...latest(card).request,...op.changes};delete raw.workflow;delete raw.capabilities_revision;if(current.mode==='sfw')delete raw.mode;
            if(op.replace_prompt){const {old,new:replacement}=op.replace_prompt;if(raw.prompt.split(old).length!==2)throw Error('Prompt text must match exactly once.');raw.prompt=raw.prompt.replace(old,()=>replacement);}
            card.revisions.push(this.revision(current,this.request(current,workflow,raw,latest(card).request),latest(card).number+1));results.push({id:card.id,revision:latest(card).number});}
        }
        this.save(current);return {content:[{type:'text',text:JSON.stringify(results)}],details:results};
      }};
  }
  send(id:string,input:{version:number;text:string;assets:string[];card_id?:string;revision?:number}){
    const chat=this.get(id);this.checkVersion(chat,input.version);if(this.busy(chat))throw Error('This chat is busy. Stop it before sending another message.');
    if(!input.text.trim()||input.text.length>16000)throw Error('Write a message of 1–16000 characters.');
    const key=chatCredential(this.paths);if(!key)throw Error('Configure Chat with seed setup --chat-only.');
    for(const job of this.jobIds(chat).map(id=>this.jobs.get(id)))for(const asset of job?.outputs??[])if(!chat.assets.includes(asset))chat.assets.push(asset);
    this.assertAssets(chat,input.assets);
    for(const asset of input.assets)if(!chat.assets.includes(asset))chat.assets.push(asset);
    const group=openGroup(chat);
    let target:ChatCard|undefined;
    if(input.card_id){target=group?.cards.find(c=>c.id===input.card_id);if(!target||latest(target).number!==input.revision)throw Error('This card changed or already started. Refresh it.');if(target.workflow!==chat.workflow)throw Error('Switch to this card’s workflow before sending feedback.');}
    const selected=[...new Set([...input.assets,...(target?latest(target).request.references?.map(r=>r.asset_id)??[]:[])])];
    if(selected.filter(id=>this.jobs.media.get(id)?.kind==='image').length>9)throw Error('Choose at most nine images for this message.');
    const snapshot=chatPromptSnapshot(this.paths,chat.mode,chat.workflow);
    chat.messages.push({id:randomUUID(),role:'user',text:input.text,assets:input.assets,created_at:now()});
    if(chat.title==='New chat')chat.title=input.text.trim().slice(0,70);
    if(group)group.state='revising';chat.activity='thinking';chat.error=null;chat.partial='';chat.partial_reasoning='';chat.version++;
    const run={id:randomUUID(),prompt:snapshot,accounting:[] as ChatAccounting[],messages:[] as AgentMessage[],state:'running'};chat.runs.push(run);this.save(chat);
    const task=this.run(chat.id,chat.epoch,run.id,key,snapshot,selected,target?.id).finally(()=>{this.tasks.delete(id);this.agents.delete(id);});this.tasks.set(id,task);return this.view(id);
  }
  private async run(id:string,epoch:number,runId:string,key:string,snapshot:ReturnType<typeof chatPromptSnapshot>,selected:string[],target?:string){
    try{
      const chat=this.get(id),images:ImageContent[]=[];
      for(const assetId of selected){const asset=this.jobs.media.get(assetId);if(asset?.kind==='image'){
        const file=path.resolve(this.paths.data,asset.relative_path);if(!file.startsWith(path.resolve(this.paths.data)+path.sep))throw Error('Invalid asset path.');
        const bytes=await sharp(file).rotate().resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
        images.push({type:'image',mimeType:'image/jpeg',data:bytes.toString('base64')});
      }}
      if(this.get(id).epoch!==epoch)return;
      const manifest=this.contextAssets(chat),group=openGroup(chat);
      const account=(value:ChatAccounting)=>{const c=this.get(id),r=c.runs.find(r=>r.id===runId)!;const prior=value.id?r.accounting.findIndex(v=>v.id===value.id):-1;if(prior<0)r.accounting.push(value);else r.accounting[prior]=value;this.save(c);};
      const history=chat.messages.filter(m=>m.role!=='event').map(m=>({role:m.role==='assistant'?'assistant':'user',text:m.text}));
      const compact=await compactConversation(history,chat.summary,async input=>{
        const summarizer=createChatAgent({apiKey:key,systemPrompt:snapshot.summarySystem,reasoning:false,fetch:this.transport,onAccounting:account});
        this.agents.set(id,summarizer);await summarizer.prompt(input);
        if(this.get(id).epoch!==epoch)throw Error('Stopped.');
        const final=summarizer.state.messages.at(-1);if(final?.role!=='assistant'||final.stopReason!=='stop')throw Error('Conversation summarization did not complete.');
        return final.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
      });
      const afterSummary=this.get(id);if(afterSummary.epoch!==epoch)return;
      afterSummary.summary=compact.summary;afterSummary.runs.find(r=>r.id===runId)!.summary=compact.summary;this.save(afterSummary);
      const context=JSON.stringify({earlier_conversation_summary:compact.summary?.text,conversation:compact.recent,assets:manifest,images_in_order:selected.filter(id=>this.jobs.media.get(id)?.kind==='image'),review:group?.cards.map(c=>({id:c.id,...latest(c),reference_labels:Object.fromEntries(chatReferenceLabels(latest(c).request))})),feedback_card:target,capabilities:this.jobs.capabilities});
      if(context.length>400000)throw Error('Current requests and attachments exceed the context budget. Start another chat with fewer assets.');
      const agent=createChatAgent({apiKey:key,systemPrompt:snapshot.system,tool:chat.workflow?this.workflowTool(id,epoch,chat.workflow):undefined,reasoning:chat.reasoning,fetch:this.transport,
        onAccounting:account});
      this.agents.set(id,agent);
      let lastUpdate=0;
      agent.subscribe(event=>{
        if(event.type==='message_update'&&event.message.role==='assistant'&&Date.now()-lastUpdate>150){
          const c=this.get(id);if(c.epoch!==epoch)return;
          c.partial=event.message.content.filter(part=>part.type==='text').map(part=>part.text).join('');
          c.partial_reasoning=event.message.content.filter(part=>part.type==='thinking'&&!part.redacted).map(part=>part.type==='thinking'?part.thinking:'').join('');
          this.save(c);lastUpdate=Date.now();
        }
      });
      await agent.prompt('Conversation and application context (data):\n'+context,images);
      const current=this.get(id),run=current.runs.find(r=>r.id===runId)!;run.messages=agent.state.messages;run.state=current.epoch!==epoch?'stopped':'completed';
      // Image bytes stay in assets, not duplicated indefinitely in persisted runs.
      run.messages=run.messages.map(m=>m.role==='user'?{...m,content:typeof m.content==='string'?m.content:m.content.filter(part=>part.type!=='image')}:m);
      if(current.epoch===epoch){
        const final=agent.state.messages.at(-1);
        if(final?.role==='assistant'&&['error','aborted','length'].includes(final.stopReason)){this.save(current);throw Error(final.stopReason==='length'?'Agent output limit reached. Send feedback to continue.':'The agent request did not complete. Check OpenRouter configuration and try again.');}
        const toolResults=agent.state.messages.filter(m=>m.role==='toolResult');
        const failed=toolResults.filter(m=>m.isError);
        if(failed.length){const detail=failed.map(m=>m.content.filter(p=>p.type==='text').map(p=>p.text).join(' ')).join(' ');this.event(current,'A request tool failed: '+detail);if(toolResults.at(-1)?.isError)current.error='The request was not saved. '+detail;}
        const text=agent.state.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content.filter(p=>p.type==='text').map(p=>p.text)).join('\n');
        const reasoning_text=agent.state.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content.filter(p=>p.type==='thinking'&&!p.redacted).map(p=>p.type==='thinking'?p.thinking:'')).join('\n');
        if(text||reasoning_text)current.messages.push({id:randomUUID(),role:'assistant',text,...(reasoning_text?{reasoning_text}:{}),assets:[],created_at:now()});
        const pending=openGroup(current);if(pending){if(pending.cards.length)pending.state='reviewing';else current.groups=current.groups.filter(g=>g.id!==pending.id);}
        current.activity='idle';current.partial='';current.partial_reasoning='';
      }
      this.save(current);
    }catch(error){const current=this.get(id);current.runs.find(r=>r.id===runId)!.state='failed';if(current.epoch===epoch){current.error=(error as Error).message;current.activity='idle';}this.save(current);}
  }
  revise(id:string,cardId:string,number:number,raw:unknown){const chat=this.get(id);if(this.busy(chat))throw Error('Stop current work before editing.');const group=openGroup(chat),card=group?.cards.find(c=>c.id===cardId);if(!card||latest(card).number!==number)throw Error('Request changed or already started.');card.revisions.push(this.revision(chat,this.request(chat,card.workflow,raw,latest(card).request),number+1));chat.version++;this.save(chat);return this.view(id);}
  async decide(id:string,cardId:string,number:number,decision:'approved'|'denied'){
    const chat=this.get(id);if(this.busy(chat))throw Error('Wait for this chat to finish.');const group=openGroup(chat),card=group?.cards.find(c=>c.id===cardId);
    if(!group||group.state!=='reviewing'||!card||latest(card).number!==number)throw Error('Review the current completed proposal.');
    if(decision==='approved'&&!latest(card).approved_snapshot){
      const cap=await this.jobs.inspectCapabilities();const current=this.get(id);
      if(current.version!==chat.version||current.epoch!==chat.epoch||this.busy(current))throw Error('Chat changed during approval. Review again.');
      latest(card).request.capabilities_revision=cap.revision;
      latest(card).notes=this.revision(chat,latest(card).request,number).notes;
      latest(card).approved_snapshot=true;
    }
    latest(card).decision=decision;chat.version++;this.save(chat);
    if(group.cards.every(c=>latest(c).decision!=='undecided'))await this.release(id,group.id);
    return this.view(id);
  }
  private async release(id:string,groupId:string){
    this.preparing.add(id);
    try{await this.jobs.serialize(async()=>{
      const chat=this.get(id),group=chat.groups.find(g=>g.id===groupId)!;if(group.state!=='reviewing')return;
      if(this.activeJobs(chat).length)throw Error('Wait for remote cancellation and output saving before submitting another generation.');
      const approved=group.cards.filter(c=>latest(c).decision==='approved');
      const staged:Array<Awaited<ReturnType<Jobs['prepareSubmission']>>>=[];
      for(const card of approved){this.assertAssets(chat,(latest(card).request.references??[]).map(r=>r.asset_id));staged.push(await this.jobs.prepareSubmission(latest(card).request,`${group.id}-${card.id}-${latest(card).number}`));}
      const current=this.get(id);if(current.epoch!==chat.epoch||current.version!==chat.version)throw Error('Review changed during preparation. No jobs were submitted.');
      if(approved.length){const cap=await this.jobs.inspectCapabilities();if(approved.some(c=>latest(c).request.capabilities_revision!==cap.revision))throw Error('Worker changed. Review requests again.');}
      // Recheck after the final asynchronous capability request.
      const final=this.get(id);if(final.epoch!==chat.epoch||final.version!==chat.version)throw Error('Review was stopped or changed.');
      this.db.transaction(()=>{for(let i=0;i<staged.length;i++)latest(approved[i]!).job_ids=staged[i]!.commit().jobs.map(j=>j.id);group.state='released';this.save(chat);if(approved.length)this.jobs.pause(false);})();
    });}catch(error){const chat=this.get(id);chat.error=(error as Error).message;this.save(chat);}finally{this.preparing.delete(id);}
  }
  repeat(id:string,cardId:string,number:number,fresh:boolean,failedOnly=false){const chat=this.get(id);if(this.busy(chat)||openGroup(chat))throw Error('Resolve or stop current proposals first.');const card=chat.groups.flatMap(g=>g.cards).find(c=>c.id===cardId),revision=card?.revisions.find(r=>r.number===number);if(!card||!revision)throw Error('Revision not found.');
    const originals=revision.job_ids.map(id=>this.jobs.get(id)).filter(j=>j&&(!failedOnly||j.state==='failed'));
    if(failedOnly&&!originals.length)throw Error('No definitively failed jobs to retry.');
    const requests=originals.length?originals.map(j=>({...revision.request,count:1,seed:fresh?'random':j!.seed})):[{...revision.request,seed:fresh?'random':revision.request.seed}];
    const group:ChatGroup={id:randomUUID(),after_message_id:chat.messages.at(-1)?.id??null,workflow:card.workflow,state:'reviewing',cards:requests.map(request=>({id:randomUUID(),workflow:card.workflow,revisions:[this.revision(chat,request,1)]}))};chat.groups.push(group);chat.version++;this.save(chat);return this.view(id);
  }
  restore(id:string,cardId:string,number:number,raw:unknown){
    const chat=this.get(id);if(this.busy(chat)||openGroup(chat))throw Error('Resolve or stop current proposals first.');
    const source=chat.groups.flatMap(g=>g.cards).find(c=>c.id===cardId),prior=source?.revisions.find(r=>r.number===number);
    if(!source||!prior)throw Error('Revision not found.');
    const request=this.request(chat,source.workflow,raw,prior.request);
    const card:ChatCard={id:randomUUID(),workflow:source.workflow,revisions:[...source.revisions,this.revision(chat,request,latest(source).number+1)]};
    chat.groups.push({id:randomUUID(),after_message_id:chat.messages.at(-1)?.id??null,workflow:source.workflow,state:'reviewing',cards:[card]});chat.version++;this.save(chat);return this.view(id);
  }
  async close(){for(const [id] of this.agents)this.stop(id);await Promise.allSettled([...this.tasks.values()]);}
}
