import React,{useEffect,useRef,useState} from 'react';
import type {ChatView,ChatWorkflow,ChatCard,ChatRevision} from '../shared/chat.js';
import type {ImageRequest} from '../server/workflows.js';
import {useSpicy} from './spicy-mode.js';
import {GalleryPicker} from './gallery-picker.js';
import {useReferences,NoteModal} from './references.js';
import {MediaPreview,type PreviewMedia} from './media-preview.js';
import {AssetNote} from './asset-note.js';
import {FrameViewer} from './frame-viewer.js';
import {ConfirmDialog} from './confirm-dialog.js';

const workflows:Record<ChatWorkflow,{label:string;command:string}>={
  'text-to-image':{label:'Create image',command:'/create-image'},
  'text-to-video':{label:'Create video',command:'/create-video'},
  'reference-to-video':{label:'Animate image',command:'/animate-image'},
};
function remembered(key:string){try{return sessionStorage.getItem('seed.chat.'+key)??'';}catch{return '';}}
function remember(key:string,value:string){try{sessionStorage.setItem('seed.chat.'+key,value);}catch{/* Server history remains durable. */}}
type AssetContext={id:string;name:string;kind:'image'|'video'|'audio';note:string;metadata?:{duration?:number}};
type View=ChatView&{asset_manifest?:AssetContext[];jobs:Array<{id:string;state:string;seed:string;outputs:string[];error:string|null;request:ImageRequest}>;accounting:Array<{cost:number|null}>};
async function api(url:string,method='GET',body?:unknown){const response=await fetch('/api/v1/'+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const result=await response.json();if(!response.ok)throw Error(result.error?.message??'Request failed.');return result;}

export function Chat(){
  const {spicy}=useSpicy(),mode=spicy?'nsfw':'sfw';
  const [list,setList]=useState<Array<{id:string;title:string;activity:string;error:string|null;status?:string}>>([]);
  const [id,setId]=useState<string|null>(null),[chat,setChat]=useState<View|null>(null);
  const [text,setText]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[configured,setConfigured]=useState(true);
  const [gallery,setGallery]=useState(false),[review,setReview]=useState<{card:ChatCard;revision:ChatRevision}|null>(null);
  const [preview,setPreview]=useState<(PreviewMedia&{id:string})|null>(null),[sequence,setSequence]=useState<string|null>(null);
  const [deleting,setDeleting]=useState(false),[rename,setRename]=useState<string|null>(null);
  const refs=useReferences(),file=useRef<HTMLInputElement>(null);
  const currentId=useRef(id);currentId.current=id;
  const generation=useRef(0),composer=useRef<HTMLTextAreaElement>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const drafts=useRef<Record<string,string>>({});
  const history=useRef<HTMLDivElement>(null),follow=useRef(true);
  useEffect(()=>{follow.current=true;},[id]);
  const historyVersion=chat?JSON.stringify([chat.messages.at(-1)?.id,chat.partial,chat.groups.map(g=>[g.state,g.cards.map(c=>c.revisions.at(-1)?.number)]),chat.jobs.map(j=>[j.state,j.outputs.length])]):'';
  useEffect(()=>{if(follow.current&&history.current)history.current.scrollTop=history.current.scrollHeight;},[historyVersion]);
  const busy=saving||Boolean(chat&&chat.activity!=='idle');
  useEffect(()=>{let disposed=false;const epoch=++generation.current;
    const restored=remembered('selected.'+mode)||null;currentId.current=restored;
    setList([]);setId(restored);setChat(null);setText(restored?remembered('draft.'+restored):'');setReview(null);setPreview(null);setSequence(null);setGallery(false);setSelected([]);setRename(null);setDeleting(false);
    void api('chat-config').then(v=>{if(!disposed)setConfigured(v.configured);}).catch(()=>{});
    async function refresh(){try{const value=await api('chats?mode='+mode);if(!disposed)setList(value.items);const active=currentId.current;if(active){const value=await api('chats/'+active);if(!disposed&&epoch===generation.current&&active===currentId.current&&value.mode===mode)setChat(value);}}catch(e){if(!disposed)setError((e as Error).message);}}
    void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{disposed=true;clearInterval(timer);};
  },[mode]);
  useEffect(()=>{if(id)remember('draft.'+id,text);},[id,text]);
  async function act(fn:()=>Promise<any>){setSaving(true);setError('');const epoch=generation.current;try{const value=await fn();if(epoch===generation.current&&value?.id===currentId.current)setChat(value);return value;}catch(e){if(epoch===generation.current)setError((e as Error).message);return null;}finally{setSaving(false);}}
  async function open(next:string){if(id)drafts.current[id]=text;remember('selected.'+mode,next);currentId.current=next;setId(next);setChat(null);setText(drafts.current[next]??remembered('draft.'+next));setSelected([]);refs.reset('video');setReview(null);const value=await act(()=>api('chats/'+next));if(value&&currentId.current===next)setChat(value);}
  async function create(){const value=await act(()=>api('chats','POST',{mode}));if(value){remember('selected.'+mode,value.id);setId(value.id);currentId.current=value.id;setChat(value);setText('');setSelected([]);refs.reset('video');}}
  async function settings(values:object){if(chat)return act(()=>api('chats/'+chat.id,'PATCH',{version:chat.version,...values}));}
  async function send(message=text,card?:ChatCard,revision?:number){if(!chat||busy)return;
    follow.current=true;
    const command=message.trim().split(/\s+/)[0],entry=Object.entries(workflows).find(([,w])=>w.command===command);
    let current=chat;
    if(entry){const changed=await settings({workflow:entry[0]});if(!changed)return;current=changed;message=message.trim().slice(command!.length).trim();if(!message){setText('');return;}}
    if(card&&card.workflow!==current.workflow){const changed=await settings({workflow:card.workflow});if(!changed)return;current=changed;}
    const value=await act(()=>api('chats/'+current.id+'/messages','POST',{version:current.version,text:message,assets:[...new Set([...selected,...refs.groups.video.map(r=>r.asset_id!)])],...(card?{card_id:card.id,revision}: {})}));
    if(value){setText('');setSelected([]);refs.reset('video');setReview(null);composer.current?.focus();}
  }
  async function show(assetId:string){const value=await act(()=>api('assets/'+assetId));if(value)setPreview({id:assetId,name:'Conversation asset',url:'/api/v1/assets/'+assetId+'/content',kind:value.kind,type:value.mime_type??'',width:value.width,height:value.height,duration:value.duration});}
  const target=review&&chat?.groups.flatMap(g=>g.cards).find(c=>c.id===review.card.id);
  const openGroup=chat?.groups.find(g=>!['released','stopped'].includes(g.state));
  return <section className="chat-layout">
    <aside className="chat-sidebar"><button onClick={()=>void create()} disabled={saving}>New chat</button>{list.map(item=><button key={item.id} aria-label={'Open chat: '+item.title} className={item.id===id?'selected':''} onClick={()=>void open(item.id)}>{item.title}<small>{item.activity!=='idle'?item.activity:item.error?'Needs attention':item.status}</small></button>)}</aside>
    <div className="chat-main">
      {!configured&&<p>Set up Chat with <code>seed setup --chat-only</code>.</p>}
      {error&&<p role="alert">{error}</p>}
      {!chat?<div className="chat-empty"><h1>Direct your next creation</h1><p>Start a chat, choose a workflow, and describe what you have in mind.</p></div>:<>
        <header className="chat-header"><h1>{chat.title}</h1><button disabled={busy} onClick={()=>setRename(chat.title)}>Rename</button><button onClick={()=>setDeleting(true)}>Delete</button></header>
        {rename!==null&&<form onSubmit={e=>{e.preventDefault();void settings({title:rename}).then(value=>{if(value)setRename(null);});}}><input aria-label="Chat title" value={rename} maxLength={120} onChange={e=>setRename(e.target.value)}/><button>Save name</button><button type="button" onClick={()=>setRename(null)}>Cancel</button></form>}
        <div ref={history} className="chat-history" aria-live="polite" onScroll={()=>{const element=history.current;if(element)follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<60;}}>
          {chat.messages.map(message=><article className={'chat-message '+message.role} key={message.id}><small>{message.role==='user'?'You':message.role==='assistant'?'Seed':'Workflow'}</small><p>{message.text}</p>{message.assets.map(asset=>{const info=chat.asset_manifest?.find(a=>a.id===asset);return <span className="chat-attachment" key={asset}><button onClick={()=>void show(asset)}>{info?.kind==='image'&&<img src={'/api/v1/assets/'+asset+'/content'} alt=""/>}{info?.name??'Open attached asset'}</button>{info?.note&&<small>{info.note}</small>}<button onClick={()=>setSelected(current=>current.includes(asset)?current.filter(v=>v!==asset):[...current,asset])}>{selected.includes(asset)?'Selected':'Use in next message'}</button></span>;})}</article>)}
          {chat.groups.map(group=><section className="chat-group" key={group.id}><small>{workflows[group.workflow].label} · {group.state}</small>{group.cards.map(card=>{const revision=card.revisions.at(-1)!;return <article className="chat-card" key={card.id}>
            <div><strong>{workflows[card.workflow].label}</strong><span>Revision {revision.number} · {revision.decision} · {revision.request.count} output(s)</span></div><p>{revision.request.prompt}</p>
            <button onClick={()=>setReview({card,revision})}>Review / history</button>
            {group.state==='reviewing'&&<button disabled={busy} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/decision`,'POST',{revision:revision.number,decision:'denied'}))}>Deny</button>}
            {['released','stopped'].includes(group.state)&&<><button disabled={busy||Boolean(openGroup)} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/repeat`,'POST',{revision:revision.number,fresh:false}))}>Repeat</button><button disabled={busy||Boolean(openGroup)} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/repeat`,'POST',{revision:revision.number,fresh:true}))}>New seed variation</button></>}
            {revision.job_ids.map(jobId=>{const job=chat.jobs.find(j=>j.id===jobId);return job&&<div key={jobId}><small>{job.state} · seed {job.seed}</small>{job.error&&<p>{job.error}</p>}{job.request.output.format==='images'&&job.outputs.length?<button onClick={()=>setSequence(job.id)}>Open {job.outputs.length} frames</button>:job.outputs.map(asset=><div key={asset} className="chat-output"><button onClick={()=>void show(asset)}>{job.request.workflow==='text-to-image'?<img src={'/api/v1/assets/'+asset+'/content'} alt="Generated image"/>:<video src={'/api/v1/assets/'+asset+'/content'} muted preload="metadata"/>}</button><button onClick={()=>setSelected(current=>current.includes(asset)?current:[...current,asset])}>Use in next message</button></div>)}{job.state==='failed'&&<button disabled={busy||Boolean(openGroup)} onClick={()=>void act(()=>api(`chats/${chat.id}/cards/${card.id}/repeat`,'POST',{revision:revision.number,fresh:false,failed_only:true}))}>Retry failed jobs</button>}</div>;})}
          </article>;})}</section>)}
          {chat.partial&&<article className="chat-message assistant"><small>Seed</small><p>{chat.partial}</p></article>}
          {chat.error&&<p role="alert">{chat.error}</p>}
          {chat.activity!=='idle'&&<p role="status">{chat.activity==='thinking'?'Thinking…':chat.activity==='preparing'?'Preparing approved requests…':'Generating…'}</p>}
        </div>
        <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void refs.add('video',Array.from(e.dataTransfer.files));}}>
          <div className="chat-composer-tools"><select aria-label="Workflow" value={chat.workflow??''} disabled={busy} onChange={e=>void settings({workflow:e.target.value||null})}><option value="">Choose workflow</option>{Object.entries(workflows).map(([id,w])=><option key={id} value={id}>{w.label} · {w.command}</option>)}</select><label><input type="checkbox" checked={chat.reasoning} disabled={busy} onChange={e=>void settings({reasoning:e.target.checked})}/> Reasoning</label></div>
          <textarea ref={composer} aria-label="Chat message" value={text} maxLength={16000} placeholder="Give direction, or choose a workflow with /…" onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}} onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length&&!busy){e.preventDefault();void refs.add('video',files);}}}/>
          {refs.groups.video.map(ref=><button type="button" key={ref.id} onClick={()=>refs.remove('video',ref.id)}>{ref.name} ×</button>)}{selected.map(asset=><button type="button" key={asset} onClick={()=>setSelected(current=>current.filter(v=>v!==asset))}>Selected asset ×</button>)}
          {refs.errors.video.map((error,i)=><p role="alert" key={i}>{error}</p>)}
          <div><input ref={file} hidden type="file" multiple accept="image/*,video/*,audio/*" onChange={e=>{void refs.add('video',Array.from(e.target.files??[]));e.target.value='';}}/><button type="button" disabled={busy||refs.busy} onClick={()=>file.current?.click()}>{refs.busy?'Uploading…':'Upload'}</button><button type="button" disabled={busy||refs.busy} onClick={()=>setGallery(true)}>Library</button><button disabled={busy||refs.busy||!text.trim()||!configured}>Send</button><button type="button" onClick={()=>void act(()=>api('chats/'+chat.id+'/stop','POST',{}))}>Stop</button></div>
        </form>
      </>}
    </div>
    {gallery&&<GalleryPicker group="video" existing={refs.groups.video} onClose={()=>setGallery(false)} onSelect={async assets=>{await refs.add('video',assets);setGallery(false);}}/>}
    {refs.notes.length>0&&<NoteModal ids={refs.notes} close={refs.dismissNotes}/>}
    {preview&&<MediaPreview media={preview} onClose={()=>setPreview(null)} controls={<AssetNote id={preview.id}/>}/>}
    {sequence&&<FrameViewer id={sequence} onClose={()=>setSequence(null)}/>}
    {review&&chat&&target&&<Review key={review.card.id} card={target} initial={review.revision} assets={chat.asset_manifest??[]} mode={chat.mode} busy={busy} editable={openGroup?.cards.some(c=>c.id===target.id)??false} activeWorkflow={chat.workflow} close={()=>setReview(null)}
      save={async request=>{const result=await act(()=>api(`chats/${chat.id}/cards/${target.id}/revise`,'POST',{revision:target.revisions.at(-1)!.number,request}));if(result){const card=result.groups.flatMap((g:any)=>g.cards).find((c:any)=>c.id===target.id);setReview({card,revision:card.revisions.at(-1)});}return Boolean(result);}}
      approve={async()=>{const result=await act(()=>api(`chats/${chat.id}/cards/${target.id}/decision`,'POST',{revision:target.revisions.at(-1)!.number,decision:'approved'}));if(result)setReview(null);}}
      restore={async(revision,request)=>{const value=await act(()=>api(`chats/${chat.id}/cards/${target.id}/restore`,'POST',{revision,request}));if(value)setReview(null);}}
      stop={()=>{void act(()=>api('chats/'+chat.id+'/stop','POST',{}));setReview(null);}}
      feedback={(message)=>send(message,target,target.revisions.at(-1)!.number)} />}
    {deleting&&chat&&<ConfirmDialog title="Delete chat?" description="Uploaded and generated media stays in Library." action="Delete chat" onClose={()=>setDeleting(false)} onConfirm={async()=>{await api('chats/'+chat.id,'DELETE');remember('selected.'+mode,'');setDeleting(false);setId(null);currentId.current=null;setChat(null);}}/>}
  </section>;
}

function Review({card,initial,assets,mode,busy,editable,activeWorkflow,close,save,approve,feedback,restore,stop}:{card:ChatCard;initial:ChatRevision;assets:AssetContext[];mode:'sfw'|'nsfw';busy:boolean;editable:boolean;activeWorkflow:ChatWorkflow|null;close:()=>void;save:(request:unknown)=>Promise<boolean>;approve:()=>Promise<void>;feedback:(text:string)=>Promise<void>;restore:(revision:number,request:unknown)=>Promise<void>;stop:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[revision,setRevision]=useState(initial.number),[request,setRequest]=useState(initial.request),[message,setMessage]=useState('');
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  useEffect(()=>{setRevision(initial.number);setRequest(initial.request);},[initial.number]);
  const change=(values:Partial<ImageRequest>)=>setRequest(v=>({...v,...values}));
  const dirty=JSON.stringify(request)!==JSON.stringify(card.revisions.at(-1)!.request)||revision!==card.revisions.at(-1)!.number;
  const raw=()=>{const value:any={...request};delete value.workflow;delete value.capabilities_revision;if(mode==='sfw')delete value.mode;return value;};
  return <dialog ref={dialog} className="chat-review" onCancel={close} aria-label="Review generation"><header><h2>{workflows[card.workflow].label}</h2>{busy&&<button onClick={stop}>Stop</button>}<button onClick={close}>Close</button></header>
    <label>Revision<select value={revision} onChange={e=>{const value=card.revisions.find(r=>r.number===Number(e.target.value))!;setRevision(value.number);setRequest(value.request);}}>{card.revisions.map(r=><option key={r.number} value={r.number}>{r.number} · {r.decision}</option>)}</select></label>
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
      {editable?<><button onClick={()=>void save(raw())}>Save as latest revision</button><button disabled={dirty} onClick={()=>void approve()}>Generate · approve this revision</button>{dirty&&<p>Save your changes before approving or sending feedback.</p>}</>:<button onClick={()=>void restore(revision,raw())}>Restore as new request</button>}
    </fieldset>
    {editable&&<form onSubmit={e=>{e.preventDefault();if(!dirty)void feedback(message);}}><label>Provide feedback<textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(message.trim()&&!busy&&!dirty)void feedback(message);}}}/></label><button disabled={busy||dirty||!message.trim()}>{activeWorkflow===card.workflow?'Send feedback':'Switch workflow and send feedback'}</button></form>}
  </dialog>;
}
