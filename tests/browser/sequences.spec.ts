import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('buffered scrubbing draws the correct tile and waits for original quality before selection',async({page})=>{
  const frames=Array.from({length:48},(_,index)=>({id:'f'+index,index,time:index/24,width:1344,height:768}));
  const sheets: Buffer[]=[];
  for(let sheet=0;sheet<2;sheet++) {
    const layers=await Promise.all(Array.from({length:24},async(_,i)=>({
      input:await sharp({create:{width:320,height:183,channels:3,background:{r:(sheet*24+i)*5,g:20,b:30}}}).png().toBuffer(),left:i%6*320,top:Math.floor(i/6)*183,
    })));
    sheets.push(await sharp({create:{width:1920,height:732,channels:3,background:'black'}}).composite(layers).png().toBuffer());
  }
  const original=await sharp({create:{width:1344,height:768,channels:3,background:'#123456'}}).png().toBuffer();
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let requests=0;
  await page.route('**/api/v1/assets',r=>r.fulfill({json:{items:[{id:'seq',kind:'sequence',name:'Image sequence',cover_id:'f0',frame_count:48}]}}));
  await page.route('**/api/v1/assets/f*/*',async r=>{if(r.request().url().includes('/f40/content'))await gate;await r.fulfill({contentType:'image/png',body:original});});
  await page.route('**/api/v1/sequences/seq',r=>r.fulfill({json:{id:'seq',revision:0,mode:'sfw',frames}}));
  await page.route('**/api/v1/sequences/seq/preview/*',r=>{requests++;return r.fulfill({contentType:'image/png',body:sheets[Number(new URL(r.request().url()).pathname.split('/').pop())]!});});
  try {
    await page.goto('/library');await page.getByRole('button',{name:'Image sequence',exact:true}).click();
    await expect(page.locator('.frame-buffering')).toHaveCount(0);
    const slider=page.getByRole('slider',{name:'Frame',exact:true});
    for(const index of [1,12,25,39,40])await slider.fill(String(index));
    const canvas=page.locator('.frame-canvas canvas');
    await expect(canvas).toHaveAttribute('data-frame','f40');await expect(canvas).toHaveAttribute('data-quality','preview');
    expect(await canvas.evaluate(e=>Array.from((e as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,1,1).data))).toEqual([200,20,30,255]);
    await expect(page.getByRole('button',{name:'Select frame',exact:true})).toBeDisabled();expect(requests).toBe(2);
    await expect(page.getByRole('button',{name:'Select frame',exact:true})).toHaveCSS('opacity','1');
    await expect(page.getByRole('button',{name:'100%',exact:true})).toHaveCSS('opacity','1');
    await expect(page.locator('.frame-loading')).toHaveCount(0);
    await expect(page.locator('.frame-loading')).toBeVisible();
    await slider.fill('39');await expect(page.locator('.frame-loading')).toHaveCount(0);
    await slider.fill('40');
    release();await expect(page.getByRole('button',{name:'Select frame',exact:true})).toBeEnabled();
    await expect(page.locator('.frame-loading')).toHaveCount(0);
    await expect(canvas).toHaveAttribute('data-quality','original');await expect(canvas).toHaveAttribute('width','1344');
  } finally { release?.(); }
});

test('sequence slider inspects originals, selects frames, confirms keep-only and refreshes the Library',async({page})=>{
  let revision=0, frames=Array.from({length:12},(_,index)=>({id:'frame-'+index,index,time:index/24,width:1344,height:768}));
  let removed=0;
  const png=await sharp({create:{width:1344,height:768,channels:3,background:'#387a82'}}).png().toBuffer();
  await page.route('**/api/v1/assets',r=>r.fulfill({json:{items:[{id:'seq',kind:'sequence',name:'Image sequence',mode:'sfw',cover_id:frames[0]!.id,frame_count:frames.length}]}}));
  await page.route('**/api/v1/assets/frame-*/*',r=>r.fulfill({contentType:'image/png',body:png}));
  await page.route('**/api/v1/sequences/seq',r=>r.fulfill({json:{id:'seq',revision,mode:'sfw',frames}}));
  await page.route('**/api/v1/sequences/seq/keep-only',r=>{
    const body=r.request().postDataJSON();expect(body.revision).toBe(revision);
    const next=frames.filter(f=>body.asset_ids.includes(f.id));removed+=frames.length-next.length;frames=next;revision++;
    return r.fulfill({json:{id:'seq',revision,mode:'sfw',frames}});
  });
  await page.goto('/library');await page.getByRole('button',{name:'Image sequence',exact:true}).click();
  const viewer=page.getByRole('dialog',{name:'Image sequence'}), check=viewer.getByRole('button',{name:'Select frame',exact:true});
  await expect(check).toBeEnabled();await check.click();
  await viewer.getByRole('slider',{name:'Frame',exact:true}).fill('8');await expect(check).toBeEnabled();await check.click();
  const previous=viewer.getByRole('button',{name:'Previous selected frame'}), next=viewer.getByRole('button',{name:'Next selected frame'});
  await expect(next).toBeDisabled();await previous.click();
  await expect(viewer.getByRole('slider',{name:'Frame',exact:true})).toHaveValue('0');
  await expect(previous).toBeDisabled();await next.click();
  await expect(viewer.getByRole('slider',{name:'Frame',exact:true})).toHaveValue('8');
  await viewer.getByRole('slider',{name:'Frame',exact:true}).fill('4');
  await previous.click();await expect(viewer.getByRole('slider',{name:'Frame',exact:true})).toHaveValue('0');
  await viewer.getByRole('button',{name:'Keep only',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Keep 2 frames?'});
  await expect(confirmation).toContainText('other 10');await confirmation.getByRole('button',{name:'Cancel'}).click();expect(removed).toBe(0);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/sequence-mobile.png'});
  await viewer.getByRole('button',{name:'Keep only',exact:true}).click();
  await page.screenshot({path:'.local/sequence-confirm-mobile.png'});
  await page.getByRole('dialog',{name:'Keep 2 frames?'}).getByRole('button',{name:'Keep only',exact:true}).click();
  await expect(viewer.getByText('2 frames',{exact:true})).toBeVisible();expect(removed).toBe(10);
  await viewer.getByRole('button',{name:'Close sequence'}).click();await page.reload();
  await expect(page.locator('.frame-count')).toHaveText('2 frames');
});

test('image export uses the existing video request and whole-second duration',async({page})=>{
  await page.route('**/api/v1/studio',r=>r.fulfill({json:{worker:{state:'ready',connected:true,stale:false},queue:{active:0,waiting:0}}}));
  await page.route('**/api/v1/capabilities',r=>r.fulfill({json:{revision:'frames',workflows:{'text-to-video':{enabled:true,modes:['sfw'],native_export:true,qualities:['fast','high'],export_formats:['video','images'],duration_seconds:{min:5,max:15,step:1}}}}}));
  await page.route('**/api/v1/jobs',r=>r.fulfill({status:r.request().method()==='POST'?202:200,json:r.request().method()==='POST'?{jobs:[]}:{items:[]}}));
  await page.goto('/');await page.getByLabel('Workflow').selectOption('text-to-video');
  await page.getByLabel('Prompt',{exact:true}).fill('Clouds above a meadow');
  await page.getByLabel('Length',{exact:true}).fill('7');await page.getByLabel('Export as images').check();
  await expect(page.getByLabel('Audio',{exact:true})).toHaveCount(0);
  const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/v1/jobs'));
  await page.getByRole('button',{name:'Create images'}).click();
  expect((await sent).postDataJSON()).toMatchObject({workflow:'text-to-video',output:{duration_seconds:7,format:'images'}});
});

test('Gallery opens a sequence and selects individual frames as image references',async({page})=>{
  const png=await sharp({create:{width:100,height:80,channels:3,background:'#abc'}}).png().toBuffer();
  await page.route('**/api/v1/assets?*',r=>r.fulfill({json:{items:[{id:'seq',kind:'sequence',name:'Image sequence',cover_id:'frame-a',frame_count:2}]}}));
  await page.route('**/api/v1/assets/frame-*/*',r=>r.fulfill({contentType:'image/png',body:png}));
  await page.route('**/api/v1/assets/frame-*',r=>r.fulfill({json:{mime_type:'image/png'}}));
  await page.route('**/api/v1/sequences/seq',r=>r.fulfill({json:{id:'seq',revision:0,mode:'sfw',frames:['a','b'].map((id,index)=>({id:'frame-'+id,index,time:index/24,width:100,height:80}))}}));
  await page.goto('/');await page.getByLabel('Workflow').selectOption('reference-to-video');await page.getByRole('button',{name:'Gallery',exact:true}).click();
  await page.getByRole('button',{name:'Select Image sequence'}).click();
  await expect(page.getByRole('button',{name:'Select frame',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Select frame',exact:true}).click();
  await page.getByRole('button',{name:'Close sequence'}).click();await page.getByRole('button',{name:'Select (1)',exact:true}).click();
  await expect(page.getByRole('button',{name:'Preview Frame 1'})).toBeVisible();
});
