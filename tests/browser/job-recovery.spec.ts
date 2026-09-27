import {test,expect,type Page} from './fixtures.js';
import type {Route} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {JobRecord} from '../../shared/jobs.js';

const created='2026-09-26T12:00:00.000Z';
const request={workflow:'text-to-image' as const,prompt:'A synthetic watercolor landscape',mode:'sfw' as const,output:{aspect:'16:9' as const,size:'1mp' as const},seed:'42',count:1};
const unknown=():JobRecord=>({id:'unknown-output',submission_id:'fixture-request',submission_index:0,request,seed:'42',state:'needs_attention',outputs:[],error:'The assigned worker has no receipt for this request.',created_at:created,updated_at:created,worker:{id:'original-worker'},uncertainty_acknowledged:true,recovery:{pending:false,action:'retry',reason:'submission_unknown',worker_id:'original-worker'}});
const root=path.resolve(process.env.SEED_RECOVERY_ATLAS_ROOT??'.local/job-recovery-atlas');
const catalog = [
 ['601','Job recovery','Unknown request on the original worker'],
 ['602','Workers','Selected original worker needs attention'],
 ['603','Job recovery','Recovery pending without a second submission'],
 ['604','Job recovery','Recovered request stays on the same output'],
 ['605','Generate','Mixed batch selects the issue and reports recovery errors'],
 ['606','Chat','Chat uses the shared original-request recovery'],
 ['607','Job recovery','Unavailable saved submission blocks replay'],
] as const;

async function fixture(page:Page){
 const state={jobs:[unknown()],writes:[] as {path:string;body:unknown}[],recover:undefined as undefined|((route:Route)=>Promise<void>)};
 const worker=(id:string,attention=false)=>({id,launch_id:id,provider:'vast',worker_class:'image',gpu:attention?'Original GPU':'Other GPU',vram_gb:24,region:'Fixture',state:attention?'needs_attention':'ready',hourly:1,compute_hourly:1,storage_hourly:0,estimated_spend:.1,elapsed_seconds:360,created_at:created,ready_at:created,current_job_id:attention?'unknown-output':undefined,current_activity:attention?'Request status unknown':undefined,installed_loras:[],actions:attention?['reconnect','finish','quit']:['finish','quit'],console_url:''});
 await page.addInitScript(()=>{(window as any).EventSource=class{close(){}};});
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),pathname=url.pathname;
  if(req.method()!=='GET')state.writes.push({path:pathname,body:req.postDataJSON()});
  if(pathname.endsWith('/recover'))return state.recover?state.recover(route):route.fulfill({status:409,json:{error:{message:'This request still needs a worker check.'}}});
  if(pathname==='/api/v1/jobs')return route.fulfill({status:req.method()==='POST'?202:200,json:req.method()==='POST'?{jobs:state.jobs}:{items:state.jobs}});
  if(pathname==='/api/v1/studio')return route.fulfill({json:{pool:{active:2,ready:1,busy:0,preparing:0,needs_attention:1,hourly:2,estimated_spend:.2,image:2,video:0},activity:{active:0,waiting:0,needs_attention:1},outputs:{pending:0}}});
  if(pathname==='/api/v1/chat-config')return route.fulfill({json:{configured:true}});
  if(pathname.endsWith('/startup-logs'))return route.fulfill({json:{worker_id:pathname.split('/').at(-2),revision:1,phase:'complete',collection:'sealed',availability:'unavailable',sealed_at:created,sealed_reason:'legacy',truncated:false,sections:[]}});
  if(pathname==='/api/v1/pool')return route.fulfill({json:{server_time:created,workers:[worker('other-worker'),worker('original-worker',true)],summary:{active:2,ready:1,busy:0,preparing:0,needs_attention:1,hourly:2,estimated_spend:.2,image:2,video:0}}});
  if(pathname.startsWith('/api/v1/chats')){
   const chat={id:'fixture-chat',title:'Recovery fixture',mode:'sfw',workflow:'text-to-image',version:1,epoch:0,activity:'idle',reasoning:false,error:null,assets:[],asset_manifest:[],accounting:[],created_at:created,updated_at:created,jobs:state.jobs,messages:[{id:'fixture-message',role:'user',text:'Create a landscape.',assets:[],created_at:created}],groups:[{id:'fixture-group',after_message_id:'fixture-message',workflow:'text-to-image',state:'released',cards:[{id:'fixture-card',workflow:'text-to-image',revisions:[{number:1,request,notes:{},decision:'approved',approved_snapshot:true,job_ids:state.jobs.map(job=>job.id)}]}]}]};
   return route.fulfill({json:pathname==='/api/v1/chats'?{items:[chat]}:chat});
  }
  return route.fulfill({json:{items:[]}});
 });
 return state;
}
async function activity(page:Page){
 if(!await page.getByRole('button',{name:/^Activity/}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
 await page.getByRole('button',{name:/^Activity/}).click();
 await page.getByRole('button',{name:'Resolve issue',exact:true}).first().click();
 return page.getByRole('dialog',{name:'Request details',exact:true});
}
async function capture(page:Page,device:string,id:string,title:string){
 await mkdir(path.join(root,device),{recursive:true});
 await page.evaluate(async()=>{await document.fonts.ready;});
 const file=`${device}/${id}.png`;
 await page.screenshot({path:path.join(root,file),animations:'disabled'});
 await writeFile(path.join(root,device,id+'.json'),JSON.stringify({id,title,surface:'Job recovery',device,viewport:page.viewportSize(),file,status:'passed',run_id:process.env.SEED_ATLAS_RUN_ID},null,2));
}

for(const device of ['desktop','mobile'] as const)test.describe(device,()=>{
 test.use({viewport:device==='desktop'?{width:1440,height:1000}:{width:390,height:844},isMobile:device==='mobile',hasTouch:device==='mobile'});
 test('unknown recovery retains attention, original worker and pending state across refresh',async({page})=>{
  const f=await fixture(page);await page.goto('/');
  let details=await activity(page);
  await expect(details.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();
  await expect(details.getByRole('button',{name:'I reviewed the worker status',exact:true})).toHaveCount(0);
  await capture(page,device,'601','Unknown request on the original worker');
  await details.getByRole('button',{name:'View worker',exact:true}).click();
  const workers=page.getByRole('dialog',{name:'GPU workers',exact:true});
  await expect(workers.locator('.pool-worker.selected')).toContainText('Original GPU');
  await expect(workers.locator('.pool-worker.selected')).toContainText('Request status unknown');
  await expect(workers.locator('.pool-worker.selected .worker-state')).not.toContainText('Generating');
  await expect(workers.locator('.pool-worker.selected')).toContainText('Startup logs unavailable');
  await workers.locator('.pool-worker.selected').scrollIntoViewIfNeeded();
  await capture(page,device,'602','Selected original worker needs attention');
  await workers.getByRole('button',{name:'Close GPU workers',exact:true}).click();
  details=await activity(page);
  // Return the accepted snapshot while deliberately keeping the next list read stale.
  f.recover=route=>route.fulfill({status:202,json:{...unknown(),recovery:{...unknown().recovery,pending:true}}});
  await details.getByRole('button',{name:'Retry',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  await expect(details.getByRole('button',{name:'Checking worker…',exact:true})).toBeDisabled();
  await expect(details.getByRole('status')).toContainText('Checking the original worker');
  await capture(page,device,'603','Recovery pending without a second submission');
  expect(f.writes).toEqual([{path:'/api/v1/jobs/unknown-output/recover',body:{}}]);
  f.jobs=[{...unknown(),recovery:{...unknown().recovery!,pending:true}}];
  await page.reload();details=await activity(page);
  await expect(details.getByRole('button',{name:'Checking worker…',exact:true})).toBeDisabled();
  f.jobs=[{...unknown(),state:'running',error:null,recovery:undefined,updated_at:'2026-09-26T12:00:02.000Z'}];
  await expect(details.locator('.job-output-detail')).toContainText('Generating');
  await expect(details.locator('.job-output-detail')).toContainText('Seed 42');
  await expect(details.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
  await capture(page,device,'604','Recovered request stays on the same output');
  expect(f.writes).toHaveLength(1);
 });
 test('Generate opens the unknown output before an active sibling and keeps errors local',async({page})=>{
  const f=await fixture(page);f.jobs=[{...unknown(),id:'active-output',submission_index:0,state:'running',recovery:undefined}, {...unknown(),submission_index:1}];
  await page.goto('/');await page.getByLabel('Prompt',{exact:true}).fill(request.prompt);await page.getByRole('button',{name:/^Create image/}).click();
  await page.getByRole('button',{name:'View issue',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Request details',exact:true});
  await expect(details.locator('.job-output-tile.selected')).toHaveAttribute('aria-label','Select output: Status unknown');
  await details.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(details.getByRole('alert')).toHaveText('This request still needs a worker check.');
  await expect(details.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();
  await capture(page,device,'605','Mixed batch selects the issue and reports recovery errors');
  await details.getByRole('button',{name:'Select output: Generating',exact:true}).click();
  await expect(details.getByRole('alert')).toHaveCount(0);
  expect(f.writes.map(item=>item.path)).toEqual(['/api/v1/jobs','/api/v1/jobs/unknown-output/recover']);
 });
 test('a late accepted recovery response cannot replace a newer job snapshot',async({page})=>{
  const f=await fixture(page);let release!:()=>void;
  const held=new Promise<void>(resolve=>release=resolve);
  f.recover=async route=>{await held;await route.fulfill({status:202,json:{...unknown(),recovery:{...unknown().recovery,pending:true}}});};
  await page.goto('/');const details=await activity(page);
  const sent=page.waitForRequest(req=>req.url().endsWith('/recover'));
  await details.getByRole('button',{name:'Retry',exact:true}).click();await sent;
  f.jobs=[{...unknown(),state:'running',error:null,recovery:undefined,updated_at:'2026-09-26T12:00:03.000Z'}];
  await expect(details.locator('.job-output-detail')).toContainText('Generating');
  const response=page.waitForResponse(res=>res.url().endsWith('/recover'));release();await response;
  await expect(details.getByRole('button',{name:'Checking worker…',exact:true})).toHaveCount(0);
  await expect(details.locator('.job-output-detail')).toContainText('Generating');
  expect(f.writes).toEqual([{path:'/api/v1/jobs/unknown-output/recover',body:{}}]);
 });
 test('Chat shares recovery while historical acknowledged issues stay quiet',async({page})=>{
  const f=await fixture(page);f.jobs[0]!.source={chat_id:'fixture-chat',card_id:'fixture-card',revision:1};
  await page.goto('/chat?chat=fixture-chat');await page.getByRole('button',{name:'Resolve issue',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Request details',exact:true});
  await expect(details.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();
  await capture(page,device,'606','Chat uses the shared original-request recovery');
  await details.getByRole('button',{name:'Close request details',exact:true}).click();
  f.jobs=[{...unknown(),worker:undefined,recovery:undefined}];
  await page.goto('/');
  if(!await page.getByRole('button',{name:/^Activity/}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:/^Activity/}).click();
  const history=page.getByRole('dialog',{name:'Activity',exact:true});
  await expect(history.getByRole('button',{name:'Resolve issue',exact:true})).toHaveCount(0);
  expect(f.writes).toEqual([]);
 });
 test('ineligible unknown requests explain the reason without a blind Retry',async({page})=>{
  const f=await fixture(page);f.jobs=[{...unknown(),recovery:{pending:false,reason:'submission_unavailable',worker_id:'original-worker'}}];
  await page.goto('/');const details=await activity(page);
  await expect(details).toContainText('The saved submission is incomplete.');
  await expect(details.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
  await expect(details.getByRole('button',{name:'View worker',exact:true})).toBeEnabled();
  await capture(page,device,'607','Unavailable saved submission blocks replay');
 });
});

for(const [width,height] of [[320,568],[844,390]])test(`recovery controls fit ${width} by ${height}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await fixture(page);await page.goto('/');
 const details=await activity(page);
 const retry=details.getByRole('button',{name:'Retry',exact:true});await retry.scrollIntoViewIfNeeded();
 expect(await details.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await expect(retry).toBeInViewport();
 await capture(page,`boundary-${width}`,'608','Recovery actions remain reachable');
});
