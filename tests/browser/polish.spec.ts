import {test,expect} from '@playwright/test';
test('responsive shell, modal focus, keyboard space and streaming text',async({page})=>{
 const chat:any={id:'polish',title:'A quiet morning',mode:'sfw',workflow:'text-to-image',version:0,epoch:0,reasoning:true,activity:'thinking',error:null,assets:[],jobs:[],accounting:[],messages:[{id:'u',role:'user',text:'A candid photograph of a golden doodle puppy, like an everyday camera photo.',assets:[]},{id:'a',role:'assistant',text:'I will keep the light natural and the framing relaxed. You can adjust the prompt or send feedback before approving.',assets:[]}],groups:[{id:'g',workflow:'text-to-image',state:'reviewing',cards:[{id:'card',workflow:'text-to-image',revisions:[{number:1,decision:'undecided',notes:{},job_ids:[],request:{workflow:'text-to-image',mode:'sfw',capabilities_revision:'test',seed:'random',count:1,output:{aspect:'16:9',size:'1mp'},prompt:'An everyday photograph of a fluffy golden doodle puppy sitting on a living room rug. Soft window light, relaxed eye-level framing, natural colors and a gently blurred background.'}}]}]}]};
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>{if(r.request().url().endsWith('/events'))return r.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({partial:'The light falls softly across the room.',activity:chat.activity,error:null})+'\n\n'});return r.fulfill({json:r.request().url().includes('?mode=')?{items:[chat]}:chat});});
 await page.goto('/chat');await page.getByRole('button',{name:'Open chat: A quiet morning'}).click();
 await expect(page.getByText('The light falls softly across the room.')).toBeVisible();
 await page.screenshot({path:'.local/qa-chat-desktop.png'});
 chat.activity='idle';await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Review / history'}).click();const dialog=page.getByRole('dialog',{name:'Review generation'});
 await expect(dialog).toBeVisible();await expect(page.locator('body')).toHaveAttribute('data-scroll-locked',/.+/);
 await page.screenshot({path:'.local/qa-review-desktop.png'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('navigation')).toHaveCount(0);await page.screenshot({path:'.local/qa-chat-mobile.png'});
 await page.getByRole('button',{name:'Toggle sidebar'}).click();const drawer=page.getByRole('dialog',{name:'Sidebar'});await expect(drawer).toBeVisible();const width=(await drawer.boundingBox())!.width;expect(width).toBeGreaterThan(280);expect(width).toBeLessThan(330);await page.screenshot({path:'.local/qa-sidebar-mobile.png'});await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
 await page.setViewportSize({width:390,height:480});await page.getByLabel('Chat message').focus();await expect.poll(async()=>{const b=await page.locator('.chat-composer').boundingBox();return b!.y+b!.height;}).toBeLessThanOrEqual(480);await page.screenshot({path:'.local/qa-keyboard-space.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Review / history'}).click();await expect(dialog).toBeVisible();await page.screenshot({path:'.local/qa-review-mobile.png'});
 const scrollBefore=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,700);expect(await page.evaluate(()=>scrollY)).toBe(scrollBefore);
 await page.keyboard.press('Escape');chat.groups=[];chat.messages=Array.from({length:40},(_,i)=>({id:'long-'+i,role:i%2?'assistant':'user',text:'Message '+i+': '+('A natural photograph with warm light and room for the subject. '.repeat(12)),assets:[]}));
 await expect(page.locator('.chat-message')).toHaveCount(40);await page.locator('.chat-history').evaluate(e=>e.scrollTop=e.scrollHeight);
 const bounds=await page.locator('.chat-composer').boundingBox();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(844);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/qa-long-chat.png'});
});


test('streaming follows near the bottom and preserves the reader position above it',async({page})=>{
 await page.addInitScript(()=>{(window as any).EventSource=class {onmessage:any;constructor(){(window as any).chatStream=this;}close(){}};});
 const chat:any={id:'scrolling',title:'Scroll test',mode:'sfw',workflow:null,version:0,activity:'thinking',reasoning:true,partial:'Starting',groups:[],assets:[],jobs:[],accounting:[],messages:Array.from({length:25},(_,i)=>({id:String(i),role:'assistant',text:('Message '+i+' with some detail. ').repeat(20),assets:[]}))};
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
 await page.goto('/chat');await page.getByRole('button',{name:'Open chat: Scroll test'}).click();
 const history=page.locator('.chat-history');const gap=()=>history.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight);
 await expect.poll(gap).toBeLessThan(2);
 async function stream(){chat.partial+=' More streamed text with enough content to wrap across several lines.'.repeat(15);await page.evaluate(value=>(window as any).chatStream.onmessage({data:JSON.stringify({partial:value,activity:'thinking'})}),chat.partial);}
 for(let i=0;i<3;i++){await stream();await expect.poll(gap).toBeLessThan(2);}
 await history.evaluate(e=>{e.scrollTop-=500;e.dispatchEvent(new Event('scroll'));});const above=await history.evaluate(e=>e.scrollTop);
 await stream();await expect.poll(()=>history.evaluate(e=>e.scrollTop)).toBe(above);
 await history.evaluate(e=>{e.scrollTop=e.scrollHeight-e.clientHeight-40;e.dispatchEvent(new Event('scroll'));});
 await stream();await expect.poll(gap).toBeLessThan(2);
 await page.setViewportSize({width:390,height:480});await expect.poll(gap).toBeLessThan(2);
 await history.locator('.chat-history-content').evaluate(e=>{const image=document.createElement('div');image.style.height='300px';e.append(image);});await expect.poll(gap).toBeLessThan(2);
});
