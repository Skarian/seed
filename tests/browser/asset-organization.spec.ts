import {test,expect,type Page,type APIRequestContext} from './fixtures.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const catalog = [
  ['801','Library','Favorites across saved media'],['802','Library','Favorites with a collection'],
  ['803','Collections','Add a file to multiple collections'],['804','Collections','Rename and delete collections'],
  ['805','Preview','Image favorite and collections'],['806','Preview','Video favorite and collections'],
  ['807','Preview','Audio favorite and collections'],['808','Collections','Save failure retains selection'],
  ['809','Gallery','Favorites and collections keep selected inputs'],
] as const;
const root=path.resolve(process.env.SEED_ORGANIZATION_ROOT??'.local/asset-organization-atlas');
const origin='http://127.0.0.1:4311';
const headers={Origin:origin};
type Asset={id:string;name:string;kind:'image'|'video'|'audio'};

async function json(request:APIRequestContext,url:string,method='GET',data?:unknown){
  const response=await request.fetch('/api/v1/'+url,{method,headers,data});
  expect(response.ok(),method+' '+url+' '+response.status()).toBe(true);
  return response.status()===204?null:response.json();
}
async function upload(request:APIRequestContext,kind:Asset['kind'],name:string,body:Buffer,waitForReady=true):Promise<Asset>{
  const filetype={image:'image/png',video:'video/mp4',audio:'audio/wav'}[kind];
  const metadata=Object.entries({kind,filename:name,filetype,mode:'sfw'}).map(([key,value])=>key+' '+Buffer.from(value).toString('base64')).join(',');
  const start=await request.post('/api/v1/uploads',{headers:{...headers,'Tus-Resumable':'1.0.0','Upload-Length':String(body.length),'Upload-Metadata':metadata}});
  expect(start.status()).toBe(201);
  const location=start.headers().location!,id=location.split('/').at(-1)!;
  const sent=await request.patch(new URL(location,origin).href,{headers:{...headers,'Tus-Resumable':'1.0.0','Upload-Offset':'0','Content-Type':'application/offset+octet-stream'},data:body});
  expect(sent.status()).toBe(204);
  if(waitForReady)await expect.poll(async()=>{const item=await json(request,'assets/'+id);return item.state;},{timeout:20000}).toBe('ready');
  return {id,name,kind};
}
function wave(){
  const samples=4000,body=Buffer.alloc(44+samples*2);body.write('RIFF');body.writeUInt32LE(body.length-8,4);body.write('WAVEfmt ',8);body.writeUInt32LE(16,16);body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);body.writeUInt32LE(8000,24);body.writeUInt32LE(16000,28);body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(samples*2,40);for(let n=0;n<samples;n++)body.writeInt16LE(Math.round(Math.sin(n/8000*Math.PI*440)*1500),44+n*2);return body;
}
async function artwork(){return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#d8e7e0"/><circle cx="710" cy="155" r="72" fill="#eeb458"/><path d="M0 560L275 185L510 430L680 275L960 610V640H0" fill="#52877b"/><path d="M0 540Q320 440 960 575V640H0" fill="#244f55"/><rect x="270" y="300" width="420" height="70" rx="12" fill="#fff8e8"/><text x="480" y="346" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#244f55">Collection QA landscape</text></svg>')).png().toBuffer();}
async function reset(request:APIRequestContext){
  // This context can only reach the newly created isolated QA server.
  const collections=await json(request,'collections?mode=sfw');
  for(const collection of collections.items)await json(request,'collections/'+collection.id,'DELETE');
  for(;;){const page=await json(request,'assets?mode=sfw');if(!page.items.length)break;for(const asset of page.items)await json(request,'assets/'+asset.id,'DELETE');}
}
async function capture(page:Page,device:string,id:string){
  const [,surface,title]=catalog.find(row=>row[0]===id)!;
  const folder=path.join(root,device),file=device+'/'+id+'.png';await mkdir(folder,{recursive:true});await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(root,file),animations:'disabled'});
  await writeFile(path.join(folder,id+'.json'),JSON.stringify({id,surface,title,device,file,viewport:page.viewportSize(),status:'passed',run_id:process.env.SEED_ATLAS_RUN_ID}));
}
const tile=(page:Page,name:string)=>page.locator('.library-item').filter({has:page.getByRole('button',{name,exact:true})});
async function openLibrary(page:Page){await page.goto('/library');await expect(page.locator('.library-heading')).toBeVisible();}
async function openFile(page:Page,asset:Asset){await expect(tile(page,asset.name).locator('.media-ready')).toBeVisible();await tile(page,asset.name).getByRole('button',{name:asset.name,exact:true}).click();await expect(page.locator('.media-viewer')).toBeVisible();}
async function closeCollections(page:Page){await page.getByRole('dialog',{name:'Add to collection',exact:true}).getByRole('button',{name:/^Close/}).click();}
async function assertFits(page:Page,width:number,height:number){await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const toolbar=page.locator('.viewer-toolbar');if(await toolbar.count())expect(await toolbar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
async function mediaFilter(page:Page,name:string){const button=page.getByRole('button',{name,exact:true});if(!await button.isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await button.click();}

for(const device of ['desktop','mobile'] as const)test.describe(device,()=>{
  test.use({viewport:device==='desktop'?{width:1440,height:1000}:{width:390,height:844},hasTouch:device==='mobile',isMobile:device==='mobile'});
  test('favorites and collections use real persistence across Library and every media preview',async({page,request})=>{
    test.setTimeout(120000);await reset(request);
    const image=await upload(request,'image','Collection QA landscape.png',await artwork());
    const video=await upload(request,'video','Collection QA motion.mp4',await readFile('.local/browser-preview.mp4'));
    const audio=await upload(request,'audio','Collection QA tone.wav',wave());
    let launches=0;await page.route('**/api/v1/pool/launch',r=>{launches++;return r.abort();});
    await openLibrary(page);
    await tile(page,image.name).getByRole('button',{name:'Add to favorites',exact:true}).click();
    await expect(tile(page,image.name).getByRole('button',{name:'Remove from favorites',exact:true})).toBeVisible();
    expect((await json(request,'assets/'+image.id+'/organization')).favorite).toBe(true);
    const audioCard=tile(page,audio.name),audioBounds=await audioCard.boundingBox();
    for(const action of await audioCard.locator('.library-item-actions button').all()){
      const bounds=(await action.boundingBox())!;expect(bounds.width).toBeGreaterThanOrEqual(44);expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.y).toBeGreaterThanOrEqual(audioBounds!.y);expect(bounds.y+bounds.height).toBeLessThanOrEqual(audioBounds!.y+audioBounds!.height);
    }
    await capture(page,device,'801');

    await page.getByRole('button',{name:'Manage collections',exact:true}).click();
    const manager=page.getByRole('dialog',{name:'Manage collections',exact:true});
    await manager.getByLabel('Collection name',{exact:true}).fill('Landscape studies');await manager.getByRole('button',{name:'Create collection',exact:true}).click();
    await expect(manager.getByRole('button',{name:'Rename Landscape studies',exact:true})).toBeVisible();
    await manager.getByLabel('Collection name',{exact:true}).fill('Selected favorites with a deliberately longer collection name');await manager.getByRole('button',{name:'Create collection',exact:true}).click();
    await manager.getByRole('button',{name:'Rename Landscape studies',exact:true}).click();await manager.getByLabel('New collection name',{exact:true}).fill('Nature studies');await manager.getByRole('button',{name:'Save name',exact:true}).click();
    await expect(manager.getByRole('button',{name:'Rename Nature studies',exact:true})).toBeVisible();await capture(page,device,'804');
    await manager.getByRole('button',{name:/^Close/}).click();

    await tile(page,image.name).getByRole('button',{name:/to collection$/}).click();
    const picker=page.getByRole('dialog',{name:'Add to collection',exact:true});
    await picker.getByRole('checkbox',{name:'Nature studies',exact:true}).click();
    await picker.getByRole('checkbox',{name:'Selected favorites with a deliberately longer collection name',exact:true}).click();
    await expect.poll(async()=>(await json(request,'assets/'+image.id+'/organization')).collection_ids.length).toBe(2);
    await expect(picker.getByRole('checkbox',{name:'Nature studies',exact:true})).toBeChecked();
    await expect(picker.getByRole('checkbox',{name:'Selected favorites with a deliberately longer collection name',exact:true})).toBeChecked();
    await expect(picker.getByRole('checkbox',{name:'Nature studies',exact:true})).toBeEnabled();
    await expect(picker.getByText('Saving…',{exact:true})).toHaveCount(0);
    await capture(page,device,'803');await closeCollections(page);
    const collections=(await json(request,'collections?mode=sfw')).items;
    const nature=collections.find((c:{name:string})=>c.name==='Nature studies');
    await page.getByRole('combobox',{name:'Collection',exact:true}).selectOption(nature.id);
    await page.getByRole('button',{name:/Favorites$/}).click();
    await expect(page.locator('.library-item')).toHaveCount(1);
    await mediaFilter(page,'Images');await expect(page.locator('.library-item')).toHaveCount(1);
    await mediaFilter(page,'Videos');await expect(page.locator('.library-item')).toHaveCount(0);
    await mediaFilter(page,'All media');await expect(page.locator('.library-item')).toHaveCount(1);
    if(device==='desktop')expect((await tile(page,image.name).boundingBox())!.width).toBeLessThan(450);
    await capture(page,device,'802');
    await openFile(page,image);
    await expect(page.locator('.viewer-actions').getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
    await assertFits(page,device==='mobile'?320:1440,device==='mobile'?844:1000);
    await page.setViewportSize({width:device==='mobile'?390:1440,height:device==='mobile'?844:1000});await capture(page,device,'805');
    await page.locator('.viewer-actions').getByRole('button',{name:'Remove from favorites',exact:true}).click();
    await expect.poll(async()=>(await json(request,'assets/'+image.id+'/organization')).favorite).toBe(false);
    await page.goBack();await expect(page.locator('.media-viewer')).toHaveCount(0);await expect(page.locator('.library-item')).toHaveCount(0);
    await page.getByRole('button',{name:/Favorites$/}).click();await expect(page.locator('.library-item')).toHaveCount(1);
    await page.getByRole('combobox',{name:'Collection',exact:true}).selectOption('');
    for(const [asset,id] of [[video,'806'],[audio,'807']] as const){
      await openFile(page,asset);await page.locator('.viewer-actions').getByRole('button',{name:'Add to favorites',exact:true}).click();
      await expect.poll(async()=>(await json(request,'assets/'+asset.id+'/organization')).favorite).toBe(true);
      await expect(page.locator('.viewer-actions').getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
      await expect.poll(()=>page.locator('.viewer-canvas '+(asset.kind==='video'?'video':'audio')).evaluate((media:HTMLMediaElement)=>media.readyState)).toBeGreaterThanOrEqual(2);
      await assertFits(page,device==='mobile'?320:1440,device==='mobile'?844:1000);
      await page.setViewportSize({width:device==='mobile'?390:1440,height:device==='mobile'?844:1000});await capture(page,device,id);
      await page.getByRole('button',{name:'Close preview',exact:true}).click();
      await expect(tile(page,asset.name).getByRole('button',{name:'Remove from favorites',exact:true})).toBeVisible();
    }

    // Explicitly inject one save failure; all successful state transitions above use the real API.
    await tile(page,video.name).getByRole('button',{name:/to collection$/}).click();
    await page.route('**/api/v1/assets/'+video.id+'/collections/'+nature.id,r=>r.fulfill({status:503,json:{error:{message:'QA: collection save temporarily unavailable.'}}}));
    await picker.getByRole('checkbox',{name:'Nature studies',exact:true}).click();
    await expect(picker.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(picker.getByRole('checkbox',{name:'Nature studies',exact:true})).not.toBeChecked();await capture(page,device,'808');
    await page.unroute('**/api/v1/assets/'+video.id+'/collections/'+nature.id);
    await picker.getByRole('checkbox',{name:'Nature studies',exact:true}).click();await expect.poll(async()=>(await json(request,'assets/'+video.id+'/organization')).collection_ids).toContain(nature.id);
    await picker.getByRole('checkbox',{name:'Nature studies',exact:true}).click();await expect.poll(async()=>(await json(request,'assets/'+video.id+'/organization')).collection_ids).not.toContain(nature.id);await closeCollections(page);

    await page.getByRole('button',{name:'Manage collections',exact:true}).click();await manager.getByRole('button',{name:'Delete Nature studies',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'Delete collection?',exact:true});await confirm.getByRole('button',{name:'Delete collection',exact:true}).click();
    await expect(manager.getByRole('button',{name:'Delete Nature studies',exact:true})).toHaveCount(0);await manager.getByRole('button',{name:/^Close/}).click();
    expect((await request.get('/api/v1/assets/'+image.id+'/content')).ok()).toBe(true);
    expect((await json(request,'assets/'+image.id+'/organization')).collection_ids).toHaveLength(1);
    await page.reload();await expect(tile(page,video.name).getByRole('button',{name:'Remove from favorites',exact:true})).toBeVisible();expect(launches).toBe(0);
  });

  test('Generate and Chat galleries combine filters without dropping selected inputs or image-only limits',async({page,request})=>{
    test.setTimeout(120000);await reset(request);const png=await artwork(),assets:Asset[]=[];
    for(let index=0;index<11;index++)assets.push(await upload(request,'image','Gallery QA '+String(index+1).padStart(2,'0')+'.png',png,false));
    const video=await upload(request,'video','Gallery QA motion.mp4',await readFile('.local/browser-preview.mp4'));
    await expect.poll(async()=>(await json(request,'assets?mode=sfw')).items.length,{timeout:20000}).toBe(12);
    const first=assets[0]!,second=assets[1]!,third=assets[2]!;
    const collection=await json(request,'collections','POST',{name:'Gallery nature references',mode:'sfw'});
    await json(request,'assets/'+second.id+'/favorite','PUT',{favorite:true});
    for(const asset of [second,third])await json(request,'assets/'+asset.id+'/collections/'+collection.id,'PUT',{included:true});
    for(const asset of [first,second])await json(request,'notes/'+asset.id,'PUT',{note:'Public landscape QA fixture.',revision:0});
    const gallery=page.getByRole('dialog',{name:'Choose from gallery',exact:true});
    async function selectAcrossFilters(){
      await gallery.getByRole('button',{name:'Select '+first.name,exact:true}).click();
      await gallery.getByRole('combobox',{name:'Collection',exact:true}).selectOption(collection.id);
      await expect(gallery.locator('.gallery-tile')).toHaveCount(2);
      await gallery.getByRole('button',{name:/Favorites$/}).click();await expect(gallery.locator('.gallery-tile')).toHaveCount(1);
      await gallery.getByRole('button',{name:'Select '+second.name,exact:true}).click();await expect(gallery.getByRole('button',{name:'Select (2)',exact:true})).toBeEnabled();
      await gallery.getByRole('button',{name:/Favorites$/}).click();await gallery.getByRole('combobox',{name:'Collection',exact:true}).selectOption('');
      await expect(gallery.getByRole('button',{name:'Select '+first.name,exact:true})).toHaveAttribute('aria-pressed','true');
      await expect(gallery.getByRole('button',{name:'Select '+second.name,exact:true})).toHaveAttribute('aria-pressed','true');
      await gallery.getByRole('button',{name:/Favorites$/}).click();await gallery.getByRole('combobox',{name:'Collection',exact:true}).selectOption(collection.id);
      await expect(gallery.locator('.gallery-tile')).toHaveCount(1);await expect(gallery.getByText(/2 selected/)).toBeVisible();
    }
    await page.goto('/');await mediaFilter(page,'Reference to video');await page.getByRole('button',{name:'Gallery',exact:true}).click();await selectAcrossFilters();
    await assertFits(page,device==='mobile'?320:1440,device==='mobile'?844:1000);
    expect(await gallery.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.setViewportSize({width:device==='mobile'?390:1440,height:device==='mobile'?844:1000});
    await expect.poll(()=>gallery.locator('img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);await capture(page,device,'809');
    await gallery.getByRole('button',{name:'Select (2)',exact:true}).click();await expect(gallery).toHaveCount(0);
    for(const asset of [first,second])await expect(page.getByRole('button',{name:'Preview '+asset.name,exact:true})).toBeVisible();

    // Image editing must retain its ten-image cap and never show video references.
    await mediaFilter(page,'Image to image');await page.getByRole('button',{name:'Gallery',exact:true}).click();
    await expect(gallery.locator('.gallery-tile')).toHaveCount(11);await expect(gallery.getByRole('button',{name:'Select '+video.name,exact:true})).toHaveCount(0);
    for(const asset of assets.slice(0,10))await gallery.getByRole('button',{name:'Select '+asset.name,exact:true}).click();
    await expect(gallery.getByRole('button',{name:'Select '+assets[10]!.name,exact:true})).toBeDisabled();await expect(gallery.getByRole('button',{name:'Select (10)',exact:true})).toBeEnabled();
    await gallery.getByRole('button',{name:'Select '+first.name,exact:true}).click();await expect(gallery.getByRole('button',{name:'Select '+assets[10]!.name,exact:true})).toBeEnabled();await gallery.getByRole('button',{name:'Cancel',exact:true}).click();

    await page.addInitScript(()=>{(window as any).EventSource=class{close(){}};});
    await page.route('**/api/v1/chat-config',route=>route.fulfill({json:{configured:true}}));
    const chat={id:'gallery-qa',title:'Gallery QA',mode:'sfw',workflow:null,version:0,epoch:0,reasoning:true,groups:[],assets:[],asset_manifest:[],activity:'idle',error:null,jobs:[],accounting:[],messages:[]};
    await page.route('**/api/v1/chats**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
    await page.goto('/chat?chat=gallery-qa');await page.getByRole('button',{name:'Add attachments',exact:true}).click();await page.getByRole('button',{name:'Add from Library',exact:true}).click();await selectAcrossFilters();
    await gallery.getByRole('button',{name:'Select (2)',exact:true}).click();await expect(gallery).toHaveCount(0);
    for(const asset of [first,second])await expect(page.getByRole('button',{name:'Preview '+asset.name,exact:true})).toBeVisible();
  });
});

test('favorite filtering includes older pages and a stale read cannot undo a saved change',async({page,request})=>{
  test.setTimeout(120000);await reset(request);const png=await artwork(),assets:Asset[]=[];
  for(let i=0;i<52;i++)assets.push(await upload(request,'image','Pagination QA '+String(i).padStart(2,'0')+'.png',png,false));
  await expect.poll(async()=>(await json(request,'assets?mode=sfw')).items.length,{timeout:20000}).toBe(50);
  const oldest=assets[0]!,latest=assets.at(-1)!;
  await json(request,'assets/'+oldest.id+'/favorite','PUT',{favorite:true});
  await openLibrary(page);await expect(page.locator('.library-item')).toHaveCount(50);await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(page.locator('.library-item')).toHaveCount(52);
  await tile(page,oldest.name).getByRole('button',{name:'Remove from favorites',exact:true}).click();await expect.poll(async()=>(await json(request,'assets/'+oldest.id+'/organization')).favorite).toBe(false);
  await page.getByRole('button',{name:/Favorites$/}).click();await expect(page.locator('.library-item')).toHaveCount(0);
  await json(request,'assets/'+oldest.id+'/favorite','PUT',{favorite:true});await page.reload();await page.getByRole('button',{name:/Favorites$/}).click();await expect(page.locator('.library-item')).toHaveCount(1);await expect(tile(page,oldest.name)).toBeVisible();
  await page.getByRole('button',{name:/Favorites$/}).click();
  await expect(tile(page,latest.name)).toBeVisible();
  let readHeld=false,releaseRead!:()=>void;const readGate=new Promise<void>(resolve=>{releaseRead=resolve;});
  await page.route('**/api/v1/assets?*',async route=>{if(readHeld)return route.continue();const response=await route.fetch();readHeld=true;await readGate;await route.fulfill({response});});
  await page.evaluate(()=>window.dispatchEvent(new Event('seed:library-changed')));await expect.poll(()=>readHeld).toBe(true);
  const favoritePath='**/api/v1/assets/'+latest.id+'/favorite';let writes=0;let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(favoritePath,async route=>{writes++;await held;await route.continue();});
  const button=tile(page,latest.name).getByRole('button',{name:'Add to favorites',exact:true});await button.click();await expect(tile(page,latest.name).locator('.asset-favorite')).toBeDisabled();
  // A second real click cannot enqueue a conflicting toggle while persistence is pending.
  await tile(page,latest.name).locator('.asset-favorite').evaluate((element:HTMLButtonElement)=>element.click());expect(writes).toBe(1);release();
  await expect(tile(page,latest.name).getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
  releaseRead();await expect(tile(page,latest.name).getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
  await page.reload();await expect(tile(page,latest.name).getByRole('button',{name:'Remove from favorites',exact:true})).toBeVisible();
});

test('Generate and Chat organize the same saved output through their real preview paths',async({page,request})=>{
  await reset(request);const asset=await upload(request,'image','Generated QA landscape.png',await artwork());
  let jobs:any[]=[];
  await page.route('**/api/v1/pool',route=>route.fulfill({json:{server_time:new Date().toISOString(),workers:[{id:'fixture-ready',worker_class:'image',state:'ready',installed_loras:[]}],summary:{active:1,ready:1,busy:0,preparing:0,needs_attention:0,hourly:1,estimated_spend:0,image:1,video:0}}}));
  await page.route('**/api/v1/jobs',route=>{
    if(route.request().method()==='POST'){
      const input=route.request().postDataJSON(),now=new Date().toISOString();
      jobs=[{id:'organization-result',submission_id:'organization-submission',submission_index:0,request:input,state:'completed',outputs:[asset.id],seed:'42',created_at:now,updated_at:now}];
      return route.fulfill({status:202,json:{jobs}});
    }
    return route.fulfill({json:{items:jobs}});
  });
  await page.goto('/');await page.getByLabel('Prompt',{exact:true}).fill('QA public landscape fixture');await page.getByRole('button',{name:/^Create image/}).click();
  await page.getByRole('button',{name:'Open image 1 preview',exact:true}).click();
  await page.locator('.viewer-actions').getByRole('button',{name:'Add to favorites',exact:true}).click();
  await expect.poll(async()=>(await json(request,'assets/'+asset.id+'/organization')).favorite).toBe(true);
  await page.getByRole('button',{name:'Close preview',exact:true}).click();
  await page.addInitScript(()=>{(window as any).EventSource=class{close(){}};});
  await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
  const chat={id:'organization-chat',title:'Organization QA',mode:'sfw',workflow:null,version:0,epoch:0,reasoning:true,groups:[],assets:[asset.id],asset_manifest:[{...asset,note:''}],activity:'idle',error:null,jobs:[],accounting:[],messages:[{id:'fixture-message',role:'assistant',text:'Here is the QA landscape.',assets:[asset.id],created_at:new Date().toISOString()}]};
  await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
  await page.goto('/chat?chat=organization-chat');await page.getByRole('button',{name:'Preview '+asset.name,exact:true}).click();
  await expect(page.locator('.viewer-actions').getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
  await page.locator('.viewer-actions').getByRole('button',{name:'Remove from favorites',exact:true}).click();
  await expect.poll(async()=>(await json(request,'assets/'+asset.id+'/organization')).favorite).toBe(false);
  await page.locator('.viewer-actions').getByRole('button',{name:'Add to collection',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Add to collection',exact:true});await picker.getByLabel('Collection name',{exact:true}).fill('Generated keepers');await picker.getByRole('button',{name:'Create collection',exact:true}).click();
  await expect(picker.getByRole('checkbox',{name:'Generated keepers',exact:true})).toBeChecked();
  const collection=(await json(request,'collections?mode=sfw')).items[0];
  await page.goBack();await expect(picker).toHaveCount(0);await expect(page.locator('.media-viewer')).toBeVisible();await page.goBack();await expect(page.locator('.media-viewer')).toHaveCount(0);
  await openLibrary(page);await page.getByRole('combobox',{name:'Collection',exact:true}).selectOption(collection.id);await expect(tile(page,asset.name)).toBeVisible();await expect(tile(page,asset.name).getByRole('button',{name:'Add to favorites',exact:true})).toBeVisible();
});
