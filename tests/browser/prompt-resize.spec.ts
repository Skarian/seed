import {test,expect} from './fixtures.js';
import fs from 'node:fs/promises';

for(const mobile of [false,true])test(`prompt resize handles across editors (${mobile?'touch':'mouse'})`,async({page})=>{
 await page.setViewportSize({width:mobile?390:1200,height:950});
 const session=await page.context().newCDPSession(page);
 if(mobile)await session.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 await fs.mkdir('.local/prompt-resize',{recursive:true});
 const refs=[{id:'image',asset_id:'image',kind:'image',role:'reference',framing:'fit'}];
 let workflow='reference-to-video';
 function chat(){return {id:'resize',title:'Resize',mode:'sfw',workflow,version:0,epoch:0,activity:'idle',reasoning:true,assets:[],asset_manifest:[],jobs:[],messages:[],groups:[{id:'g',state:'reviewing',cards:[{id:'c',workflow,revisions:[{number:1,request:{workflow,mode:'sfw',prompt:'Keep the soft lighting and use a slow camera movement. '.repeat(15),count:1,seed:'random',references:workflow==='reference-to-video'?refs:[],output:{aspect:'16:9',size:'768p',duration_seconds:5}},decision:'undecided',job_ids:[],notes:{}}]}]}]};}
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[]}:chat()}));
 async function resize(editor:ReturnType<typeof page.locator>,name:string,chatEditor=false){
  const wrapper=editor.locator('..'),grip=wrapper.getByRole('button',{name:'Resize prompt',exact:true});
  await grip.scrollIntoViewIfNeeded();const before=await editor.evaluate(e=>e.getBoundingClientRect().height),box=(await grip.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(mobile?44:32);expect(before).toBeGreaterThanOrEqual(mobile?(chatEditor?140:200):100);
  const x=box.x+box.width/2,y=box.y+box.height/2,delta=chatEditor?-100:100;
  if(mobile){await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=5;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+delta*i/5}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+delta,{steps:5});await page.mouse.up();}
  const after=await editor.evaluate(e=>e.getBoundingClientRect().height);expect(after-before).toBeGreaterThan(85);
  await page.screenshot({path:`.local/prompt-resize/${name}-${mobile?'mobile':'desktop'}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await editor.fill('A long line of prompt text to check the resize grip never covers words. '.repeat(60));
  for(const fraction of [0,.5,1]){
   const safe=await editor.evaluate((e,fraction)=>{e.scrollTop=(e.scrollHeight-e.clientHeight)*fraction;const style=getComputedStyle(e),box=e.getBoundingClientRect(),grip=e.parentElement!.querySelector('.prompt-resize-grip')!.getBoundingClientRect();return box.right-parseFloat(style.paddingRight)<=grip.left;},fraction);
   expect(safe).toBe(true);
  }
  await grip.focus();await page.keyboard.press('ArrowUp');expect(await editor.evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(after);
 }
 await page.goto('/');await resize(page.locator('#prompt'),'generate');
 await page.goto('/chat?chat=resize');const chatEditor=page.getByRole('combobox',{name:'Chat message'});await expect(page.locator('.chat-composer').getByRole('button',{name:'Resize prompt'})).toHaveCount(0);const initial=await chatEditor.evaluate(e=>e.clientHeight);await chatEditor.fill('A longer chat message. '.repeat(30));expect(await chatEditor.evaluate(e=>e.clientHeight)).toBeGreaterThan(initial);
 await page.getByRole('button',{name:'Review / history',exact:true}).click();await expect(page.getByRole('button',{name:'Expand',exact:true})).toHaveCount(0);await resize(page.locator('#review-prompt'),'review-reference');
 await page.getByRole('button',{name:'Close review'}).click();workflow='text-to-image';await page.reload();await page.getByRole('button',{name:'Review / history',exact:true}).click();await resize(page.locator('#review-prompt'),'review-image');
});
