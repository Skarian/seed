import {test, expect, type Page} from './fixtures.js';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const catalog = [
  ['401','Image preview','Fit to screen'],['402','Image preview','Zoomed image'],
  ['403','Image preview','Pan enlarged image'],['404','Image preview','Portrait image after reset'],
  ['405','Image preview','Reference navigation'],
] as const;
const root = path.resolve('.local/media-preview-atlas');

async function capture(page: Page, device: string, id: string) {
  const [,surface,title] = catalog.find(row => row[0] === id)!;
  const file = `${device}/${id}.png`;
  await mkdir(path.join(root,device),{recursive:true});
  await page.screenshot({path:path.join(root,file)});
  await writeFile(path.join(root,device,id+'.json'),JSON.stringify({id,surface,title,device,file,viewport:page.viewportSize(),status:'passed',run_id:process.env.SEED_ATLAS_RUN_ID}));
}

async function open(page: Page, name = 'Landscape fixture') {
  await page.getByRole('button',{name,exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Saved image',exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('.preview-image img').evaluate((el: HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
}

async function scale(page: Page) {
  return page.locator('.preview-image img').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);
}

async function pinch(page: Page, start: number, finish: number) {
  const session = await page.context().newCDPSession(page);
  const box = (await page.locator('.preview-image-surface').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const points = (d: number) => [{id:0,x:cx-d,y:cy-20},{id:1,x:cx+d,y:cy+20}];
  try {
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(start)});
    for(let i=1;i<=10;i++) await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(start+(finish-start)*i/10)});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } finally {await session.detach();}
}

for(const device of ['desktop','mobile'] as const) test.describe(device,()=>{
  test.use({viewport:device==='desktop'?{width:1440,height:1000}:{width:390,height:844},hasTouch:device==='mobile',isMobile:device==='mobile'});
  test.beforeEach(async({page})=>{
    const art=(w:number,h:number)=>sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 960 640" preserveAspectRatio="xMidYMid slice"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#c5d9d3" stroke-width="1"/></pattern></defs><rect width="960" height="640" fill="#d8e7e0"/><rect width="960" height="640" fill="url(#grid)"/><circle cx="720" cy="160" r="65" fill="#eeb458"/><path d="M0 540L265 200L455 415L590 270L960 640H0" fill="#52877b"/><path d="M210 270L265 200L332 279L281 261L251 277" fill="#fff8e8"/><path d="M0 545Q370 450 960 555V640H0" fill="#244f55"/><rect x="345" y="306" width="270" height="64" rx="10" fill="#fff8e8"/><text x="480" y="347" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#244f55">Preview QA fixture</text></svg>`)).png().toBuffer();
    const landscape=await art(960,640),portrait=await art(640,960);
    await page.route('**/api/v1/assets?*',r=>r.fulfill({json:{items:[{id:'landscape',name:'Landscape fixture',kind:'image',mode:'sfw'},{id:'portrait',name:'Portrait fixture',kind:'image',mode:'sfw'}]}}));
    await page.route('**/api/v1/assets/landscape',r=>r.fulfill({json:{id:'landscape',name:'Landscape fixture',kind:'image',mime_type:'image/png'}}));
    await page.route('**/api/v1/assets/portrait',r=>r.fulfill({json:{id:'portrait',name:'Portrait fixture',kind:'image',mime_type:'image/png'}}));
    await page.route('**/api/v1/assets/*/content',r=>r.fulfill({contentType:'image/png',body:r.request().url().includes('/portrait/')?portrait:landscape}));
    await page.route('**/api/v1/notes/*',r=>r.fulfill({json:{note:'',revision:0}}));
  });

  test('image zoom, pan, reset and a fresh portrait preview',async({page})=>{
    await page.goto('/library');await open(page);await capture(page,device,'401');
    if(device==='mobile')await pinch(page,35,130);
    else await page.locator('.preview-image-surface').dblclick();
    await expect.poll(()=>scale(page)).toBeGreaterThan(2);
    // The image zooms independently: the page and toolbar keep their original scale.
    expect(await page.evaluate(()=>visualViewport?.scale)).toBe(1);
    const close=page.getByRole('button',{name:'Close preview',exact:true});
    expect((await close.boundingBox())!.width).toBeLessThan(60);
    await capture(page,device,'402');
    const surface=page.locator('.preview-image-surface'),box=(await surface.boundingBox())!;
    const x=box.x+box.width/2,y=box.y+box.height/2;
    if(device==='mobile'){
      const session=await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x,y}]});
      for(let i=1;i<=6;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:x+15*i,y:y+10*i}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
    }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+90,y+60,{steps:6});await page.mouse.up();}
    await expect.poll(()=>page.locator('.preview-image img').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).e)).toBeGreaterThan(50);
    await capture(page,device,'403');
    await page.getByRole('button',{name:'Reset zoom',exact:true}).click();await expect.poll(()=>scale(page)).toBe(1);
    if(device==='mobile'){
      await pinch(page,35,130);await pinch(page,130,25);await expect.poll(()=>scale(page)).toBe(1);
      await pinch(page,35,130);await page.setViewportSize({width:844,height:390});await expect.poll(()=>scale(page)).toBe(1);
      await page.setViewportSize({width:390,height:844});
    }
    await close.click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await open(page,'Portrait fixture');await expect.poll(()=>scale(page)).toBe(1);await capture(page,device,'404');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });

  test('back dismisses only the preview; explicit close and Escape leave no extra back stops',async({page})=>{
    await page.goto('/');
    if(device==='mobile')await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
    await page.getByRole('button',{name:'Seed',exact:true}).click();
    await page.getByRole('menuitem',{name:/Library/}).click();
    await page.evaluate(()=>history.replaceState({fixture:'preserved'},'', '/library?fixture=preview#image'));
    for(const method of ['back','button','escape','back']){
      await open(page);
      expect(await page.evaluate(()=>history.state.fixture)).toBe('preserved');
      if(method==='back')await page.goBack();
      else if(method==='button')await page.getByRole('button',{name:'Close preview',exact:true}).click();
      else await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/\/library\?fixture=preview#image$/);
      expect(await page.evaluate(()=>history.state)).toEqual({fixture:'preserved'});
    }
    await page.goBack();await expect(page).toHaveURL('http://127.0.0.1:4311/');
    await expect(page.getByRole('textbox',{name:'Prompt',exact:true})).toBeVisible();
  });

  test('Edit image closes preview before navigating, and Back returns to Library',async({page})=>{
    await page.goto('/library');await open(page);
    await page.getByRole('button',{name:'Edit image',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL('http://127.0.0.1:4311/');
    await expect(page.getByRole('button',{name:'Preview Landscape fixture',exact:true})).toBeVisible();
    await page.goBack();await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole('button',{name:'Landscape fixture',exact:true})).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('reference navigation remains usable and resets zoom between images',async({page})=>{
    const references=['landscape','portrait'].map(id=>({id,asset_id:id,kind:'image',role:'reference',framing:'fit'}));
    const assets=references.map(r=>({id:r.id,kind:'image',name:r.id==='landscape'?'Landscape fixture':'Portrait fixture',note:''}));
    const request={workflow:'reference-to-video',mode:'sfw',prompt:'Fixture',count:1,seed:'random',output:{aspect:'16:9',size:'768p',duration_seconds:5},references};
    const chat={id:'preview-qa',title:'Preview QA',mode:'sfw',workflow:'reference-to-video',version:0,epoch:0,activity:'idle',reasoning:true,assets:[],asset_manifest:assets,jobs:[],messages:[],groups:[{id:'g',state:'reviewing',cards:[{id:'c',workflow:'reference-to-video',revisions:[{number:1,request,decision:'undecided',job_ids:[],notes:{}}]}]}]};
    await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
    await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[]}:chat}));
    await page.goto('/chat?chat=preview-qa');
    await page.locator('.job-chat-wrap').getByRole('button',{name:'Preview Landscape fixture',exact:true}).click();
    await expect.poll(()=>page.locator('.preview-image img').evaluate((el: HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
    await page.locator('.preview-image-surface').dblclick();await expect.poll(()=>scale(page)).toBeGreaterThan(1);
    for(const width of device==='mobile'?[320,390]:[1440]){
      await page.setViewportSize({width,height:device==='mobile'?844:1000});
      await page.getByRole('button',{name:'Next input',exact:true}).click();
      await expect(page.locator('.preview-image img')).toHaveAttribute('alt','Portrait fixture');
      await expect.poll(()=>scale(page)).toBe(1);
      await page.getByRole('button',{name:'Previous input',exact:true}).click();
      await expect(page.locator('.preview-image img')).toHaveAttribute('alt','Landscape fixture');
      await expect.poll(()=>scale(page)).toBe(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await capture(page,device,'405');
    await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.job-chat-wrap').getByRole('button',{name:'Preview Landscape fixture',exact:true})).toBeVisible();
  });
});
