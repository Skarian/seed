import {test,expect,type Page,type APIRequestContext} from './fixtures.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const catalog = [
 ['921','Library','Browse the current image collection'],
 ['922','Library','Selected file owns its note and favorite'],
 ['923','Library','Video uses the same preview navigation'],
 ['924','Pagination','Load failure keeps the current file available'],
 ['925','Pagination','Continue into older files without closing'],
] as const;
const root=path.resolve(process.env.SEED_ATLAS_ROOT??'.local/library-preview-atlas');
const origin='http://127.0.0.1:4311',headers={Origin:origin};
type Asset={id:string;name:string;kind:'image'|'video'|'audio'};
async function upload(request:APIRequestContext,kind:Asset['kind'],name:string,body:Buffer):Promise<Asset>{
 const meta=Object.entries({kind,filename:name,filetype:kind==='image'?'image/png':kind==='video'?'video/mp4':'audio/wav',mode:'sfw'}).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
 const start=await request.post('/api/v1/uploads',{headers:{...headers,'Tus-Resumable':'1.0.0','Upload-Length':String(body.length),'Upload-Metadata':meta}});expect(start.status()).toBe(201);
 const location=start.headers().location!,id=location.split('/').at(-1)!;
 expect((await request.patch(new URL(location,origin).href,{headers:{...headers,'Tus-Resumable':'1.0.0','Upload-Offset':'0','Content-Type':'application/offset+octet-stream'},data:body})).status()).toBe(204);
 await expect.poll(async()=>(await(await request.get('/api/v1/assets/'+id)).json()).state).toBe('ready');return {id,name,kind};
}
async function fixture(request:APIRequestContext,mixed=false){
 const collection=(await(await request.post('/api/v1/collections',{headers,data:{name:'Preview '+Date.now(),mode:'sfw'}})).json());
 const assets:Asset[]=[];
 for(let n=1;n<=3;n++){
  const width=n===2?600:960,height=n===2?900:640;
  const bytes=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${n===2?'#e3d7db':'#d6e6dc'}"/><circle cx="${width*.72}" cy="${height*.24}" r="62" fill="#efb965"/><path d="M0 ${height}L${width*.35} ${height*.38}L${width} ${height}Z" fill="#568477"/><text x="${width/2}" y="${height*.65}" text-anchor="middle" font-family="sans-serif" font-size="30" fill="white">Library preview ${n}</text></svg>`)).png().toBuffer();
  assets.push(await upload(request,'image','Library preview '+n+'.png',bytes));
 }
 if(mixed){
  assets.push(await upload(request,'video','Library video.mp4',await readFile('.local/browser-preview.mp4')));
  const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  assets.push(await upload(request,'audio','Library audio.wav',wav));
 }
 for(const asset of assets)expect((await request.put('/api/v1/assets/'+asset.id+'/collections/'+collection.id,{headers,data:{included:true}})).ok()).toBe(true);
 return {collection,assets};
}
async function library(page:Page,id:string){await page.goto('/library');await expect(page.getByRole('combobox',{name:'Collection',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'Collection',exact:true}).selectOption(id);}
async function shown(page:Page,asset:Asset){
 const element=page.locator(asset.kind==='image'?'.preview-image img':asset.kind==='video'?'.viewer-canvas video':'.viewer-canvas audio');
 await expect(element).toHaveAttribute('src','/api/v1/assets/'+asset.id+'/content');
 if(asset.kind==='image')await expect.poll(()=>element.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
}
async function touch(page:Page,dx:number,pinch=false){
 const session=await page.context().newCDPSession(page),box=(await page.locator('.viewer-canvas').boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
 const points=(i:number)=>pinch?[{id:0,x:x-30-i*10,y:y-20},{id:1,x:x+30+i*10,y:y+20}]:[{id:0,x:x+dx*i/10,y}];
 try{await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(0)});for(let i=1;i<=10;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(i)});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}finally{await session.detach();}
}
async function capture(page:Page,device:string,id:string){
 const [,surface,title]=catalog.find(row=>row[0]===id)!;await mkdir(path.join(root,device),{recursive:true});
 await page.screenshot({path:path.join(root,device,id+'.png'),animations:'disabled'});
 await writeFile(path.join(root,device,id+'.json'),JSON.stringify({id,surface,title,device,file:device+'/'+id+'.png',viewport:page.viewportSize(),status:'passed',run_id:process.env.SEED_ATLAS_RUN_ID}));
}
for(const device of ['desktop','mobile'] as const)test.describe(device,()=>{
 test.use({viewport:device==='desktop'?{width:1440,height:1000}:{width:390,height:844},hasTouch:device==='mobile',isMobile:device==='mobile'});
 test('library filters, touch, keyboard, notes, favorites and Back share one preview',async({page,request})=>{
  const {collection,assets}=await fixture(request,true);
  await library(page,collection.id);if(device==='mobile')await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await page.getByRole('button',{name:'Images',exact:true}).click();
  await page.getByRole('button',{name:assets[2]!.name,exact:true}).click();await shown(page,assets[2]!);
  await expect(page.locator('.viewer-batch-position')).toHaveText('1 of 3');await expect(page.getByRole('button',{name:'Previous file',exact:true})).toBeDisabled();await capture(page,device,'921');
  if(device==='mobile')await touch(page,-120);else await page.getByRole('button',{name:'Next file',exact:true}).click();await shown(page,assets[1]!);
  await page.getByRole('button',{name:'Add to favorites',exact:true}).click();await expect(page.getByRole('button',{name:'Remove from favorites',exact:true})).toBeEnabled();
  expect((await(await request.get('/api/v1/assets/'+assets[1]!.id+'/organization')).json()).favorite).toBe(true);
  expect((await(await request.get('/api/v1/assets/'+assets[2]!.id+'/organization')).json()).favorite).toBe(false);
  await page.getByRole('button',{name:'Edit note',exact:true}).click();await expect(page.getByRole('textbox',{name:'Asset note',exact:true})).toBeEnabled();await page.getByRole('textbox',{name:'Asset note',exact:true}).fill('Public selected-file QA note');
  await page.keyboard.press('ArrowLeft');await shown(page,assets[1]!);if(device==='mobile'){const panel=(await page.locator('.viewer-note-panel').boundingBox())!,toolbar=(await page.locator('.viewer-toolbar').boundingBox())!;expect(panel.y).toBeGreaterThanOrEqual(toolbar.y+toolbar.height);}await capture(page,device,'922');
  await page.getByRole('button',{name:'Save note',exact:true}).click();await expect(page.getByRole('textbox',{name:'Asset note',exact:true})).toHaveCount(0);
  expect((await(await request.get('/api/v1/notes/'+assets[1]!.id)).json()).note).toBe('Public selected-file QA note');
  if(device==='mobile'){
   await touch(page,0,true);await expect(page.getByRole('button',{name:'Reset zoom',exact:true})).toBeVisible();await touch(page,-120);await shown(page,assets[1]!);await page.getByRole('button',{name:'Reset zoom',exact:true}).click();await touch(page,-120);
  }else await page.keyboard.press('ArrowRight');
  await shown(page,assets[0]!);await expect(page.getByRole('button',{name:'Next file',exact:true})).toBeDisabled();
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(/\/library$/);
  await request.put('/api/v1/assets/'+assets[0]!.id+'/favorite',{headers,data:{favorite:true}});await page.getByRole('button',{name:'Favorites',exact:true}).click();await expect(page.locator('.library-grid .library-item')).toHaveCount(2);await page.getByRole('button',{name:assets[1]!.name,exact:true}).click();
  await page.getByRole('button',{name:'Remove from favorites',exact:true}).click();await shown(page,assets[0]!);await expect(page.getByRole('navigation',{name:'Library navigation',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Remove from favorites',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.library-grid .library-item')).toHaveCount(0);
 });
 test('mixed media follows the collection order and preserves video controls',async({page,request})=>{
  const {collection,assets}=await fixture(request,true);await library(page,collection.id);
  await page.getByRole('button',{name:assets[4]!.name,exact:true}).click();await shown(page,assets[4]!);
  await page.getByRole('button',{name:'Next file',exact:true}).click();await shown(page,assets[3]!);await expect(page.getByRole('button',{name:'Pick Frame',exact:true})).toBeEnabled();await capture(page,device,'923');
  await page.getByRole('button',{name:'Pick Frame',exact:true}).click();await expect(page.getByRole('navigation',{name:'Library navigation',exact:true})).toHaveCount(0);await page.keyboard.press('ArrowRight');await shown(page,assets[3]!);
  await page.getByRole('button',{name:'Pick Frame',exact:true}).click();
  if(device==='mobile')await touch(page,-120);else await page.keyboard.press('ArrowRight');await shown(page,assets[2]!);
  if(device==='mobile'){await page.setViewportSize({width:320,height:700});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
 });
 test('pagination can fail, retry, and load older files without a late response changing selection',async({page,request})=>{
  const {collection,assets}=await fixture(request);
  const all=(await(await request.get('/api/v1/assets?mode=sfw&collection_id='+collection.id)).json()).items;
  let fail=true,hold:Promise<void>|null=null,release=()=>{},pageReads=0;
  await page.route('**/api/v1/assets?*',async route=>{
   const url=new URL(route.request().url());if(url.searchParams.get('collection_id')!==collection.id)return route.continue();
   if(url.searchParams.has('cursor')){pageReads++;if(fail){fail=false;return route.fulfill({status:503,json:{error:{message:'Explicit fixture outage'}}});}if(hold)await hold;return route.fulfill({json:{items:all.slice(2),next_cursor:null}});}
   return route.fulfill({json:{items:all.slice(0,2),next_cursor:all[1].id}});
  });
  await library(page,collection.id);await page.getByRole('button',{name:assets[1]!.name,exact:true}).click();await shown(page,assets[1]!);
  await expect(page.locator('.viewer-batch-position')).toHaveText('2 of 2+');await page.getByRole('button',{name:'Next file',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Could not load older media');await capture(page,device,'924');
  hold=new Promise<void>(resolve=>release=resolve);
  await page.getByRole('button',{name:'Next file',exact:true}).click();await expect(page.locator('.viewer-batch-position')).toHaveText('Loading more…');
  await page.getByRole('button',{name:'Previous file',exact:true}).click();await shown(page,assets[2]!);release();await expect(page.locator('.viewer-batch-position')).toHaveText('1 of 3');await shown(page,assets[2]!);
  await page.getByRole('button',{name:'Next file',exact:true}).click();await page.getByRole('button',{name:'Next file',exact:true}).click();await shown(page,assets[0]!);await expect(page.locator('.viewer-batch-position')).toHaveText('3 of 3');await capture(page,device,'925');expect(pageReads).toBe(2);
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  // At the page boundary, an ordinary Next automatically selects the first older file.
  hold=null;await library(page,collection.id);await page.getByRole('button',{name:assets[1]!.name,exact:true}).click();
  await page.getByRole('button',{name:'Next file',exact:true}).click();await shown(page,assets[0]!);await expect(page.locator('.viewer-batch-position')).toHaveText('3 of 3');
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  // Closing while a page is outstanding must not reopen the preview.
  await library(page,collection.id);await page.getByRole('button',{name:assets[1]!.name,exact:true}).click();hold=new Promise<void>(resolve=>release=resolve);
  await page.getByRole('button',{name:'Next file',exact:true}).click();await expect(page.locator('.viewer-batch-position')).toHaveText('Loading more…');await page.goBack();release();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.library-grid .library-item')).toHaveCount(3);
 });
});
