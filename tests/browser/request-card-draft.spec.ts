import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import sharp,{type OverlayOptions} from 'sharp';
test('render request-card draft mosaic',async({page})=>{
 page.on('pageerror',e=>console.log(e.message));
 const out='.local/request-card-mosaic';await fs.mkdir(out,{recursive:true});
 const portrait=await sharp('C:/Users/Neil Skaria/.codex/attachments/a276281a-29fe-4fb0-8f8c-b21ee079f5ea/codex-clipboard-8034e155-1bcf-4597-8907-38db2c1537c5.png').extract({left:98,top:69,width:76,height:76}).png().toBuffer();
 await page.route('**/request-card-draft',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/draft.css"><div id="root"></div><script type="module" src="/draft.js"></script>'}));
 await page.route('**/draft.js',async r=>r.fulfill({contentType:'text/javascript',body:await fs.readFile('.local/request-card-preview-build/preview.js')}));
 await page.route('**/draft.css',async r=>r.fulfill({contentType:'text/css',body:await fs.readFile('.local/request-card-preview-build/preview.css')}));
 await page.route('**/api/v1/assets/input',r=>r.fulfill({json:{id:'input',name:'Reference image',kind:'image'}}));
 await page.route('**/api/v1/assets/input/content',r=>r.fulfill({contentType:'image/png',body:portrait}));
 await page.route('**/api/v1/assets/output/content',async r=>r.fulfill({contentType:'video/mp4',body:await fs.readFile('tests/fixtures/request-preview.mp4')}));
 for(const width of [1200,390]){
  await page.setViewportSize({width,height:950});await page.goto('/request-card-draft');await expect(page.locator('.request-draft-sample')).toHaveCount(22);await expect(page.locator('.draft-request-main img').first()).toBeVisible();
  const pictures:Buffer[]=[];
  for(const element of await page.locator('.request-draft-sample').all()){expect(await element.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);pictures.push(await element.screenshot({animations:'disabled'}));}
  const sets=width===1200?[pictures.slice(0,12),pictures.slice(12)]:[pictures];
  for(let part=0;part<sets.length;part++){
   const items=sets[part]!,columns=width===1200?2:3,gap=16,meta=await Promise.all(items.map(b=>sharp(b).metadata()));const cell=meta[0]!.width!;let y=52;const layers:OverlayOptions[]=[];
   for(let i=0;i<items.length;i+=columns){for(let j=0;j<columns&&i+j<items.length;j++)layers.push({input:items[i+j]!,left:gap+j*(cell+gap),top:y});y+=Math.max(...meta.slice(i,i+columns).map(m=>m.height!))+gap;}
   const title=`Request cards · ${width===1200?'desktop':'mobile'} · draft${sets.length>1?' '+(part+1):''}`;
   layers.unshift({input:Buffer.from(`<svg width="1000" height="45"><text x="16" y="29" fill="#dbe5ce" font-family="Arial" font-size="19">${title}</text></svg>`),left:0,top:0});
   await sharp({create:{width:columns*cell+(columns+1)*gap,height:y,channels:4,background:'#192016'}}).composite(layers).png().toFile(`${out}/${width===1200?'desktop-'+(part+1):'mobile'}.png`);
  }
 }
});
