import {TurnTranscript} from './turn-transcript.js';
import {MentionText,type InputMention} from './input-mentions.js';
import {inputLabels} from '../shared/reference-labels.js';
import {RequestDetails} from './request-details.js';
import {Review} from './review-request.js';
import {SentRequest} from './sent-request.js';
import {InlineComposer,CommandText,type ComposerHandle} from './inline-composer.js';
import {RequestCardHeader} from './request-card-header.js';
import {JobButton,JobIcon,JobOutputs,JobDetails,JobMedia,SeedMenu,branchJobs,jobName,jobApi} from './job-ui.js';
import {jobActive,jobState,type JobRecord} from '../shared/jobs.js';
import {uploadReferences} from './uploads.js';
import {ChatMarkdown} from './chat-markdown.js';
import {AssetThumbnail} from './asset-thumbnail.js';
import {AttachmentMenu} from './attachment-menu.js';
import {EditableItem,RevisionControls} from './revision-controls.js';
import {ChatSidebarRow} from './chat-sidebar-row.js';
import {workflowLabels} from './workflow-labels.js';
import {toast} from 'react-hot-toast/headless';
import {Modal} from './modal.js';
import {createPortal,flushSync} from 'react-dom';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ChatView,ChatWorkflow,ChatCard,ChatRevision,ChatMessage,ChatGroup} from '../shared/chat.js';
import type {ImageRequest} from '../server/workflows.js';
import {useSpicy} from './spicy-mode.js';
import {GalleryPicker} from './gallery-picker.js';
import {useReferences,NoteModal} from './references.js';
import {MediaPreview,type PreviewMedia} from './media-preview.js';
import {AssetNote} from './asset-note.js';
import {FrameViewer} from './frame-viewer.js';
import {ConfirmDialog} from './confirm-dialog.js';

const workflows:Record<ChatWorkflow,{label:string;command:string}>={
  'text-to-image':{label:workflowLabels['text-to-image'],command:'/text-to-image'},
  'text-to-video':{label:workflowLabels['text-to-video'],command:'/text-to-video'},
  'reference-to-video':{label:workflowLabels['reference-to-video'],command:'/reference-to-video'},
};
function remembered(key:string){try{return sessionStorage.getItem('seed.chat.'+key)??'';}catch{return '';}}
function remember(key:string,value:string){try{sessionStorage.setItem('seed.chat.'+key,value);}catch{/* Server history remains durable. */}}
type AssetContext={id:string;name:string;kind:'image'|'video'|'audio';note:string;metadata?:{duration?:number}};
type View=ChatView&{asset_manifest?:AssetContext[];jobs:JobRecord[];accounting:Array<{cost:number|null}>};
async function api(url:string,method='GET',body?:unknown){const response=await fetch('/api/v1/'+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const result=await response.json();if(!response.ok){const message=result.error?.message;throw Error(message==='fetch failed'?'Cannot reach the GPU worker. Connect or reconnect the GPU, then try Generate again.':message||'Request failed. Please try again.');}return result;}

export function Chat({sidebarTarget,onChooseChat}:{sidebarTarget:HTMLElement|null;onChooseChat:()=>void}){
  const {spicy}=useSpicy(),mode=spicy?'nsfw':'sfw';
  const [list,setList]=useState<Array<{id:string;title:string;activity:string;error:string|null;status?:string;last_reply_id?:string}>>([]);
  const [id,setId]=useState<string|null>(null),[savedChat,setChat]=useState<View|null>(null);
  const chat:View=savedChat??{id:'',title:'New chat',mode,workflow:null,version:0,epoch:0,reasoning:true,messages:[],groups:[],assets:[],activity:'idle',error:null,jobs:[],accounting:[],created_at:'',updated_at:''};
  const welcome=(!id||savedChat?.id===id)&&!chat.messages.length&&!chat.groups.length&&!chat.partial&&chat.activity==='idle';
  const [text,setText]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[configured,setConfigured]=useState(true);
  const [sending,setSending]=useState(false);
  const [reviewError,setReviewError]=useState('');
  const [stopping,setStopping]=useState<string|null>(null);
  function requestStop(){if(chat.jobs.some(jobActive)||chat.activity==='generating'||chat.activity==='preparing')setStopping(chat.id);else void act(()=>api('chats/'+chat.id+'/stop','POST',{}));}
  const [connection,setConnection]=useState<'online'|'reconnecting'|'offline'>('online'),[sendFailed,setSendFailed]=useState(false);
  const connectionFailures=useRef(0);
  async function reconnect(){setConnection('reconnecting');try{await api('chat-config');connectionFailures.current=0;setConnection('online');}catch{setConnection('offline');}}
  const [gallery,setGallery]=useState(false),[review,setReview]=useState<{card:ChatCard;revision:ChatRevision}|null>(null);
  useEffect(()=>setReviewError(''),[review?.card.id]);
  const [preview,setPreview]=useState<(PreviewMedia&{id:string;referenceLabel?:string;gallery?:string[]})|null>(null),[sequence,setSequence]=useState<string|null>(null);
  const [deleting,setDeleting]=useState<string|null>(null),[rename,setRename]=useState<{id:string;title:string}|null>(null);
  const refs=useReferences(true),file=useRef<HTMLInputElement>(null);
  const [readReplies,setReadReplies]=useState<Record<string,string>>(()=>{try{return JSON.parse(localStorage.getItem('seed.chat.read-replies')||'{}');}catch{return {};}});
  const [visible,setVisible]=useState(document.visibilityState==='visible');
  useEffect(()=>{const update=()=>setVisible(document.visibilityState==='visible');document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
  useEffect(()=>{setReadReplies(previous=>{const next={...previous};for(const item of list){if(!(item.id in next))next[item.id]=item.last_reply_id??'';}if(savedChat&&visible)next[savedChat.id]=savedChat.messages.filter(m=>m.role==='assistant').at(-1)?.id??'';if(JSON.stringify(next)===JSON.stringify(previous))return previous;try{localStorage.setItem('seed.chat.read-replies',JSON.stringify(next));}catch{}return next;});},[list,savedChat,visible]);
  const currentId=useRef(id);currentId.current=id;
  const generation=useRef(0),composer=useRef<ComposerHandle>(null);
  const [jobDetail,setJobDetail]=useState<string|null>(null),[jobPreview,setJobPreview]=useState<JobRecord|null>(null);
  const [cardVersions,setCardVersions]=useState<Record<string,number>>({});
  const knownRevisions=useRef<Record<string,number>>({});
  useEffect(()=>{const current=Object.fromEntries((savedChat?.groups??[]).flatMap(g=>g.cards.map(c=>[c.id,c.revisions.at(-1)!.number])));const prior=knownRevisions.current;setCardVersions(previous=>{const next={...previous};let changed=false;for(const key of Object.keys(next))if(current[key]!==prior[key]){delete next[key];changed=true;}return changed?next:previous;});knownRevisions.current=current;},[savedChat?.groups]);

  const [selected,setSelected]=useState<string[]>([]);
  const [branchDraft,setBranchDraft]=useState<{jobs:JobRecord[];fresh:boolean;submitted?:string}|null>(null),[branchDetails,setBranchDetails]=useState(false);
  const [feedbackDraft,setFeedbackDraft]=useState<{card:ChatCard;revision:ChatRevision}|null>(null);
  function clearBranch(){setFeedbackDraft(null);setBranchDraft(null);setBranchDetails(false);window.history.replaceState(null,'',chat.id?'/chat?chat='+chat.id:'/chat');}

  const referenceRequest=feedbackDraft?.revision.request??branchDraft?.jobs[0]?.request;
  const currentReferences=referenceRequest?.references??[];
  const currentLabels=inputLabels(currentReferences);
  const mentionAssets=[...(chat.asset_manifest??[]).map(a=>({...a,url:'/api/v1/assets/'+a.id+'/content',local:undefined})),...refs.groups.video.map(r=>({id:r.id,name:r.name,kind:r.kind,url:r.url,local:r})),...currentReferences.map(r=>({id:r.asset_id,name:currentLabels.get(r.asset_id)?.slice(1,-1)??'Request input',kind:r.kind,url:'/api/v1/assets/'+r.asset_id+'/content',local:undefined}))].filter((a,i,all)=>all.findIndex(b=>b.id===a.id)===i);
  const mentionCounts={image:0,video:0,audio:0};
  for(const label of currentLabels.values()){const match=label.match(/<(Picture|Video|Audio) (\d+)>/)!;const kind=match[1]==='Picture'?'image':match[1]==='Video'?'video':'audio';mentionCounts[kind]=Math.max(mentionCounts[kind],Number(match[2]));}
  const inputMentions:InputMention[]=mentionAssets.map(a=>{const label=currentLabels.get(a.id)?.slice(1,-1)??`${a.kind==='image'?'Picture':a.kind==='video'?'Video':'Audio'} ${++mentionCounts[a.kind]}`;return {id:a.id,token:`[${label}](asset:${a.id})`,label,name:a.name,kind:a.kind,url:a.url,earlier:!a.local&&!selected.includes(a.id)&&!currentReferences.some(r=>r.asset_id===a.id),onChoose:()=>{if(!a.local)setSelected(current=>current.includes(a.id)?current:[...current,a.id]);},onPreview:()=>a.local?setPreview({...a.local,id:a.id}):void show(a.id)};});
  for(const [slot,token] of currentLabels){if(!slot.endsWith(':audio'))continue;const asset=slot.slice(0,-6),base=inputMentions.find(m=>m.id===asset);if(base)inputMentions.push({...base,id:slot,token:`[${token.slice(1,-1)}](asset:${asset})`,label:token.slice(1,-1),name:base.name+' · soundtrack'});}
  // Existing mentions retain their display label when the picker order changes.
  for(const match of text.matchAll(/\[([^\]]+)\]\(asset:([^)]+)\)/g)){const item=inputMentions.find(m=>m.id===match[2]);if(item&&!inputMentions.some(m=>m.token===match[0]))inputMentions.push({...item,id:item.id+':existing:'+match[1],token:match[0],label:match[1]!,hidden:true});}
  inputMentions.sort((a,b)=>Number(Boolean(a.earlier))-Number(Boolean(b.earlier)));
  const missingMention=text.includes('[removed reference]')||/<(?:Picture|Video|Audio) [1-9][0-9]*>/.test(text)||[...text.matchAll(/\[[^\]]+\]\(asset:([^)]+)\)/g)].some(m=>!mentionAssets.some(a=>a.id===m[1]));
  function removeMentionAsset(asset:string){setText(current=>current.replace(/\[[^\]]+\]\(asset:([^)]+)\)/g,(token,id)=>id===asset?'[removed reference]':token));}
  const drafts=useRef<Record<string,string>>({});
  const [caret,setCaret]=useState(0),[commandIndex,setCommandIndex]=useState(0),[dismissed,setDismissed]=useState(false);
  const commandMatch=text.slice(0,caret).match(/(?:^|\s)(\/[^\s/]*)$/);
  const commandToken=commandMatch?.[1];
  const commandResults=Object.entries({...workflows,reasoning:{label:`Reasoning · ${chat?.reasoning?'on':'off'}`,command:'/reasoning'}}).filter(([,w])=>!commandToken||w.command.includes(commandToken.toLowerCase())||w.label.toLowerCase().includes(commandToken.slice(1).toLowerCase()));
  const commandOpen=Boolean(commandToken)&&!dismissed;

  const history=useRef<HTMLDivElement>(null),historyContent=useRef<HTMLDivElement>(null),follow=useRef(true),lastScrollTop=useRef(0),scrollSize=useRef(''),scrollFrame=useRef<number|null>(null),touchY=useRef<number|null>(null);
  useLayoutEffect(()=>{follow.current=true;lastScrollTop.current=0;},[id]);
  const historyVersion=chat?JSON.stringify([chat.messages.at(-1)?.id,chat.partial,chat.partial_reasoning,chat.messages.at(-1)?.transcript,chat.groups.map(g=>[g.state,g.cards.map(c=>c.revisions.at(-1)?.number)]),chat.jobs.map(j=>[j.state,j.outputs.length])]):'';
  function pauseFollowing(){follow.current=false;if(scrollFrame.current!==null){cancelAnimationFrame(scrollFrame.current);scrollFrame.current=null;}}
  function scrollFollowing(){if(scrollFrame.current!==null)return;scrollFrame.current=requestAnimationFrame(()=>{scrollFrame.current=null;const element=history.current;if(follow.current&&element){element.scrollTop=element.scrollHeight;lastScrollTop.current=element.scrollTop;scrollSize.current=[element.scrollHeight,element.clientHeight,element.clientWidth].join();}});}
  useLayoutEffect(scrollFollowing,[historyVersion,id]);
  useLayoutEffect(()=>{const observer=new ResizeObserver(scrollFollowing);if(history.current)observer.observe(history.current);if(historyContent.current)observer.observe(historyContent.current);return()=>{observer.disconnect();if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);scrollFrame.current=null;};},[]);
  const busy=sending||saving||Boolean(chat&&chat.activity!=='idle');
  useEffect(()=>{let disposed=false;const epoch=++generation.current;
    const params=new URLSearchParams(location.search),fromJob=params.get('fromJob');const restored=fromJob?null:params.get('chat')||remembered('selected.'+mode)||null;currentId.current=restored;
    setList([]);setId(restored);setChat(null);setText(restored?remembered('draft.'+restored):'');setReview(null);setPreview(null);setSequence(null);setGallery(false);setSelected([]);setRename(null);setDeleting(null);
    setFeedbackDraft(null);setBranchDraft(null);
    if(fromJob)void (async()=>{try{
      const ids=(params.get('outputs')||fromJob).split(',');const jobs=await Promise.all(ids.map(id=>api('jobs/'+encodeURIComponent(id)))) as JobRecord[];
      if(disposed)return;const first=jobs[0]!;if(!ids.includes(fromJob)||jobs.some(j=>j.submission_id!==first.submission_id))throw Error('Choose outputs from one request.');
      if(first.request.mode!==mode)throw Error('Switch to the original request’s mode to use this draft.');
      const source=first.source?.chat_id;if(source){const value=await api('chats/'+source);if(disposed)return;currentId.current=source;setId(source);setChat(value);setText(remembered('draft.'+source));}else{currentId.current=null;setId(null);setChat(null);}
      setBranchDraft({jobs,fresh:params.get('seed')==='new'});
    }catch(e){if(!disposed)setError((e as Error).message);}})();
    void api('chat-config').then(v=>{if(!disposed)setConfigured(v.configured);}).catch(()=>{});
    async function refresh(){try{const value=await api('chats?mode='+mode);if(!disposed){setList(value.items);connectionFailures.current=0;setConnection('online');}const active=currentId.current;if(active){const value=await api('chats/'+active);if(!disposed&&epoch===generation.current&&active===currentId.current&&value.mode===mode)setChat(value);}}catch(e){if(!disposed&&(e as Error).message==='Chat not found.'){remember('selected.'+mode,'');currentId.current=null;setId(null);setChat(null);setText('');window.history.replaceState(null,'','/chat');return;}if(!disposed){connectionFailures.current++;setConnection(connectionFailures.current>=5?'offline':'reconnecting');}}}
    void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{disposed=true;clearInterval(timer);};
  },[mode]);
  useEffect(()=>{if(!id)return;const stream=new EventSource('/api/v1/chats/'+id+'/events');stream.onopen=()=>{void api('chats/'+id).then(value=>{if(currentId.current===id)setChat(value);}).catch(()=>{});};stream.onmessage=event=>{const value=JSON.parse(event.data);setChat(current=>current?.id===id?{...current,...value,messages:value.stream_message?(current.messages.some(m=>m.id===value.stream_message.id)?current.messages.map(m=>m.id===value.stream_message.id?value.stream_message:m):[...current.messages,value.stream_message]):current.messages,partial:value.activity==='idle'?current.partial:value.partial,partial_reasoning:value.activity==='idle'?current.partial_reasoning:value.partial_reasoning}:current);if(value.activity==='idle')void api('chats/'+id).then(value=>{if(currentId.current===id)setChat(value);});};return()=>stream.close();},[id]);
  useEffect(()=>{if(id)remember('draft.'+id,text);},[id,text]);
  async function act(fn:()=>Promise<any>,scope:'chat'|'review'='chat'){const report=scope==='review'?setReviewError:setError;setSaving(true);report('');const epoch=generation.current;try{const value=await fn();if(epoch===generation.current&&value?.id===currentId.current)setChat(value);return value;}catch(e){if(epoch===generation.current)report((e as Error).message);return null;}finally{setSaving(false);}}
  async function open(next:string){clearBranch();window.history.replaceState(null,'','/chat?chat='+next);onChooseChat();if(id)drafts.current[id]=text;remember('selected.'+mode,next);currentId.current=next;setId(next);setChat(null);setText(drafts.current[next]??remembered('draft.'+next));setSelected([]);refs.reset('video');setReview(null);const value=await act(()=>api('chats/'+next));if(value&&currentId.current===next)setChat(value);}
  async function create(){clearBranch();window.history.replaceState(null,'','/chat');onChooseChat();if(id)drafts.current[id]=text;remember('selected.'+mode,'');currentId.current=null;setId(null);setChat(null);setText('');setSelected([]);refs.reset('video');setReview(null);setError('');setDismissed(true);composer.current?.focus();}
  async function ensureChat(){if(chat.id)return chat;const value=await act(()=>api('chats','POST',{mode}));if(value){remember('selected.'+mode,value.id);setId(value.id);currentId.current=value.id;setChat(value);}return value;}
  async function settings(values:object){if(!chat.id){const value={...chat,...values};setChat(value);return value;}return act(()=>api('chats/'+chat.id,'PATCH',{version:chat.version,...values}));}
  async function chooseWorkflow(workflow:ChatWorkflow|'reasoning'){
    if(busy)return;const original=text,position=caret,token=commandToken;setDismissed(true);
    const changed=await settings(workflow==='reasoning'?{reasoning:!chat?.reasoning}:{workflow});if(!changed){setDismissed(false);return;}
    if(workflow==='reasoning')toast.success(`Reasoning ${changed.reasoning?'enabled':'disabled'}`);
    const replacement=workflow==='reasoning'?'/reasoning ':workflows[workflow].command+' ';
    const next=token?original.slice(0,position-token.length)+replacement+original.slice(position):original;
    if(composer.current?.value===original){
      flushSync(()=>setText(next));
      const at=token?position-token.length+replacement.length:position;composer.current.focus();composer.current.setSelectionRange(at,at);setCaret(at);
    }
  }
  async function send(message=text,card?:ChatCard,revision?:number){if(!chat||busy||connection!=='online'||missingMention)return;
    if(!card&&commandOpen&&message===text){if(commandResults.length)await chooseWorkflow(commandResults[commandIndex%commandResults.length]![0] as ChatWorkflow|'reasoning');else setError('No matching command. Edit the command or press Escape to dismiss it.');return;}
    if(!card&&feedbackDraft){card=feedbackDraft.card;revision=feedbackDraft.revision.number;}
    follow.current=true;
    const command=message.trim().split(/\s+/)[0],entry=Object.entries(workflows).find(([,w])=>message.split(/\s+/).includes(w.command));
    let workflow=chat.workflow,reasoning=chat.reasoning;
    
    if(entry)workflow=entry[0] as ChatWorkflow;
    if(branchDraft)workflow=branchDraft.jobs[0]!.request.workflow;
    if(card)workflow=card.workflow;
    if(!message.trim()){await settings({workflow,reasoning});setText('');return;}
    setSendFailed(false);setSending(true);try{
    const uploaded=await uploadReferences(refs.groups.video,mode,()=>{});
    for(const item of uploaded){message=message.replaceAll('(asset:'+item.id+')','(asset:'+item.asset_id+')');}
    for(const item of uploaded){const ref=refs.groups.video.find(r=>r.id===item.id)!;refs.update('video',ref.id,{asset_id:item.asset_id});if(ref.note?.trim()){const currentNote=await api('notes/'+item.asset_id);if(currentNote.note!==ref.note.trim())await api('notes/'+item.asset_id,'PUT',{note:ref.note.trim(),revision:currentNote.revision});}}
    let current:View|null;
    if(branchDraft){
      current=branchDraft.submitted?await api('chats/'+branchDraft.submitted):await api('jobs/'+branchDraft.jobs[0]!.id+'/branch-chat','POST',{fresh:branchDraft.fresh,job_ids:branchDraft.jobs.map(j=>j.id),draft:true});
      if(!current)return;setBranchDraft({...branchDraft,submitted:current.id});setId(current.id);currentId.current=current.id;setChat(current);remember('selected.'+mode,current.id);window.history.replaceState(null,'','/chat?chat='+current.id);
      card=current.groups.find(g=>!['released','stopped'].includes(g.state))?.cards[0];revision=card?.revisions.at(-1)?.number;
    }else current=await ensureChat();if(!current)return;
    if(current.workflow!==workflow||current.reasoning!==reasoning){const changed=await act(()=>api('chats/'+current!.id,'PATCH',{version:current!.version,workflow,reasoning}));if(!changed)return;current=changed;}
    const value=await act(()=>api('chats/'+current!.id+'/messages','POST',{version:current!.version,text:message,assets:[...new Set([...selected,...uploaded.map(r=>r.asset_id),...[...message.matchAll(/\[[^\]]+\]\(asset:([^)]+)\)/g)].map(m=>m[1]!)])],...(card?{card_id:card.id,revision}: {}),...((branchDraft||feedbackDraft)?{attach_request:true}:{})}));
    if(value){setFeedbackDraft(null);setBranchDraft(null);setBranchDetails(false);setText('');setSelected([]);refs.reset('video');setReview(null);composer.current?.focus();}else setSendFailed(true);
    }catch(e){setSendFailed(true);setError((e as Error).message);void reconnect();}finally{setSending(false);}
  }
  async function show(assetId:string,referenceLabel?:string,gallery?:string[]){const value=await act(()=>api('assets/'+assetId));if(value)setPreview({id:assetId,gallery:gallery??currentReferences.map(r=>r.asset_id),referenceLabel:referenceLabel??inputMentions.find(m=>m.id===assetId)?.label,name:value.name||'Conversation asset',url:'/api/v1/assets/'+assetId+'/content',kind:value.kind,type:value.mime_type??'',width:value.width,height:value.height,duration:value.duration,size:value.size,has_audio:value.has_audio});}
  const target=review&&chat?.groups.flatMap(g=>g.cards).find(c=>c.id===review.card.id);
  const openGroup=chat?.groups.find(g=>!['released','stopped'].includes(g.state));
  const timeline:Array<{message:ChatMessage;group?:never}|{group:ChatGroup & {timeline_revision?:number};message?:never}>=[];
  const anchored=new Set<string>();
  const entries=chat.groups.flatMap(group=>group.cards.flatMap(card=>card.revisions.filter(r=>r.number>=(card.timeline_start??1)).map(revision=>({group:{...group,id:group.id+'-'+card.id+'-'+revision.number,cards:[card],timeline_revision:revision.number},after:revision.after_message_id===undefined?group.after_message_id:revision.after_message_id}))));
  function appendGroups(after:string|null){for(const entry of entries)if(entry.after===after){timeline.push({group:entry.group});anchored.add(entry.group.id);}}
  appendGroups(null);for(const message of chat.messages){if(!(message.role==='event'&&(message.text.startsWith('Workflow: ')||message.text==='Workflow turned off.')))timeline.push({message});appendGroups(message.id);}for(const entry of entries)if(!anchored.has(entry.group.id))timeline.push({group:entry.group});
  return <section className="chat-layout">
    {sidebarTarget&&createPortal(<aside className="chat-sidebar"><div className="sidebar-chats-heading"><span>Chats</span><button aria-label="New chat" title="New chat" onClick={()=>void create()} disabled={saving}>+</button></div>{list.map(item=><ChatSidebarRow key={item.id} title={item.title} selected={item.id===id} working={item.activity!=='idle'} unread={Boolean(item.last_reply_id&&readReplies[item.id]!==undefined&&readReplies[item.id]!==item.last_reply_id)} status={item.error?'Needs attention':undefined} onOpen={()=>void open(item.id)} onRename={()=>{onChooseChat();setRename({id:item.id,title:item.title});}} onDelete={()=>{onChooseChat();setDeleting(item.id);}}/>)}</aside>,sidebarTarget)}
    <div className={'chat-main'+(welcome?' chat-welcome':'')}>
      {!configured&&<p>Set up Chat with <code>seed setup --chat-only</code>.</p>}
        <>
        <div ref={history} className="chat-history" aria-live="polite" tabIndex={0}
 onWheel={event=>{if(event.deltaY<0)pauseFollowing();}}
 onTouchStart={event=>{touchY.current=event.touches[0]?.clientY??null;}}
 onTouchMove={event=>{const y=event.touches[0]?.clientY;if(y!==undefined&&touchY.current!==null&&y>touchY.current)pauseFollowing();touchY.current=y??null;}}
 onTouchEnd={()=>{touchY.current=null;}}
 onKeyDown={event=>{const target=event.target as HTMLElement;if(target.closest('input,textarea,[contenteditable="true"]'))return;if(['ArrowUp','PageUp','Home'].includes(event.key)||(event.key===' '&&event.shiftKey))pauseFollowing();}}
 onScroll={event=>{if(event.target!==event.currentTarget)return;const element=history.current;if(!element)return;const previous=lastScrollTop.current;const near=element.scrollHeight-element.scrollTop-element.clientHeight<=5;if(element.scrollTop<previous-1&&scrollSize.current===[element.scrollHeight,element.clientHeight,element.clientWidth].join())pauseFollowing();else if(near&&element.scrollTop>previous)follow.current=true;lastScrollTop.current=element.scrollTop;}}><div ref={historyContent} className="chat-history-content">
          {timeline.map(({message,group})=>message?<article className={'chat-message '+message.role} key={message.id}>{message.role!=='assistant'&&<small>{message.role==='user'?'You':'Workflow'}</small>}{message.transcript?<TurnTranscript turn={message.transcript}/>:message.reasoning_text&&<Reasoning text={message.reasoning_text}/>}{message.request_attachment&&<SentRequest attachment={message.request_attachment} onOpen={asset=>void show(asset,undefined,message.request_attachment!.request.references?.map(r=>r.asset_id))}/>}{message.role==='assistant'?<ChatMarkdown text={message.text} streaming={message.transcript?.state==='running'}/>:<p>{message.role==='user'?<MentionedMessage text={message.text} onPreview={(asset,label)=>void show(asset,label,message.assets)}/>:message.text}</p>} {message.assets.length>0&&<div className="history-attachments">{message.assets.map(asset=><AssetThumbnail key={asset} id={asset} onOpen={()=>void show(asset,undefined,message.assets)}/>)}</div>}</article>:<section className="chat-group" key={group.id}>{group.cards.map(card=>{const historical=group.timeline_revision!==card.revisions.at(-1)!.number;const revision=card.revisions.find(r=>r.number===(historical?group.timeline_revision:cardVersions[card.id]))??card.revisions.at(-1)!;const replaced=revision.number!==card.revisions.at(-1)!.number&&!revision.job_ids.length;const cardJobs=revision.job_ids.map(id=>chat.jobs.find(j=>j.id===id)).filter((j):j is JobRecord=>Boolean(j));const active=cardJobs.some(jobActive),pending=!replaced&&revision.decision==='undecided'&&group.state==='reviewing';return <div className="job-chat-wrap" id={historical?undefined:`request-${card.id}`} key={card.id}><EditableItem className="job-request-card" label="Edit request" onEdit={()=>setReview({card,revision})}>
 <div className="job-request-heading"><RequestCardHeader request={revision.request} onPreview={asset=>void show(asset,undefined,revision.request.references?.map(r=>r.asset_id))} label={cardJobs.length?'View job details':pending?'Review / history':'View request'} onOpen={()=>cardJobs.length?setJobDetail(cardJobs[0]!.id):setReview({card,revision})}/><div className="job-controls">
 {replaced?<span className="job-pending-label">Replaced</span>:revision.decision==='denied'?<span className="job-denied"><JobIcon name="close"/>Denied</span>:pending?<><JobButton icon="close" label="Deny" danger disabled={busy} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/decision`,'POST',{revision:revision.number,decision:'denied'}))}/><button type="button" className="job-review-button" disabled={busy} onClick={()=>{setReview({card,revision});void act(()=>api(`chats/${chat.id}/cards/${card.id}/decision`,'POST',{revision:revision.number,decision:'approved'}),'review').then(result=>{if(result)setReview(null);});}}><JobIcon name="review"/>Approve</button></>:active?<>{!cardJobs.every(j=>jobState(j)==='cancelling')&&<><JobButton icon="edit" label="Edit" onClick={()=>setReview({card,revision})}/><JobButton icon="close" label="Cancel" danger disabled={saving} onClick={()=>void act(async()=>{await Promise.all(cardJobs.filter(jobActive).map(j=>jobApi('jobs/'+j.id+'/cancel',{})));return api('chats/'+chat.id);})}/></>}</>:cardJobs.length?cardJobs.every(j=>jobState(j)==='failed')?<button type="button" disabled={saving} onClick={()=>void act(async()=>{await branchJobs(cardJobs,false,'chat');})}>Retry</button>:cardJobs.some(j=>jobState(j)==='unknown')?<button type="button" disabled={saving} onClick={()=>void act(async()=>{await jobApi('connection/reconnect',{});return api('chats/'+chat.id);})}>Check connection</button>:<SeedMenu disabled={saving||Boolean(openGroup)} onChoose={(fresh,destination)=>void act(async()=>{await branchJobs(cardJobs,fresh,destination);return api('chats/'+chat.id);})}/>:group.state==='revising'?<span className="job-pending-label">Revising…</span>:revision.decision==='approved'?<span className="job-approved" title="Waiting for decisions on the other requests"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>Approved</span>:<span className="job-pending-label">{group.state==='stopped'?'Stopped':''}</span>}
 </div></div></EditableItem>{cardJobs.length>0&&<JobOutputs jobs={cardJobs} onSelect={j=>jobState(j)==='completed'?setJobPreview(j):setJobDetail(j.id)}/>}{!historical&&card.revisions.length>1&&<RevisionControls current={revision.number} total={card.revisions.length} label="request revision" onChange={number=>setCardVersions(v=>({...v,[card.id]:number}))}/>}</div>;})}</section>)}
          {(chat.partial||chat.partial_reasoning)&&<article className="chat-message assistant">{chat.partial_reasoning&&<Reasoning text={chat.partial_reasoning} streaming={chat.activity==='thinking'&&!chat.partial}/>} {chat.partial&&<ChatMarkdown text={chat.partial} streaming={chat.activity!=='idle'}/>}</article>}
          {chat.error&&!chat.messages.some(m=>m.transcript?.error===chat.error)&&<p role="alert">{chat.error}</p>}
          {chat.activity==='thinking'&&!chat.partial&&!chat.partial_reasoning&&!chat.messages.some(m=>m.transcript?.state==='running')&&<p role="status">Thinking…</p>}
        </div></div>
        {welcome&&<div className="chat-welcome-heading"><span className="welcome-mark" aria-hidden="true">✧</span><h1>What shall we create today?</h1></div>}
        <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void refs.add('video',Array.from(e.dataTransfer.files));}}>
          {feedbackDraft&&<div className="branch-draft-preview feedback-request-tile"><div className="job-request-card"><RequestCardHeader request={feedbackDraft.revision.request} onPreview={asset=>void show(asset,undefined,feedbackDraft.revision.request.references?.map(r=>r.asset_id))} label="View feedback request" onOpen={()=>setReview(feedbackDraft)}/><JobButton icon="close" label="Remove feedback request" iconOnly onClick={()=>setFeedbackDraft(null)}/></div></div>}
          {branchDraft&&<div className="branch-draft-preview"><div className="job-request-card"><RequestCardHeader request={branchDraft.jobs[0]!.request} onPreview={asset=>void show(asset,undefined,branchDraft.jobs[0]!.request.references?.map(r=>r.asset_id))} label="View request" onOpen={()=>setBranchDetails(true)}/><JobButton icon="close" label="Remove request" iconOnly disabled={busy} onClick={clearBranch}/></div></div>}
          {commandOpen&&!busy&&<div className="workflow-menu" id="workflow-options" role="listbox" aria-label="Commands">{commandResults.length?commandResults.map(([id,w],index)=><button type="button" role="option" id={'workflow-option-'+index} aria-selected={index===commandIndex%commandResults.length} key={id} onMouseDown={e=>e.preventDefault()} onClick={()=>void chooseWorkflow(id as ChatWorkflow|'reasoning')}><span className="workflow-symbol">{id==='text-to-image'?'▧':id==='text-to-video'?'▷':id==='reasoning'?'✧':'◈'}</span><span><strong>{w.label}</strong><small>{w.command}</small></span><span className="workflow-enter">↵</span></button>):<p>No matching command</p>}</div>}
          <div className="composer-input-line">

          <InlineComposer mentions={inputMentions} ref={composer} value={text} placeholder="Describe what you want to create… use / for workflows and commands" expanded={commandOpen&&!busy} activeOption={commandOpen&&commandResults.length?'workflow-option-'+(commandIndex%commandResults.length):undefined} onSelect={setCaret} onChange={(value,position)=>{if(chat.workflow&&text.includes(workflows[chat.workflow].command)&&!value.includes(workflows[chat.workflow].command))void settings({workflow:null});setText(value);setCaret(position);setDismissed(false);setCommandIndex(0);}} onKeyDown={e=>{if(e.key==='Backspace'&&!e.nativeEvent.isComposing&&composer.current!.selectionStart===composer.current!.selectionEnd){const position=composer.current!.selectionStart;const before=text.slice(0,position);const entry=Object.entries(workflows).find(([,w])=>before.endsWith(w.command)||before.endsWith(w.command+' '));if(entry){e.preventDefault();const length=entry[1].command.length+(before.endsWith(' ')?1:0);const next=text.slice(0,position-length)+text.slice(position);flushSync(()=>setText(next));composer.current!.setSelectionRange(position-length,position-length);setCaret(position-length);setDismissed(true);if(chat.workflow===entry[0])void settings({workflow:null});return;}}if(!e.nativeEvent.isComposing&&commandOpen&&!busy){if(e.key==='Escape'){e.preventDefault();setDismissed(true);return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setCommandIndex(i=>(i+(e.key==='ArrowDown'?1:-1)+commandResults.length)%Math.max(1,commandResults.length));return;}if((e.key==='Enter'||e.key==='Tab')&&commandResults.length){e.preventDefault();void chooseWorkflow(commandResults[commandIndex%commandResults.length]![0] as ChatWorkflow|'reasoning');return;}}if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}} onPasteFiles={files=>{if(!busy)void refs.add('video',files);}}/></div>
          {(refs.groups.video.length>0||selected.length>0)&&<div className="composer-attachments">{refs.groups.video.map(ref=><AssetThumbnail key={ref.id} id={ref.asset_id??ref.id} local={ref.file?ref:undefined} name={ref.name} onOpen={()=>ref.file?setPreview({...ref,id:ref.id}):void show(ref.asset_id!)} onRemove={()=>{removeMentionAsset(ref.id);refs.remove('video',ref.id);}}/>)}{selected.map(asset=><AssetThumbnail key={asset} id={asset} onOpen={()=>void show(asset)} onRemove={()=>{removeMentionAsset(asset);setSelected(current=>current.filter(v=>v!==asset));}}/>)}</div>}
          {refs.errors.video.map((error,i)=><p role="alert" key={i}>{error}</p>)}
          {error&&!review&&!sendFailed&&connection==='online'&&<p role="alert" className="composer-error">{error}</p>}
          {missingMention&&<small role="alert">Remove or replace the missing input mentions.</small>}<div className="composer-actions"><input ref={file} hidden type="file" multiple accept="image/*,video/*,audio/*" onChange={e=>{void refs.add('video',Array.from(e.target.files??[]));e.target.value='';}}/><AttachmentMenu disabled={busy||refs.busy} onFiles={()=>file.current?.click()} onLibrary={()=>setGallery(true)}/>{connection!=='online'?<span className="composer-connection" role="status">{connection==='reconnecting'?'⟳ Reconnecting…':'● Can’t reach Seed'}</span>:sendFailed?<details className="composer-failure"><summary>Couldn’t send ⓘ</summary><p role="alert">{error}</p></details>:null}{chat.id&&chat.activity!=='idle'?<button type="button" className="send-button stop-action" disabled={saving} onClick={requestStop}>Stop</button>:connection==='offline'?<button type="button" className="send-button" onClick={()=>void reconnect()}>Reconnect</button>:<button className="primary-action send-button" type="submit" disabled={busy||refs.busy||missingMention||connection!=='online'||!text.trim()||!configured}>{sendFailed?'Retry':'Send'}</button>}</div>
        </form>
      </>
    </div>
    {branchDetails&&branchDraft&&<RequestDetails label="Draft request" title={jobName(branchDraft.jobs[0]!.request.workflow)} caption="Draft · not sent" close={()=>setBranchDetails(false)} request={{...branchDraft.jobs[0]!.request,count:branchDraft.jobs.length}} seedLabel={branchDraft.fresh?'Random':branchDraft.jobs.map(j=>j.seed).join(', ')} inputs={branchDraft.jobs[0]!.input_snapshot??[]} onPreview={asset=>void show(asset)}/>}
    {jobPreview&&<JobMedia job={jobPreview} onClose={()=>setJobPreview(null)}/>}
    {jobDetail&&chat.jobs.some(j=>j.id===jobDetail)&&<JobDetails initial={jobDetail} jobs={chat.jobs.filter(j=>j.submission_id===chat.jobs.find(v=>v.id===jobDetail)!.submission_id)} onClose={()=>setJobDetail(null)} onRefresh={()=>void api('chats/'+chat.id).then(setChat)}/>}
    {gallery&&<GalleryPicker group="video" existing={refs.groups.video} onClose={()=>setGallery(false)} onSelect={async assets=>{await refs.add('video',assets);setGallery(false);}}/>}
    {refs.notes.length>0&&<NoteModal ids={refs.notes} close={refs.dismissNotes} local={refs.groups.video.filter(r=>Boolean(r.file))} onLocalNote={(id,note)=>refs.update('video',id,{note})}/>}
    {preview&&<MediaPreview media={preview} navigation={preview.gallery?.includes(preview.id)?{index:preview.gallery.indexOf(preview.id),total:preview.gallery.length,onChange:index=>void show(preview.gallery![index]!,undefined,preview.gallery)}:undefined} referenceLabel={preview.referenceLabel??inputMentions.find(m=>m.id===preview.id)?.label} onClose={()=>setPreview(null)} note={preview.id.startsWith('reference-')?undefined:<AssetNote id={preview.id}/>}/>}
    {sequence&&<FrameViewer id={sequence} onClose={()=>setSequence(null)}/>}
    {review&&chat&&target&&<Review key={review.card.id} card={target} initial={review.revision} error={reviewError} assets={chat.asset_manifest??[]} mode={chat.mode} busy={saving||chat.activity==='thinking'||chat.activity==='preparing'} editable={openGroup?.cards.some(c=>c.id===target.id)??false} onPreview={asset=>void show(asset,undefined,review.revision.request.references?.map(r=>r.asset_id))} close={()=>setReview(null)}
      save={async request=>{const result=await act(()=>api(`chats/${chat.id}/cards/${target.id}/revise`,'POST',{revision:target.revisions.at(-1)!.number,request}),'review');if(result){setCardVersions(v=>{const next={...v};delete next[review.card.id];return next;});const card=result.groups.flatMap((g:any)=>g.cards).find((c:any)=>c.id===target.id);setReview({card,revision:card.revisions.at(-1)});}return Boolean(result);}}
      approve={async()=>{const result=await act(()=>api(`chats/${chat.id}/cards/${target.id}/decision`,'POST',{revision:target.revisions.at(-1)!.number,decision:'approved'}),'review');if(result)setReview(null);}}
      restore={async(revision,request)=>{const value=await act(()=>api(`chats/${chat.id}/cards/${target.id}/restore`,'POST',{revision,request}),'review');if(value)setReview(null);}}
      stop={()=>{requestStop();setReview(null);}}
      feedback={()=>{setBranchDraft(null);setFeedbackDraft({card:target,revision:target.revisions.at(-1)!});setReview(null);requestAnimationFrame(()=>composer.current?.focus());}} />}
    {rename&&<Modal className="rename-chat-modal" aria-label="Rename chat" onCancel={()=>setRename(null)}><form onSubmit={e=>{e.preventDefault();void act(async()=>{const current=await api('chats/'+rename.id);const value=await api('chats/'+rename.id,'PATCH',{version:current.version,title:rename.title});setList(items=>items.map(item=>item.id===value.id?{...item,title:value.title}:item));setRename(null);return value;});}}><header><h2>Rename chat</h2><JobButton icon="close" label="Close rename" iconOnly onClick={()=>setRename(null)}/></header><label>Chat name<input autoFocus onFocus={e=>e.currentTarget.select()} aria-label="Chat title" value={rename.title} maxLength={120} onChange={e=>setRename({...rename,title:e.target.value})}/></label>{error&&<p role="alert">{error}</p>}<footer><button type="button" onClick={()=>setRename(null)}>Cancel</button><button className="primary-action" disabled={saving||!rename.title.trim()}>Save</button></footer></form></Modal>}
    {stopping&&<ConfirmDialog title="Stop this chat?" description="This will stop the agent and cancel all queued and running jobs in this chat. Completed media stays in Library." action="Stop chat and jobs" onClose={()=>setStopping(null)} onConfirm={async()=>{const value=await api('chats/'+stopping+'/stop','POST',{});if(currentId.current===stopping)setChat(value);}}/>}
    {deleting&&<ConfirmDialog title="Delete chat?" description="Uploaded and generated media stays in Library. Stop active generation before deleting a chat." action="Delete chat" onClose={()=>setDeleting(null)} onConfirm={async()=>{await api('chats/'+deleting,'DELETE');setList(items=>items.filter(item=>item.id!==deleting));if(currentId.current===deleting){remember('selected.'+mode,'');setId(null);currentId.current=null;setChat(null);setText('');}setDeleting(null);}}/>}
  </section>;
}

function ActionIcon({kind}:{kind:'review'|'repeat'|'seed'}){return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{kind==='review'?<><path d="M14 3H5v18h14V8zM14 3v5h5"/><path d="m8 14 2 2 5-5"/></>:kind==='repeat'?<><path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/></>:<><path d="M6 18C0 8 12 3 20 4c1 8-4 20-14 14Z"/><path d="M4 21 16 9"/></>}</svg>;}

function Reasoning({text,streaming=false}:{text:string;streaming?:boolean}){
 const [expanded,setExpanded]=useState(streaming);
 useEffect(()=>setExpanded(streaming),[streaming]);
 return <section className={'model-reasoning'+(streaming?' is-streaming':'')}><button type="button" className="reasoning-disclosure" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><span>{streaming?'Thinking…':'Reasoning'}</span><span aria-hidden="true">{expanded?'⌄':'›'}</span></button><div className="reasoning-body" hidden={!expanded}><ChatMarkdown text={text} streaming={streaming}/></div></section>;
}




function MentionedMessage({text,onPreview}:{text:string;onPreview:(id:string,label?:string)=>void}){return <>{text.split(/(\[(?:Picture|Video|Audio) [1-9][0-9]*\]\(asset:[^)]+\))/g).map((part,i)=>part.includes('](asset:')?<MentionText key={i} text={part} onPreview={onPreview}/>:<CommandText key={i} text={part}/>)}</>;}
