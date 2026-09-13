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
type View=ChatView&{asset_manifest?:AssetContext[];jobs:Array<{id:string;state:string;seed:string;outputs:string[];error:string|null;request:ImageRequest}>;accounting:Array<{cost:number|null}>};
async function api(url:string,method='GET',body?:unknown){const response=await fetch('/api/v1/'+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const result=await response.json();if(!response.ok){const message=result.error?.message;throw Error(message==='fetch failed'?'Cannot reach the GPU worker. Connect or reconnect the GPU, then try Generate again.':message||'Request failed. Please try again.');}return result;}

export function Chat({sidebarTarget,onChooseChat}:{sidebarTarget:HTMLElement|null;onChooseChat:()=>void}){
  const {spicy}=useSpicy(),mode=spicy?'nsfw':'sfw';
  const [list,setList]=useState<Array<{id:string;title:string;activity:string;error:string|null;status?:string}>>([]);
  const [id,setId]=useState<string|null>(null),[savedChat,setChat]=useState<View|null>(null);
  const chat:View=savedChat??{id:'',title:'New chat',mode,workflow:null,version:0,epoch:0,reasoning:true,messages:[],groups:[],assets:[],activity:'idle',error:null,jobs:[],accounting:[],created_at:'',updated_at:''};
  const welcome=!chat.messages.length&&!chat.groups.length&&!chat.partial&&chat.activity==='idle';
  const [text,setText]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[configured,setConfigured]=useState(true);
  const [gallery,setGallery]=useState(false),[review,setReview]=useState<{card:ChatCard;revision:ChatRevision}|null>(null);
  const [preview,setPreview]=useState<(PreviewMedia&{id:string})|null>(null),[sequence,setSequence]=useState<string|null>(null);
  const [deleting,setDeleting]=useState<string|null>(null),[rename,setRename]=useState<{id:string;title:string}|null>(null);
  const refs=useReferences(),file=useRef<HTMLInputElement>(null);
  const currentId=useRef(id);currentId.current=id;
  const generation=useRef(0),composer=useRef<HTMLTextAreaElement>(null);
  const [cardVersions,setCardVersions]=useState<Record<string,number>>({});
  const [selected,setSelected]=useState<string[]>([]);
  const drafts=useRef<Record<string,string>>({});
  const [caret,setCaret]=useState(0),[commandIndex,setCommandIndex]=useState(0),[dismissed,setDismissed]=useState(false);
  const commandMatch=text.slice(0,caret).match(/(?:^|\s)(\/[^\s/]*)$/);
  const commandToken=commandMatch?.[1];
  const commandResults=Object.entries({...workflows,reasoning:{label:`Reasoning · ${chat?.reasoning?'on':'off'}`,command:'/reasoning'}}).filter(([,w])=>!commandToken||w.command.includes(commandToken.toLowerCase())||w.label.toLowerCase().includes(commandToken.slice(1).toLowerCase()));
  const commandOpen=Boolean(commandToken)&&!dismissed;

  const history=useRef<HTMLDivElement>(null),historyContent=useRef<HTMLDivElement>(null),follow=useRef(true),lastScrollTop=useRef(0),scrollSize=useRef('');
  useLayoutEffect(()=>{follow.current=true;lastScrollTop.current=0;},[id]);
  const historyVersion=chat?JSON.stringify([chat.messages.at(-1)?.id,chat.partial,chat.partial_reasoning,chat.groups.map(g=>[g.state,g.cards.map(c=>c.revisions.at(-1)?.number)]),chat.jobs.map(j=>[j.state,j.outputs.length])]):'';
  function scrollFollowing(){const element=history.current;if(follow.current&&element){element.scrollTop=element.scrollHeight;lastScrollTop.current=element.scrollTop;scrollSize.current=[element.scrollHeight,element.clientHeight,element.clientWidth].join();}}
  useLayoutEffect(scrollFollowing,[historyVersion,id]);
  useLayoutEffect(()=>{const observer=new ResizeObserver(scrollFollowing);if(history.current)observer.observe(history.current);if(historyContent.current)observer.observe(historyContent.current);return()=>observer.disconnect();},[]);
  const busy=saving||Boolean(chat&&chat.activity!=='idle');
  useEffect(()=>{let disposed=false;const epoch=++generation.current;
    const restored=remembered('selected.'+mode)||null;currentId.current=restored;
    setList([]);setId(restored);setChat(null);setText(restored?remembered('draft.'+restored):'');setReview(null);setPreview(null);setSequence(null);setGallery(false);setSelected([]);setRename(null);setDeleting(null);
    void api('chat-config').then(v=>{if(!disposed)setConfigured(v.configured);}).catch(()=>{});
    async function refresh(){try{const value=await api('chats?mode='+mode);if(!disposed)setList(value.items);const active=currentId.current;if(active){const value=await api('chats/'+active);if(!disposed&&epoch===generation.current&&active===currentId.current&&value.mode===mode)setChat(value);}}catch(e){if(!disposed)setError((e as Error).message);}}
    void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{disposed=true;clearInterval(timer);};
  },[mode]);
  useEffect(()=>{if(!id)return;const stream=new EventSource('/api/v1/chats/'+id+'/events');stream.onmessage=event=>{const value=JSON.parse(event.data);setChat(current=>current?.id===id?{...current,...value,partial:value.activity==='idle'?current.partial:value.partial,partial_reasoning:value.activity==='idle'?current.partial_reasoning:value.partial_reasoning}:current);if(value.activity==='idle')void api('chats/'+id).then(value=>{if(currentId.current===id)setChat(value);});};return()=>stream.close();},[id]);
  useEffect(()=>{if(id)remember('draft.'+id,text);},[id,text]);
  async function act(fn:()=>Promise<any>){setSaving(true);setError('');const epoch=generation.current;try{const value=await fn();if(epoch===generation.current&&value?.id===currentId.current)setChat(value);return value;}catch(e){if(epoch===generation.current)setError((e as Error).message);return null;}finally{setSaving(false);}}
  async function open(next:string){onChooseChat();if(id)drafts.current[id]=text;remember('selected.'+mode,next);currentId.current=next;setId(next);setChat(null);setText(drafts.current[next]??remembered('draft.'+next));setSelected([]);refs.reset('video');setReview(null);const value=await act(()=>api('chats/'+next));if(value&&currentId.current===next)setChat(value);}
  async function create(){onChooseChat();const value=await act(()=>api('chats','POST',{mode}));if(value){remember('selected.'+mode,value.id);setId(value.id);currentId.current=value.id;setChat(value);setText('');setSelected([]);refs.reset('video');}}
  async function ensureChat(){if(chat.id)return chat;const value=await act(()=>api('chats','POST',{mode}));if(value){remember('selected.'+mode,value.id);setId(value.id);currentId.current=value.id;setChat(value);}return value;}
  async function settings(values:object){const current=await ensureChat();if(current)return act(()=>api('chats/'+current.id,'PATCH',{version:current.version,...values}));}
  async function chooseWorkflow(workflow:ChatWorkflow|'reasoning'){
    if(busy)return;const original=text,position=caret,token=commandToken;setDismissed(true);
    const changed=await settings(workflow==='reasoning'?{reasoning:!chat?.reasoning}:{workflow});if(!changed){setDismissed(false);return;}
    if(workflow==='reasoning')toast.success(`Reasoning ${changed.reasoning?'enabled':'disabled'}`);
    const replacement=workflow==='reasoning'?'':workflows[workflow].command+' ';
    const next=token?original.slice(0,position-token.length)+replacement+original.slice(position):original;
    if(composer.current?.value===original){
      flushSync(()=>setText(next));
      const at=token?position-token.length+replacement.length:position;composer.current.focus();composer.current.setSelectionRange(at,at);setCaret(at);
    }
  }
  async function send(message=text,card?:ChatCard,revision?:number){if(!chat||busy)return;
    if(!card&&commandOpen&&message===text){if(commandResults.length)await chooseWorkflow(commandResults[commandIndex%commandResults.length]![0] as ChatWorkflow|'reasoning');else setError('No matching command. Edit the command or press Escape to dismiss it.');return;}
    follow.current=true;
    const command=message.trim().split(/\s+/)[0],entry=Object.entries(workflows).find(([,w])=>message.split(/\s+/).includes(w.command));
    let current=await ensureChat();if(!current)return;
    if(command==='/reasoning'){const changed=await settings({reasoning:!chat.reasoning});if(!changed)return;current=changed;toast.success(`Reasoning ${changed.reasoning?'enabled':'disabled'}`);message=message.trim().slice(command.length).trim();if(!message){setText('');return;}}
    if(entry){const changed=await settings({workflow:entry[0]});if(!changed)return;current=changed;message=message.split(entry[1].command).join('').trim();if(!message){setText('');return;}}
    if(card&&card.workflow!==current.workflow){const changed=await settings({workflow:card.workflow});if(!changed)return;current=changed;}
    const value=await act(()=>api('chats/'+current.id+'/messages','POST',{version:current.version,text:message,assets:[...new Set([...selected,...refs.groups.video.map(r=>r.asset_id!)])],...(card?{card_id:card.id,revision}: {})}));
    if(value){setText('');setSelected([]);refs.reset('video');setReview(null);composer.current?.focus();}
  }
  async function show(assetId:string){const value=await act(()=>api('assets/'+assetId));if(value)setPreview({id:assetId,name:'Conversation asset',url:'/api/v1/assets/'+assetId+'/content',kind:value.kind,type:value.mime_type??'',width:value.width,height:value.height,duration:value.duration});}
  const target=review&&chat?.groups.flatMap(g=>g.cards).find(c=>c.id===review.card.id);
  const openGroup=chat?.groups.find(g=>!['released','stopped'].includes(g.state));
  const timeline:Array<{message:ChatMessage;group?:never}|{group:ChatGroup;message?:never}>=[];
  const anchored=new Set<string>();
  function appendGroups(after:string|null){for(const group of chat.groups)if(group.after_message_id===after){timeline.push({group});anchored.add(group.id);}}
  appendGroups(null);for(const message of chat.messages){if(!(message.role==='event'&&(message.text.startsWith('Workflow: ')||message.text==='Workflow turned off.')))timeline.push({message});appendGroups(message.id);}for(const group of chat.groups)if(!anchored.has(group.id))timeline.push({group});
  return <section className="chat-layout">
    {sidebarTarget&&createPortal(<aside className="chat-sidebar"><p className="section-label">Your chats</p><button className="primary-action" onClick={()=>void create()} disabled={saving}>New chat</button>{list.map(item=><ChatSidebarRow key={item.id} title={item.title} selected={item.id===id} status={item.activity!=='idle'?item.activity:item.error?'Needs attention':item.status} onOpen={()=>void open(item.id)} onRename={()=>{onChooseChat();setRename({id:item.id,title:item.title});}} onDelete={()=>{onChooseChat();setDeleting(item.id);}}/>)}</aside>,sidebarTarget)}
    <div className={'chat-main'+(welcome?' chat-welcome':'')}>
      {!configured&&<p>Set up Chat with <code>seed setup --chat-only</code>.</p>}
        <>
        <div ref={history} className="chat-history" aria-live="polite" onScroll={()=>{const element=history.current;if(!element)return;const near=element.scrollHeight-element.scrollTop-element.clientHeight<=80;if(near)follow.current=true;else if(element.scrollTop<lastScrollTop.current-1&&scrollSize.current===[element.scrollHeight,element.clientHeight,element.clientWidth].join())follow.current=false;lastScrollTop.current=element.scrollTop;}}><div ref={historyContent} className="chat-history-content">
          {timeline.map(({message,group})=>message?<article className={'chat-message '+message.role} key={message.id}><small>{message.role==='user'?'You':message.role==='assistant'?'Seed':'Workflow'}</small>{message.reasoning_text&&<Reasoning text={message.reasoning_text}/>}<p>{message.text}</p>{message.assets.map(asset=>{const info=chat.asset_manifest?.find(a=>a.id===asset);return <span className="chat-attachment" key={asset}><button onClick={()=>void show(asset)}>{info?.kind==='image'&&<img src={'/api/v1/assets/'+asset+'/content'} alt=""/>}{info?.name??'Open attached asset'}</button>{info?.note&&<small>{info.note}</small>}<button onClick={()=>setSelected(current=>current.includes(asset)?current.filter(v=>v!==asset):[...current,asset])}>{selected.includes(asset)?'Selected':'Use in next message'}</button></span>;})}</article>:<section className="chat-group" key={group.id}>{group.cards.map(card=>{const revision=card.revisions.find(r=>r.number===cardVersions[card.id])??card.revisions.at(-1)!;return <EditableItem className="chat-card" key={card.id} label="Edit request" onEdit={()=>setReview({card,revision})}>
            <div className="request-heading"><div><strong>{workflows[card.workflow].label}</strong><span>{revision.request.count} output{revision.request.count===1?'':'s'}</span></div><span className={'request-status status-'+revision.decision}>{revision.decision==='undecided'?(group.state==='stopped'?'Stopped':group.state==='revising'?'Revising…':'Needs review'):revision.decision==='approved'?'Approved':'Denied'}</span></div>
            <div className="request-actions"><RevisionControls current={revision.number} total={card.revisions.length} label="request revision" onChange={number=>setCardVersions(v=>({...v,[card.id]:number}))}/>
            <button className="primary-action review-action" aria-label="Review / history" onClick={()=>setReview({card,revision})}><ActionIcon kind="review"/>Review</button>
            {group.state==='reviewing'&&<button disabled={busy||revision.number!==card.revisions.at(-1)!.number} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/decision`,'POST',{revision:revision.number,decision:'denied'}))}>Deny</button>}
            {['released','stopped'].includes(group.state)&&<><button className="card-icon-action" aria-label="Repeat" title="Repeat" disabled={busy||Boolean(openGroup)} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/repeat`,'POST',{revision:revision.number,fresh:false}))}><ActionIcon kind="repeat"/></button><button className="card-icon-action" aria-label="New seed variation" title="New seed variation" disabled={busy||Boolean(openGroup)} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/repeat`,'POST',{revision:revision.number,fresh:true}))}><ActionIcon kind="seed"/></button></>}
            </div>
            {revision.job_ids.map(jobId=>{const job=chat.jobs.find(j=>j.id===jobId);return job&&<div key={jobId}><small>{job.state} · seed {job.seed}</small>{job.error&&<p>{job.error}</p>}{job.request.output.format==='images'&&job.outputs.length?<button onClick={()=>setSequence(job.id)}>Open {job.outputs.length} frames</button>:job.outputs.map(asset=><div key={asset} className="chat-output"><button onClick={()=>void show(asset)}>{job.request.workflow==='text-to-image'?<img src={'/api/v1/assets/'+asset+'/content'} alt="Generated image"/>:<video src={'/api/v1/assets/'+asset+'/content'} muted preload="metadata"/>}</button><button onClick={()=>setSelected(current=>current.includes(asset)?current:[...current,asset])}>Use in next message</button></div>)}{job.state==='failed'&&<button disabled={busy||Boolean(openGroup)} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/repeat`,'POST',{revision:revision.number,fresh:false,failed_only:true}))}>Retry failed jobs</button>}</div>;})}
          </EditableItem>;})}</section>)}
          {(chat.partial||chat.partial_reasoning)&&<article className="chat-message assistant"><small>Seed</small>{chat.partial_reasoning&&<Reasoning text={chat.partial_reasoning} streaming={chat.activity==='thinking'&&!chat.partial}/>} {chat.partial&&<p>{chat.partial}</p>}</article>}
          {chat.error&&<p role="alert">{chat.error}</p>}
          {chat.activity!=='idle'&&<p role="status">{chat.activity==='thinking'?'Thinking…':chat.activity==='preparing'?'Preparing approved requests…':'Generating…'}</p>}
        </div></div>
        {welcome&&<div className="chat-welcome-heading"><span className="welcome-mark" aria-hidden="true">✧</span><h1>What shall we create today?</h1></div>}
        <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void refs.add('video',Array.from(e.dataTransfer.files));}}>
          {commandOpen&&!busy&&<div className="workflow-menu" id="workflow-options" role="listbox" aria-label="Commands">{commandResults.length?commandResults.map(([id,w],index)=><button type="button" role="option" id={'workflow-option-'+index} aria-selected={index===commandIndex%commandResults.length} key={id} onMouseDown={e=>e.preventDefault()} onClick={()=>void chooseWorkflow(id as ChatWorkflow|'reasoning')}><span className="workflow-symbol">{id==='text-to-image'?'▧':id==='text-to-video'?'▷':id==='reasoning'?'✧':'◈'}</span><span><strong>{w.label}</strong><small>{w.command}</small></span><span className="workflow-enter">↵</span></button>):<p>No matching command</p>}</div>}
          <div className="composer-input-line">

          <textarea ref={composer} rows={1} aria-label="Chat message" role="combobox" aria-autocomplete="list" aria-expanded={commandOpen&&!busy} aria-controls={commandOpen&&!busy?'workflow-options':undefined} aria-activedescendant={commandOpen&&commandResults.length?'workflow-option-'+(commandIndex%commandResults.length):undefined} onSelect={e=>setCaret(e.currentTarget.selectionStart)} value={text} maxLength={16000} placeholder={welcome?"Describe what you have in mind…":"Message Seed…  / for commands"} onChange={e=>{if(chat.workflow&&text.includes(workflows[chat.workflow].command)&&!e.target.value.includes(workflows[chat.workflow].command))void settings({workflow:null});setText(e.target.value);setCaret(e.target.selectionStart);setDismissed(false);setCommandIndex(0);e.target.style.height='auto';e.target.style.height=Math.min(180,e.target.scrollHeight)+'px';}} onKeyDown={e=>{if(e.key==='Backspace'&&!e.nativeEvent.isComposing&&e.currentTarget.selectionStart===e.currentTarget.selectionEnd){const position=e.currentTarget.selectionStart;const before=text.slice(0,position);const entry=Object.entries(workflows).find(([,w])=>before.endsWith(w.command)||before.endsWith(w.command+' '));if(entry){e.preventDefault();const length=entry[1].command.length+(before.endsWith(' ')?1:0);const next=text.slice(0,position-length)+text.slice(position);flushSync(()=>setText(next));e.currentTarget.setSelectionRange(position-length,position-length);setCaret(position-length);setDismissed(true);if(chat.workflow===entry[0])void settings({workflow:null});return;}}if(!e.nativeEvent.isComposing&&commandOpen&&!busy){if(e.key==='Escape'){e.preventDefault();setDismissed(true);return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setCommandIndex(i=>(i+(e.key==='ArrowDown'?1:-1)+commandResults.length)%Math.max(1,commandResults.length));return;}if((e.key==='Enter'||e.key==='Tab')&&commandResults.length){e.preventDefault();void chooseWorkflow(commandResults[commandIndex%commandResults.length]![0] as ChatWorkflow|'reasoning');return;}}if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}} onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length&&!busy){e.preventDefault();void refs.add('video',files);}}}/></div>
          {refs.groups.video.map(ref=><button type="button" key={ref.id} onClick={()=>refs.remove('video',ref.id)}>{ref.name} ×</button>)}{selected.map(asset=><button type="button" key={asset} onClick={()=>setSelected(current=>current.filter(v=>v!==asset))}>Selected asset ×</button>)}
          {refs.errors.video.map((error,i)=><p role="alert" key={i}>{error}</p>)}
          {error&&!review&&<p role="alert" className="composer-error">{error}</p>}
          <div className="composer-actions"><input ref={file} hidden type="file" multiple accept="image/*,video/*,audio/*" onChange={e=>{void refs.add('video',Array.from(e.target.files??[]));e.target.value='';}}/><AttachmentMenu disabled={busy||refs.busy} onFiles={()=>file.current?.click()} onLibrary={()=>setGallery(true)}/>{refs.busy&&<span className="upload-status">Uploading…</span>}<button className="primary-action send-button" type="submit" disabled={busy||refs.busy||!text.trim()||!configured}>Send</button>{busy&&<button type="button" className="stop-action" onClick={()=>void act(()=>api('chats/'+chat.id+'/stop','POST',{}))}>Stop</button>}</div>
        </form>
      </>
    </div>
    {gallery&&<GalleryPicker group="video" existing={refs.groups.video} onClose={()=>setGallery(false)} onSelect={async assets=>{await refs.add('video',assets);setGallery(false);}}/>}
    {refs.notes.length>0&&<NoteModal ids={refs.notes} close={refs.dismissNotes}/>}
    {preview&&<MediaPreview media={preview} onClose={()=>setPreview(null)} controls={<AssetNote id={preview.id}/>}/>}
    {sequence&&<FrameViewer id={sequence} onClose={()=>setSequence(null)}/>}
    {review&&chat&&target&&<Review key={review.card.id} card={target} initial={review.revision} error={error||chat.error||''} assets={chat.asset_manifest??[]} mode={chat.mode} busy={busy} editable={openGroup?.cards.some(c=>c.id===target.id)??false} activeWorkflow={chat.workflow} close={()=>setReview(null)}
      save={async request=>{const result=await act(()=>api(`chats/${chat.id}/cards/${target.id}/revise`,'POST',{revision:target.revisions.at(-1)!.number,request}));if(result){setCardVersions(v=>{const next={...v};delete next[review.card.id];return next;});const card=result.groups.flatMap((g:any)=>g.cards).find((c:any)=>c.id===target.id);setReview({card,revision:card.revisions.at(-1)});}return Boolean(result);}}
      approve={async()=>{const result=await act(()=>api(`chats/${chat.id}/cards/${target.id}/decision`,'POST',{revision:target.revisions.at(-1)!.number,decision:'approved'}));if(result)setReview(null);}}
      restore={async(revision,request)=>{const value=await act(()=>api(`chats/${chat.id}/cards/${target.id}/restore`,'POST',{revision,request}));if(value)setReview(null);}}
      stop={()=>{void act(()=>api('chats/'+chat.id+'/stop','POST',{}));setReview(null);}}
      feedback={(message)=>send(message,target,target.revisions.at(-1)!.number)} />}
    {rename&&<Modal aria-label="Rename chat" onCancel={()=>setRename(null)}><form onSubmit={e=>{e.preventDefault();void act(async()=>{const current=await api('chats/'+rename.id);const value=await api('chats/'+rename.id,'PATCH',{version:current.version,title:rename.title});setList(items=>items.map(item=>item.id===value.id?{...item,title:value.title}:item));setRename(null);return value;});}}><h2>Rename chat</h2><input autoFocus aria-label="Chat title" value={rename.title} maxLength={120} onChange={e=>setRename({...rename,title:e.target.value})}/>{error&&<p role="alert">{error}</p>}<button className="primary-action" disabled={saving||!rename.title.trim()}>Save name</button><button type="button" onClick={()=>setRename(null)}>Cancel</button></form></Modal>}
    {deleting&&<ConfirmDialog title="Delete chat?" description="Uploaded and generated media stays in Library. Stop active generation before deleting a chat." action="Delete chat" onClose={()=>setDeleting(null)} onConfirm={async()=>{await api('chats/'+deleting,'DELETE');setList(items=>items.filter(item=>item.id!==deleting));if(currentId.current===deleting){remember('selected.'+mode,'');setId(null);currentId.current=null;setChat(null);setText('');}setDeleting(null);}}/>}
  </section>;
}

function Review({card,initial,error,assets,mode,busy,editable,activeWorkflow,close,save,approve,feedback,restore,stop}:{card:ChatCard;initial:ChatRevision;error:string;assets:AssetContext[];mode:'sfw'|'nsfw';busy:boolean;editable:boolean;activeWorkflow:ChatWorkflow|null;close:()=>void;save:(request:unknown)=>Promise<boolean>;approve:()=>Promise<void>;feedback:(text:string)=>Promise<void>;restore:(revision:number,request:unknown)=>Promise<void>;stop:()=>void}){
  const failure=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error){failure.current?.scrollIntoView({block:'nearest'});failure.current?.focus({preventScroll:true});}},[error,busy]);
  const dialog=useRef<HTMLDivElement>(null),[revision,setRevision]=useState(initial.number),[request,setRequest]=useState(initial.request),[message,setMessage]=useState('');
  useEffect(()=>{setRevision(initial.number);setRequest(initial.request);},[initial.number]);
  const change=(values:Partial<ImageRequest>)=>setRequest(v=>({...v,...values}));
  const dirty=JSON.stringify(request)!==JSON.stringify(card.revisions.at(-1)!.request)||revision!==card.revisions.at(-1)!.number;
  const raw=()=>{const value:any={...request};delete value.workflow;delete value.capabilities_revision;if(mode==='sfw')delete value.mode;return value;};
  return <Modal ref={dialog} className="chat-review" onCancel={close} aria-label="Review generation"><header><h2>{workflows[card.workflow].label}</h2>{busy&&<button onClick={stop}>Stop</button>}<button onClick={close}>Close</button></header>
    <RevisionControls current={revision} total={card.revisions.length} label="request revision" onChange={number=>{const value=card.revisions.find(r=>r.number===number)!;setRevision(value.number);setRequest(value.request);}}/>
    <fieldset disabled={busy}><label>Prompt<textarea value={request.prompt} onChange={e=>change({prompt:e.target.value})}/></label>
      <div className="chat-fields"><label>Aspect<select value={request.output.aspect} onChange={e=>change({output:{...request.output,aspect:e.target.value as '16:9'|'9:16'}})}><option>16:9</option><option>9:16</option></select></label><label>Count<input type="number" min={1} max={16} value={request.count} onChange={e=>change({count:Number(e.target.value)})}/></label><label>Seed<input value={request.seed} onChange={e=>change({seed:e.target.value})}/></label>
        {mode==='nsfw'&&<label>Mode<select value={request.mode} onChange={e=>change({mode:e.target.value as 'sfw'|'nsfw'})}><option value="sfw">Standard</option><option value="nsfw">Spicy</option></select></label>}
        {card.workflow!=='text-to-image'&&<><label>Duration<input type="number" min={5} max={15} value={request.output.duration_seconds} onChange={e=>change({output:{...request.output,duration_seconds:Number(e.target.value)}})}/></label><label>Quality<select value={request.quality??'fast'} onChange={e=>change({quality:e.target.value as 'fast'|'high',output:{...request.output,size:e.target.value==='high'?'native':request.output.size}})}><option value="fast">Fast</option><option value="high">High</option></select></label><label>Size<select value={request.output.size} onChange={e=>change({output:{...request.output,size:e.target.value as '720p'|'native'}})}><option value="720p">720p</option><option value="native">Native</option></select></label><label>Export<select value={request.output.format??'video'} onChange={e=>change({output:{...request.output,format:e.target.value as 'video'|'images'}})}><option value="video">Video</option><option value="images">Images</option></select></label><label>Soundtrack<select value={request.audio?.output??'generated'} onChange={e=>change({audio:{output:e.target.value as 'generated'|'silent'}})}><option value="generated">Generated</option><option value="silent">Silent</option></select></label></>}
      </div>
      {request.references?.map((ref,index)=><div key={ref.id} className="chat-reference"><strong>{ref.kind} · {ref.asset_id}</strong><select aria-label="Generation role" value={ref.role} onChange={e=>change({references:request.references!.map((r,i)=>i===index?{...r,role:e.target.value as typeof ref.role}:r)})}><option value="reference">Reference</option>{ref.kind==='image'&&<><option value="first_frame">First frame</option><option value="last_frame">Last frame</option></>}</select>{ref.kind==='image'?<select aria-label="Framing" value={ref.framing??'fit'} onChange={e=>change({references:request.references!.map((r,i)=>i===index?{...r,framing:e.target.value as 'fit'|'fill'}:r)})}><option value="fit">Fit</option><option value="fill">Fill</option></select>:<>{(['start_seconds','duration_seconds'] as const).map(field=><label key={field}>{field==='start_seconds'?'Start':'Length'}<input type="number" step="0.1" value={ref.range?.[field]??0} onChange={e=>change({references:request.references!.map((r,i)=>i===index?{...r,range:{start_seconds:0,duration_seconds:2,...r.range,[field]:Number(e.target.value)}}:r)})}/></label>)}{ref.kind==='video'&&<label><input type="checkbox" checked={ref.include_audio??false} onChange={e=>change({references:request.references!.map((r,i)=>i===index?{...r,include_audio:e.target.checked}:r)})}/>Include audio</label>}</>}
        <button disabled={index===0} onClick={()=>{const refs=[...request.references!];[refs[index-1],refs[index]]=[refs[index]!,refs[index-1]!];change({references:refs});}}>Move up</button>
        <button disabled={index===request.references!.length-1} onClick={()=>{const refs=[...request.references!];[refs[index+1],refs[index]]=[refs[index]!,refs[index+1]!];change({references:refs});}}>Move down</button>
        <button onClick={()=>change({references:request.references!.filter((_,i)=>i!==index)})}>Remove</button>
      </div>)}
      {card.workflow==='reference-to-video'&&<label>Add provided asset<select value="" onChange={e=>{const asset=assets.find(a=>a.id===e.target.value);if(asset)change({references:[...(request.references??[]),{id:asset.id,asset_id:asset.id,kind:asset.kind,role:'reference',...(asset.kind==='image'?{framing:'fit' as const}:{range:{start_seconds:0,duration_seconds:Math.min(15,asset.metadata?.duration??2)}})}]});}}><option value="">Choose an asset from this conversation</option>{assets.filter(a=>a.kind&&!request.references?.some(r=>r.asset_id===a.id)).map(a=><option key={a.id} value={a.id}>{a.name}{a.note?' · '+a.note:''}</option>)}</select></label>}
      {request.references?.map(ref=>{const asset=assets.find(a=>a.id===ref.asset_id);return <div key={'note-'+ref.id}><strong>{asset?.name??'Missing asset'}</strong>{asset?.kind==='image'&&<img className="chat-reference-preview" src={'/api/v1/assets/'+ref.asset_id+'/content'} alt="Reference"/>}<p>{card.revisions.find(r=>r.number===revision)?.approved_snapshot?card.revisions.find(r=>r.number===revision)?.notes[ref.asset_id]:asset?.note}</p></div>;})}
      {error&&<p className="chat-review-error" role="alert" ref={failure} tabIndex={-1}>{error}</p>}
      {editable?<><button onClick={()=>void save(raw())}>Save as latest revision</button><button className="primary-action" disabled={dirty} onClick={()=>void approve()}>Generate · approve this revision</button>{dirty&&<p>Save your changes before approving or sending feedback.</p>}</>:<button onClick={()=>void restore(revision,raw())}>Restore as new request</button>}
    </fieldset>
    {editable&&<form onSubmit={e=>{e.preventDefault();if(!dirty)void feedback(message);}}><label>Provide feedback<textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(message.trim()&&!busy&&!dirty)void feedback(message);}}}/></label><button disabled={busy||dirty||!message.trim()}>{activeWorkflow===card.workflow?'Send feedback':'Switch workflow and send feedback'}</button></form>}
  </Modal>;
}

function ActionIcon({kind}:{kind:'review'|'repeat'|'seed'}){return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{kind==='review'?<><path d="M14 3H5v18h14V8zM14 3v5h5"/><path d="m8 14 2 2 5-5"/></>:kind==='repeat'?<><path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/></>:<><path d="M6 18C0 8 12 3 20 4c1 8-4 20-14 14Z"/><path d="M4 21 16 9"/></>}</svg>;}

function Reasoning({text,streaming=false}:{text:string;streaming?:boolean}){
 const [expanded,setExpanded]=useState(streaming);
 useEffect(()=>setExpanded(streaming),[streaming]);
 return <section className={'model-reasoning'+(streaming?' is-streaming':'')}><button type="button" className="reasoning-disclosure" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><span>{streaming?'Thinking…':'Reasoning'}</span><span aria-hidden="true">{expanded?'⌄':'›'}</span></button><div className="reasoning-body" hidden={!expanded}><p>{text}</p></div></section>;
}
