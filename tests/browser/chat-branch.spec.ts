import {test,expect,type Page} from './fixtures.js';
import type {GenerationRequest} from '../../shared/generation.js';
test.use({screenshot:'only-on-failure'});

const workflows=['image-to-image','text-to-image','text-to-video','reference-to-video'] as const;
async function setup(page:Page,workflow:typeof workflows[number],feedback=false){
 const errors:string[]=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message);});
 const writes:Array<{path:string;body:any}>=[];
 const references:NonNullable<GenerationRequest['references']>=workflow==='image-to-image'
  ?[{id:'source-slot',asset_id:'source-image',kind:'image',role:'source'},{id:'style-slot',asset_id:'style-image',kind:'image',role:'reference'}]
  :workflow==='reference-to-video'?[{id:'photo-slot',asset_id:'source-image',kind:'image',role:'reference'},{id:'clip-slot',asset_id:'clip',kind:'video',role:'reference',include_audio:true}]
  :workflow==='text-to-video'?[{id:'frame-slot',asset_id:'source-image',kind:'image',role:'first_frame'}]:[];
 const request={workflow,mode:'sfw',prompt:'Keep the subject, change the lighting.',seed:'42',count:1,references,
  output:workflow==='image-to-image'?{aspect:'source',size:'1mp'}:workflow==='text-to-image'?{aspect:'16:9',size:'1mp'}:{aspect:'16:9',size:'768p',format:'video',duration_seconds:5}};
 const job={id:'branch-job',submission_id:'submission',state:'completed',request,seed:'42',outputs:['output-image'],source:{chat_id:'branch-chat',card_id:'card',revision:1},input_snapshot:[],created_at:'2026-09-24T01:00:00Z',updated_at:'2026-09-24T01:00:30Z'};
 const card={id:'card',workflow,revisions:[{number:1,request,notes:{},decision:feedback?'undecided':'approved',job_ids:feedback?[]:[job.id]}]};
 let chat:any={id:'branch-chat',title:'Branch regression',mode:'sfw',workflow,version:1,epoch:0,reasoning:true,activity:'idle',error:null,
  assets:references.map(r=>r.asset_id),asset_manifest:references.map(r=>({id:r.asset_id,name:r.asset_id,kind:r.kind,note:''})),jobs:feedback?[]:[job],accounting:[],
  groups:[{id:'group',after_message_id:'message',workflow,state:feedback?'reviewing':'released',cards:[card]}],
  messages:[{id:'message',role:'user',text:'Original conversation stays here.',assets:[],created_at:'2026-09-24T01:00:00Z'}]};
 await page.addInitScript(()=>{(window as any).EventSource=class{close(){}}});
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/assets/*',r=>r.fulfill({json:{id:new URL(r.request().url()).pathname.split('/').at(-1),kind:'image',name:'Source image',mime_type:'image/svg+xml',width:640,height:480}}));
 await page.route('**/api/v1/assets/*/content*',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#536c7c"/><circle cx="320" cy="200" r="120" fill="#d7b393"/></svg>'}));
 await page.route('**/api/v1/jobs/**',r=>{
  const req=r.request(),path=new URL(req.url()).pathname;
  if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
  if(path.endsWith('/branch-chat')){
   chat={...chat,groups:[...chat.groups,{id:'draft-group',workflow,state:'reviewing',cards:[{...card,id:'draft-card',revisions:[{...card.revisions[0],decision:'undecided',job_ids:[]}]}]}]};
   return r.fulfill({json:chat});
  }
  return r.fulfill({json:job});
 });
 await page.route('**/api/v1/chats**',r=>{
  const req=r.request(),path=new URL(req.url()).pathname;
  if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
  if(path.endsWith('/messages'))chat={...chat,version:chat.version+1,messages:[...chat.messages,{id:'followup',role:'user',text:req.postDataJSON().text,assets:[],created_at:'2026-09-24T01:01:00Z'}]};
  return r.fulfill({json:path==='/api/v1/chats'?{items:[chat]}:chat});
 });
 await page.goto('/chat?chat=branch-chat');
 await expect(page.getByText('Original conversation stays here.',{exact:true})).toBeVisible();
 return {errors,writes};
}

for(const workflow of workflows)for(const seed of ['Same seed','New seed'])test(`${workflow}: branch in existing chat with ${seed}`,async({page},testInfo)=>{
 const {errors,writes}=await setup(page,workflow);
 await page.getByRole('button',{name:'Create another request',exact:true}).click();
 await page.getByRole('button',{name:'Branch in Chat',exact:true}).click();
 await page.getByRole('button',{name:seed,exact:true}).click();
 await expect(page.locator('.branch-draft-preview')).toBeVisible();
 expect(errors).toEqual([]);
 await expect(page.getByText('Original conversation stays here.',{exact:true})).toBeVisible();
 expect(writes).toEqual([]);
 await page.reload();
 await expect(page.locator('.branch-draft-preview')).toBeVisible();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Draft request',exact:true})).toContainText(seed==='New seed'?'Random':'42');
 await page.getByRole('button',{name:'Close request',exact:true}).click();
 if(workflow==='image-to-image'){
  const editor=page.getByRole('combobox',{name:'Chat message'});
  await editor.fill('@');
  await expect(page.getByRole('option',{name:/^image1/})).toBeVisible();
  await expect(page.getByRole('option',{name:/^image2/})).toBeVisible();
  await page.getByRole('option',{name:/^image1/}).click();
  await page.keyboard.insertText(' Keep the face.');
  await expect(editor.locator('.input-mention')).toContainText('image1');
  await page.screenshot({path:testInfo.outputPath('branch-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(editor).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('branch-mobile.png')});
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.branch-draft-preview')).toHaveCount(0);
  expect(writes.find(w=>w.path.endsWith('/branch-chat'))?.body).toEqual({fresh:seed==='New seed',job_ids:['branch-job'],draft:true});
  expect(writes.find(w=>w.path.endsWith('/messages'))?.body.mention_bindings).toContainEqual({token:'[image1](asset:source-image)',asset_id:'source-image',input_id:'source-slot'});
  await expect(page.locator('.chat-message.user').last().getByRole('button',{name:'image1',exact:true})).toBeVisible();
 }else{
  await page.getByRole('button',{name:'Remove request',exact:true}).click();
  await expect(page.locator('.branch-draft-preview')).toHaveCount(0);
 }
 expect(errors).toEqual([]);
});

test('image editing feedback preserves its source mentions without crashing',async({page})=>{
 const {errors,writes}=await setup(page,'image-to-image',true);
 await page.getByRole('button',{name:'Edit request',exact:true}).click();
 await page.getByRole('button',{name:'↩ Provide feedback',exact:true}).click();
 await expect(page.locator('.feedback-request-tile')).toBeVisible();
 await page.getByRole('combobox',{name:'Chat message'}).fill('@');
 await expect(page.getByRole('option',{name:/^image1/})).toBeVisible();
 await expect(page.getByRole('option',{name:/^image2/})).toBeVisible();
 expect(errors).toEqual([]);expect(writes).toEqual([]);
});

for(const [width,workflow] of [[390,'image-to-image'],[1280,'image-to-image'],[390,'reference-to-video'],[320,'text-to-image']] as const)test(`approval card stays compact: ${workflow} at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:844});
 const {errors,writes}=await setup(page,workflow,true);
 const card=page.locator('.approval-card'),body=card.locator('.request-card-body');
 await expect(card).toBeVisible();
 await expect(card).not.toContainText('Keep the subject, change the lighting.');
 const bounds=await card.boundingBox();
 expect(bounds!.width).toBeLessThan(width<=600?300:500);
 if(width<=600)expect(bounds!.height).toBeLessThan(125);
 expect(await body.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 for(const name of ['Deny','Approve']){
  const button=card.getByRole('button',{name,exact:true});await expect(button).toBeVisible();
  const box=await button.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(box!.x+box!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width);
  if(width<=600)expect(box!.height).toBeGreaterThanOrEqual(44);
 }
 if(width<=600){
  const edit=await card.getByRole('button',{name:'Edit request',exact:true}).first().boundingBox();
  expect(edit!.width).toBeGreaterThanOrEqual(44);expect(edit!.height).toBeGreaterThanOrEqual(44);
  expect(edit!.y).toBeGreaterThanOrEqual(bounds!.y);
  const approve=await card.getByRole('button',{name:'Approve',exact:true}).boundingBox();
  expect(edit!.y+edit!.height).toBeLessThanOrEqual(approve!.y);
 }
 await page.screenshot({path:testInfo.outputPath('approval.png')});
 expect(errors).toEqual([]);expect(writes).toEqual([]);
});
