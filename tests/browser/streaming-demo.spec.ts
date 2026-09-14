import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
test('record streaming interaction proposal',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1100,height:850},recordVideo:{dir:'.local/streaming-recordings',size:{width:1100,height:850}}});const page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/streaming-demo',async r=>r.fulfill({contentType:'text/html',body:await fs.readFile('.local/streaming-demo.html')}));await page.goto('http://127.0.0.1:4311/streaming-demo');await page.addStyleTag({content:'#result{height:160px}'});
 await page.evaluate(()=> (window as any).runDemo());await expect(page.locator('#retry-status')).toHaveText('Succeeded');await expect(page.locator('.outer')).toHaveAttribute('open','');expect(errors).toEqual([]);await page.screenshot({path:'.local/streaming-demo-final.png'});
 const video=page.video()!;await context.close();await video.saveAs('.local/seed-streaming-preview.webm');
});
