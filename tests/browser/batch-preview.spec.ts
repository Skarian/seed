import {test,expect,type Page,type APIRequestContext} from './fixtures.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const catalog = [
 ['901','Generate','First output with batch navigation'],
 ['902','Chat','Middle portrait output'],
 ['903','Video','Next video in the batch'],
 ['904','Recovery','Missing output keeps navigation'],
 ['905','Single output','No unnecessary navigation'],
] as const;
const root=path.resolve(process.env.SEED_ATLAS_ROOT??'.local/batch-preview-atlas');
const origin='http://127.0.0.1:4311',headers={Origin:origin};
type Asset={id:string;name:string;kind:'image'|'video'};
async function upload(request:APIRequestContext,kind:Asset['kind'],name:string,body:Buffer):Promise<Asset>{
 const meta=Object.entries({kind,filename:name,filetype:kind==='image'?'image/png':'video/mp4',mode:'sfw'}).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
 const start=await request.post('/api/v1/uploads',{headers:{...headers,'Tus-Resumable':'1.0.0','Upload-Length':String(body.length),'Upload-Metadata':meta}});expect(start.status()).toBe(201);
 const location=start.headers().location!,id=location.split('/').at(-1)!;
 expect((await request.patch(new URL(location,origin).href,{headers:{...headers,'Tus-Resumable':'1.0.0','Upload-Offset':'0','Content-Type':'application/offset+octet-stream'},data:body})).status()).toBe(204);
 await expect.poll(async()=>(await (await request.get('/api/v1/assets/'+id)).json()).state).toBe('ready');return {id,name,kind};
}
async function images(request:APIRequestContext){
 const result:Asset[]=[];
 for(let n=1;n<=3;n++){
  const w=n===2?600:960,h=n===2?900:640;
  const art=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${n===2?'#dadbe8':'#d6e6dc'}"/><circle cx="${w*.72}" cy="${h*.24}" r="62" fill="#efb965"/><path d="M0 ${h}L${w*.35} ${h*.38}L${w} ${h}Z" fill="#568477"/><text x="${w/2}" y="${h*.65}" text-anchor="middle" font-family="sans-serif" font-size="32" fill="white">Batch preview ${n}</text></svg>`)).png().toBuffer();
  result.push(await upload(request,'image','Batch preview '+n+'.png',art));
 }return result;
}
function records(assets:Asset[],submission='batch'){
 const now=new Date().toISOString(),workflow=assets[0]!.kind==='video'?'text-to-video':'text-to-image';
 const request={workflow,mode:'sfw',prompt:'Public QA batch fixture',count:assets.length,seed:'random',output:{aspect:'16:9',size:workflow==='text-to-video'?'768p':'1mp',...(workflow==='text-to-video'?{duration_seconds:5,generate_audio:true}:{})}};
 return assets.map((asset,i)=>({id:submission+'-'+i,submission_id:submission,submission_index:i,request,state:'completed',outputs:[asset.id],seed:String(i+1),error:null,created_at:now,updated_at:now}));
}
async function setup(page:Page,jobs:ReturnType<typeof records>){
 await page.addInitScript(()=>{(window as any).EventSource=class{close(){}};});
 await page.route('**/api/v1/pool',r=>r.fulfill({json:{server_time:new Date().toISOString(),workers:[{id:'fixture-ready',worker_class:'image',state:'ready',installed_loras:[]}],summary:{active:1,ready:1,busy:0,preparing:0,needs_attention:0,hourly:0,estimated_spend:0,image:1,video:0}}}));
 await page.route('**/api/v1/jobs?*',r=>r.fulfill({json:{items:jobs}}));
 await page.route('**/api/v1/jobs',r=>r.fulfill({status:r.request().method()==='POST'?202:200,json:r.request().method()==='POST'?{jobs:jobs.filter(j=>j.submission_id==='batch')}:{items:jobs}}));
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 const own=jobs.filter(j=>j.submission_id==='batch');
 const chat={id:'batch-preview-qa',title:'Batch preview QA',mode:'sfw',workflow:null,version:0,epoch:0,activity:'idle',reasoning:true,assets:[],asset_manifest:[],jobs,messages:[],groups:[{id:'g',state:'released',cards:[{id:'c',workflow:own[0]!.request.workflow,revisions:[{number:1,request:own[0]!.request,decision:'approved',job_ids:own.map(j=>j.id),notes:{}}]}]}]};
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
}
async function capture(page:Page,device:string,id:string){
 const [,surface,title]=catalog.find(row=>row[0]===id)!;await mkdir(path.join(root,device),{recursive:true});
 await page.screenshot({path:path.join(root,device,id+'.png'),animations:'disabled'});
 await writeFile(path.join(root,device,id+'.json'),JSON.stringify({id,surface,title,device,file:device+'/'+id+'.png',viewport:page.viewportSize(),status:'passed',run_id:process.env.SEED_ATLAS_RUN_ID}));
}
async function shown(page:Page,asset:Asset){await expect(page.locator('.preview-image img')).toHaveAttribute('alt',asset.name);await expect.poll(()=>page.locator('.preview-image img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);}
async function touch(page:Page,dx:number,dy=0,pinch=false){
 const session=await page.context().newCDPSession(page),box=(await page.locator('.viewer-canvas').boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
 const points=(i:number)=>pinch?[{id:0,x:x-30-i*10,y:y-20},{id:1,x:x+30+i*10,y:y+20}]:[{id:0,x:x+dx*i/10,y:y+dy*i/10}];
 try{await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(0)});for(let i=1;i<=10;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(i)});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}finally{await session.detach();}
}

for(const device of ['desktop','mobile'] as const)test.describe(device,()=>{
 test.use({viewport:device==='desktop'?{width:1440,height:1000}:{width:390,height:844},hasTouch:device==='mobile',isMobile:device==='mobile'});
 test('Generate and Chat browse only this batch; zoom, favorites and Back follow the selected output',async({page,request})=>{
  const assets=await images(request),jobs=records(assets),other=records([assets[0]!],'different-request');await setup(page,[...jobs,...other]);
  await page.goto('/');await page.getByRole('textbox',{name:'Prompt',exact:true}).fill('Public QA batch fixture');await page.getByLabel('Quantity',{exact:true}).selectOption('3');
  await page.getByRole('button',{name:/^Create 3 images/}).click();await page.getByRole('button',{name:'Open image 1 preview',exact:true}).click();await shown(page,assets[0]!);
  await expect(page.getByRole('button',{name:'Previous output'})).toBeDisabled();await expect(page.locator('.viewer-batch-position')).toHaveText('1 of 3');await capture(page,device,'901');
  if(device==='mobile')await touch(page,-120);else await page.getByRole('button',{name:'Next output'}).click();await shown(page,assets[1]!);
  await page.getByRole('button',{name:'Add to favorites',exact:true}).click();await expect(page.getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
  expect((await(await request.get('/api/v1/assets/'+assets[1]!.id+'/organization')).json()).favorite).toBe(true);
  expect((await(await request.get('/api/v1/assets/'+assets[0]!.id+'/organization')).json()).favorite).toBe(false);
  if(device==='mobile'){
   await touch(page,0,0,true);await expect(page.getByRole('button',{name:'Reset zoom',exact:true})).toBeVisible();
   await touch(page,-110);await shown(page,assets[1]!);await page.getByRole('button',{name:'Reset zoom',exact:true}).click();
   await touch(page,0,100);await shown(page,assets[1]!);await touch(page,120);await shown(page,assets[0]!);await touch(page,-120);await shown(page,assets[1]!);
  }else{
   await page.keyboard.press('ArrowRight');await shown(page,assets[2]!);await expect(page.getByRole('button',{name:'Next output'})).toBeDisabled();
   await page.keyboard.press('ArrowRight');await shown(page,assets[2]!);await page.keyboard.press('ArrowLeft');await shown(page,assets[1]!);
  }
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('region',{name:'Latest generation'})).toBeVisible();
  await page.goto('/chat?chat=batch-preview-qa');await page.locator('.job-chat-wrap').getByRole('button',{name:'Open preview',exact:true}).nth(1).click();await shown(page,assets[1]!);
  await expect(page.locator('.viewer-batch-position')).toHaveText('2 of 3');await expect(page.getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
  await capture(page,device,'902');
  if(device==='mobile')await touch(page,-120);else await page.keyboard.press('ArrowRight');await shown(page,assets[2]!);
  await expect(page.getByRole('button',{name:'Next output'})).toBeDisabled();
  if(device==='mobile'){await touch(page,-120);await shown(page,assets[2]!);await page.setViewportSize({width:320,height:700});}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const button of await page.locator('.viewer-batch-arrow').all()){const box=(await button.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width);}
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(/chat\?chat=batch-preview-qa$/);
 });
 test('Video batches, missing outputs and single-output previews stay usable',async({page,request})=>{
  const body=await readFile('.local/browser-preview.mp4'),assets=[await upload(request,'video','Batch video 1.mp4',body),await upload(request,'video','Batch video 2.mp4',body),await upload(request,'video','Batch video 3.mp4',body)];
  await setup(page,records(assets));await page.goto('/chat?chat=batch-preview-qa');await page.locator('.job-chat-wrap').getByRole('button',{name:'Open preview',exact:true}).first().click();
  await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src','/api/v1/assets/'+assets[0]!.id+'/content');
  if(device==='mobile')await touch(page,-120);else await page.getByRole('button',{name:'Next output'}).click();
  await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src','/api/v1/assets/'+assets[1]!.id+'/content');await expect(page.getByRole('button',{name:'Pick Frame',exact:true})).toBeEnabled();
  await capture(page,device,'903');
  await page.route('**/api/v1/assets/'+assets[2]!.id,r=>r.fulfill({status:404,json:{error:{message:'Missing fixture'}}}));
  await page.getByRole('button',{name:'Next output'}).click();await expect(page.getByRole('alert')).toHaveText('This output is no longer available.');await capture(page,device,'904');
  await page.getByRole('button',{name:'Previous output'}).click();await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src','/api/v1/assets/'+assets[1]!.id+'/content');
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  const image=(await images(request))[0]!;await setup(page,records([image]));await page.reload();await page.locator('.job-chat-wrap').getByRole('button',{name:'Open preview',exact:true}).click();await shown(page,image);
  await expect(page.getByRole('navigation',{name:'Output navigation'})).toHaveCount(0);await capture(page,device,'905');
 });
});

test('rapid navigation ignores a delayed earlier response and does not trap the preview on errors',async({page,request})=>{
 const assets=await images(request);await setup(page,records(assets));let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/v1/assets/'+assets[1]!.id,async route=>{await held;await route.continue().catch(()=>{});});
 await page.goto('/chat?chat=batch-preview-qa');await page.locator('.job-chat-wrap').getByRole('button',{name:'Open preview',exact:true}).first().click();await shown(page,assets[0]!);
 await page.getByRole('button',{name:'Next output'}).click();await expect(page.getByRole('status')).toHaveText('Loading preview…');
 await page.keyboard.press('ArrowRight');await shown(page,assets[2]!);release();
 await expect(page.locator('.viewer-batch-position')).toHaveText('3 of 3');await shown(page,assets[2]!);
 await page.getByRole('button',{name:'Add to collection',exact:true}).click();await expect(page.getByRole('dialog',{name:'Add to collection',exact:true})).toBeVisible();
 await page.keyboard.press('ArrowLeft');await page.goBack();await expect(page.getByRole('dialog',{name:'Add to collection',exact:true})).toHaveCount(0);await shown(page,assets[2]!);
 await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
});
