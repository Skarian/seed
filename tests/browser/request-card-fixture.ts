import { expect, type Page } from './fixtures.js';
import type { GenerationRequest, InputReference } from '../../shared/generation.js';
import { readFile } from 'node:fs/promises';

export type Workflow = GenerationRequest['workflow'];
export type CardState = 'reviewing' | 'approved' | 'denied' | 'queued' | 'running' | 'failed' | 'completed' | 'revising' | 'stopped' | 'history' | 'branch' | 'feedback' | 'review' | 'preparing' | 'start-failed' | 'interrupted' | 'legacy' | 'stopped-approved' | 'waiting-many' | 'review-retry';
type FixtureOptions = { sourceChat?: boolean; references?: number; delayJob?: () => Promise<void>; delayChat?: () => Promise<void>; historyMessages?: number; siblings?: number };
type FixtureAction = { path: string; body: any; cardId: string | undefined };
export const names = {
  none: [],
  short: [{ name: 'Ink' }],
  medium: [{ name: 'Studio Krea 2', version: 'Krea 2 v1.4' }],
  long: [{ name: 'Cinematic watercolor illustration with delicate botanical details', version: 'Studio edition version 2026.09' }],
  unbroken: [{ name: 'CinematicWatercolorIllustrationWithDelicateBotanicalDetailsAndNaturalLightVersion202609Final' }],
  multilingual: [{ name: '水彩画と自然光 · Étude cinématographique 🌿', version: 'édition complète' }],
  multiple: [{ name: 'Ink' }, { name: 'Cinematic watercolor illustration with delicate botanical details', version: 'v2.1' }, { name: 'NaturalLightPortraitStyleWithHandPaintedBotanicalDetails' }],
  missing: [{ name: 'Unavailable adapter', missing: true }],
} as const;
export type Profile = keyof typeof names;
const timestamp = '2026-09-24T01:00:00Z';
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#536c7c"/><circle cx="320" cy="200" r="120" fill="#d7b393"/></svg>';

/** Real application components, deterministic API contracts; no provider or model calls. */
export async function cardFixture(page: Page, workflow: Workflow, profile: Profile = 'none', state: CardState = 'reviewing', options: FixtureOptions = {}) {
  const errors: string[] = [], writes: Array<{ path: string; body: any }> = [];
  page.on('pageerror', error => errors.push(error.message));
  const count = options.references ?? (workflow === 'image-to-image' ? 2 : workflow === 'reference-to-video' ? 3 : workflow === 'text-to-video' ? 1 : 0);
  const references: InputReference[] = Array.from({ length: count }, (_, index) => ({ id: 'slot-' + index, asset_id: 'input-' + index, kind: 'image', role: workflow === 'image-to-image' && !index ? 'source' : workflow === 'text-to-video' && !index ? 'first_frame' : 'reference' }));
  const entries = names[profile].map((entry, index) => ({ id: 'adapter-' + index, revision: 'revision-' + index, route: workflow === 'text-to-image' ? 'image' : workflow === 'text-to-video' ? 'fl' : 'ref', availability: 'all', compatibility: 'verified', ...entry }));
  const request: GenerationRequest = {
    workflow, mode: 'sfw', prompt: 'Keep the subject, change the lighting.', seed: '42', count: 1, references,
    loras: entries.map((entry, index) => ({ id: entry.id, revision: entry.revision, scale: [1, 0.65, 1.25][index]! })),
    output: workflow === 'image-to-image' ? { aspect: 'source', size: '1mp' } : workflow === 'text-to-image' ? { aspect: '16:9', size: '1mp' } : { aspect: '16:9', size: '768p', format: 'video', duration_seconds: 5 },
  } as GenerationRequest;
  const hasJob = ['queued', 'running', 'failed', 'completed', 'branch'].includes(state);
  const job = { id: 'card-job', submission_id: 'card-submission', submission_index: 0, state: state === 'branch' ? 'completed' : state, request, seed: '42', outputs: ['completed', 'branch'].includes(state) ? ['output-image'] : [], ...(options.sourceChat === false ? {} : { source: { chat_id: 'card-chat', card_id: 'card', revision: 1 } }), input_snapshot: [], created_at: timestamp, updated_at: timestamp };
  const approved = hasJob || ['approved','preparing','start-failed','interrupted','legacy','stopped-approved','waiting-many','review-retry'].includes(state);
  const revision = { number: 1, request: approved ? {...request, resolved_seeds:['42']} : request, notes: {}, decision: approved ? 'approved' : state === 'denied' ? 'denied' : 'undecided', ...(approved?{approved_snapshot:true}:{}), job_ids: hasJob ? [job.id] : [] };
  const card = { id: 'card', workflow, revisions: state === 'history' ? [revision, { ...revision, number: 2 }] : [revision] };
  const empty = { id: 'card-chat', title: 'Card layout review', mode: 'sfw', workflow, version: 1, epoch: 0, reasoning: true, activity: 'idle', error: null, accounting: [], created_at: timestamp, updated_at: timestamp };
  let chat: any = { ...empty, assets: references.map(r => r.asset_id), asset_manifest: references.map(r => ({ id: r.asset_id, name: 'Reference image', kind: r.kind, note: '' })), jobs: hasJob ? [job] : [], groups: [{ id: 'group', after_message_id: 'message', workflow, state: hasJob || state === 'denied' ? 'released' : state === 'stopped' ? 'stopped' : state === 'revising' ? 'revising' : 'reviewing', cards: [card] }], messages: [{ id: 'message', role: 'user', text: 'Create a lighting study.', assets: [], created_at: timestamp }] };
  const siblings=options.siblings??(state==='approved'?1:state==='waiting-many'?2:0);
  for(let index=0;index<siblings;index++)chat.groups[0].cards.push({id:'sibling-'+index,workflow,revisions:[{...structuredClone(revision),approved_snapshot:false,decision:'undecided',job_ids:[],request:{...structuredClone(request),prompt:'Synthetic sibling proposal '+(index+1)+'.',seed:String(43+index)}}]});
  if(state==='preparing')chat.activity='preparing';
  if(state==='stopped-approved')chat.groups[0].state='stopped';
  if(['start-failed','review-retry'].includes(state))chat.groups[0].submission_error='An input could not be prepared. Check the selected references and retry.';
  if(state==='interrupted')chat.groups[0].submission_error='Preparation was interrupted by a server restart. Retry to continue.';
  if(state==='legacy')chat.groups[0].submission_error='These approved requests did not start. Retry to continue.';
  if(options.historyMessages)chat.messages.unshift(...Array.from({length:options.historyMessages},(_,index)=>({id:'history-'+index,role:index%2?'assistant':'user',text:index%2?'Synthetic planning response '+index+'.':'Synthetic lighting discussion '+index+'.',assets:[],created_at:timestamp})));
  let decisionHandler: ((action:FixtureAction)=>Promise<void>|void)|undefined;
  let readHandler: ((snapshot:any)=>Promise<any>|any)|undefined;
  const blank = { ...empty, id: 'new-chat', title: 'New conversation', assets: [], asset_manifest: [], jobs: [], groups: [], messages: [] };
  await page.addInitScript(() => {
    (window as any).__cardFixtureStreams=new Map();
    (window as any).EventSource=class {
      onmessage:((event:{data:string})=>void)|null=null;
      constructor(private url:string){(window as any).__cardFixtureStreams.set(url,this);}
      close(){(window as any).__cardFixtureStreams.delete(this.url);}
    };
  });
  await page.route('**/api/v1/chat-config', r => r.fulfill({ json: { configured: true } }));
  await page.route('**/api/v1/loras*', r => r.fulfill({ json: { items: entries.filter(e => !('missing' in e && e.missing)) } }));
  await page.route('**/api/v1/pool', r => r.fulfill({ json: { server_time: timestamp, workers: [], summary: { active: 0, ready: 0, busy: 0, preparing: 0, needs_attention: 0, hourly: 0, estimated_spend: 0, image: 0, video: 0 } } }));
  await page.route('**/api/v1/pool/offers**',r=>r.fulfill({json:{items:[],issues:[]}}));
  const videoOutput = workflow === 'text-to-video' || workflow === 'reference-to-video';
  await page.route('**/api/v1/assets/*', r => {
    const id = new URL(r.request().url()).pathname.split('/').at(-1), video = id === 'output-image' && videoOutput;
    return r.fulfill({json:{id,kind:video?'video':'image',name:video?'Completed video':'Reference image',mime_type:video?'video/mp4':'image/svg+xml',width:640,height:480}});
  });
  await page.route('**/api/v1/assets/*/content*', async r => r.request().url().includes('/output-image/') && videoOutput
    ? r.fulfill({contentType:'video/mp4',body:await readFile('.local/browser-preview.mp4')})
    : r.fulfill({contentType:'image/svg+xml',body:image}));
  await page.route('**/api/v1/jobs/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() !== 'GET') writes.push({ path, body: r.request().postDataJSON() });
    if (path.endsWith('/branch-chat')) {
      chat = { ...chat, id: options.sourceChat === false ? 'new-chat' : chat.id, groups: [{ ...chat.groups[0], state: 'reviewing', cards: [{ ...card, revisions: [{ ...revision, decision: 'undecided', job_ids: [] }] }] }] };
      return r.fulfill({ json: chat });
    }
    await options.delayJob?.();
    return r.fulfill({ json: job });
  });
  await page.route('**/api/v1/chats**', async r => {
    const req = r.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() });
    if (path === '/api/v1/chats' && req.method() === 'GET') return r.fulfill({ json: { items: [chat, blank] } });
    if (path.endsWith('/messages')) chat = { ...chat, version: chat.version + 1, messages: [...chat.messages, { id: 'followup', role: 'user', text: req.postDataJSON().text, assets: [], created_at: timestamp }] };
    if(path.endsWith('/decision'))await decisionHandler?.({path,body:req.postDataJSON(),cardId:path.split('/').at(-2)});
    if(path.endsWith('/stop'))chat={...chat,version:chat.version+1,epoch:chat.epoch+1,activity:'idle',groups:chat.groups.map((group:any)=>group.state==='released'?group:{...group,state:'stopped'})};
    if (path.endsWith('/new-chat') && chat.id !== 'new-chat') return r.fulfill({ json: blank });
    await options.delayChat?.();
    return r.fulfill({ json: req.method()==='GET'&&readHandler?await readHandler(structuredClone(chat)):chat });
  });
  return { errors, writes, request, job, entries,
    snapshot:()=>structuredClone(chat),
    update:(change:(snapshot:any)=>any)=>{chat=change(structuredClone(chat));},
    onDecision:(handler:(action:FixtureAction)=>Promise<void>|void)=>{decisionHandler=handler;},
    onRead:(handler:(snapshot:any)=>Promise<any>|any)=>{readHandler=handler;},
    emit:async(value:unknown)=>page.evaluate(value=>{for(const stream of (window as any).__cardFixtureStreams.values())stream.onmessage?.({data:JSON.stringify(value)});},value),
    async open() {
    await page.goto('/chat?chat=card-chat');
    await expect(page.locator('.chat-group').first()).toBeVisible();
    if (entries.length) await expect(page.locator('.selected-loras').last()).toContainText(profile === 'missing' ? 'LoRA' : entries[0]!.name);
    if (state === 'branch') {
      await page.getByRole('button', { name: 'Create another request', exact: true }).click();
      await page.getByRole('button', { name: 'Branch in Chat', exact: true }).click();
      await page.getByRole('button', { name: 'Same seed', exact: true }).click();
      await expect(page.locator('.branch-draft-preview')).toBeVisible();
    }
    if (state === 'feedback' || state === 'review') {
      await page.getByRole('button', { name: 'Review / history', exact: true }).click();
      if (state === 'feedback') await page.getByRole('button', { name: 'Provide feedback', exact: false }).click();
    }
    if(state==='review-retry')await page.getByRole('button',{name:'View request',exact:true}).click();
  } };
}
