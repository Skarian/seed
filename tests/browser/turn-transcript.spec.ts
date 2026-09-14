import {test,expect} from '@playwright/test';
const at='2026-09-13T10:00:00Z';
const initial:any={id:'transcript',title:'Transcript QA',mode:'sfw',version:0,epoch:0,workflow:null,reasoning:true,activity:'thinking',assets:[],jobs:[],groups:[],messages:[{id:'user',role:'user',text:'Prepare a café scene.',assets:[]},{id:'run',role:'assistant',text:'',assets:[],transcript:{started_at:at,state:'running',steps:[{id:'r',kind:'reasoning',text:'I’ll prepare the request using your references.',started_at:at},{id:'t1',kind:'tool',name:'animate_image',state:'running',input:{operations:[{operation:'create',request:{prompt:'A café scene',quality:'high',output:{size:'720p'}}}]},started_at:at}]}}]};
test('streaming transcript retains disclosures, payloads and scroll, with responsive layouts',async({page})=>{
 let chat=structuredClone(initial);chat.messages[1].transcript.started_at=new Date().toISOString();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{(window as any).EventSource=class {onmessage:any;onopen:any;constructor(){(window as any).source=this}close(){}}});
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[]}:chat}));
 await page.goto('/chat?chat=transcript');await expect(page.locator('.turn-toggle')).toHaveAttribute('aria-expanded','true');await expect(page.locator('.turn-tool')).not.toHaveAttribute('open','');await page.locator('.turn-tool>summary').click();await expect(page.locator('.turn-payload').first()).toContainText('720p');
 const push=async()=>page.evaluate(value=>(window as any).source.onmessage({data:JSON.stringify({activity:value.activity,stream_message:value.messages[1]})}),chat);
 const turn=chat.messages[1].transcript;turn.steps[1].state='failed';turn.steps[1].result={content:[{type:'text',text:'High Quality requires native output. '+('Technical detail. '.repeat(100))}]};await push();await expect(page.locator('.turn-tool')).toHaveAttribute('open','');
 const pre=page.locator('.turn-payload pre').last();await pre.evaluate(e=>e.scrollTop=80);const before=await pre.evaluate(e=>e.scrollTop);
 turn.steps.push({id:'r2',kind:'reasoning',text:'I’ll correct the output size.',started_at:at});await push();expect(await pre.evaluate(e=>e.scrollTop)).toBe(before);
 turn.steps.push({id:'t2',kind:'tool',name:'animate_image',state:'succeeded',input:{operations:[{operation:'create',request:{output:{size:'native'}}}]},result:{content:[{type:'text',text:'Request saved · revision 1'}]},started_at:at,ended_at:at});turn.state='completed';turn.ended_at=new Date().toISOString();chat.activity='idle';chat.messages[1].text='Your request is ready to review.';await push();await expect(page.locator('.turn-toggle')).toHaveAttribute('aria-expanded','false');await page.locator('.turn-toggle').click();await expect(page.locator('.turn-tool').first()).toHaveAttribute('open','');await expect(page.locator('.turn-tool')).toHaveCount(2);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/transcript-live-'+width+'.png'});}
 await page.reload();await expect(page.locator('.turn-toggle')).toContainText('Worked for');await page.locator('.turn-toggle').click();await expect(page.locator('.turn-tool')).toHaveCount(2);
 turn.state='stopped';chat.messages[1].text='';await page.reload();await expect(page.locator('.turn-toggle')).toContainText('Stopped after');await expect(page.locator('.chat-message.assistant')).not.toContainText('Your request is ready');
 expect(errors).toEqual([]);
});

test('streaming reasoning uses the main chat scroll and respects scrolling up',async({page})=>{
 const chat=structuredClone(initial);
 const turn=chat.messages[1].transcript;
 turn.steps=[{id:'r',kind:'reasoning',text:'Thinking through the request.\n\n'.repeat(45),started_at:at}];
 await page.addInitScript(()=>{(window as any).EventSource=class {onmessage:any;constructor(){(window as any).source=this}close(){}}});
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[]}:chat}));
 await page.goto('/chat?chat=transcript');
 const steps=page.locator('.chat-history');
 await expect(page.locator('.turn-steps')).toHaveCSS('max-height','none');
 await expect(page.locator('.turn-steps')).toHaveCSS('overflow-y','visible');
 const gap=()=>steps.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
 await expect.poll(gap).toBeLessThan(2);
 const push=async()=>{turn.steps[0].text+='More reasoning.\n\n'.repeat(15);await page.evaluate(value=>(window as any).source.onmessage({data:JSON.stringify({activity:'thinking',stream_message:value})}),chat.messages[1]);};
 await push();await expect.poll(gap).toBeLessThan(2);
 // A small upward gesture inside the old 80px threshold must win over streaming.
 await steps.hover();await page.mouse.wheel(0,-20);
 await expect.poll(gap).toBeGreaterThan(5);
 const held=await steps.evaluate(el=>el.scrollTop);
 await push();await push();
 await expect.poll(()=>steps.evaluate(el=>el.scrollTop)).toBe(held);
 await steps.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
 await push();await expect.poll(gap).toBeLessThan(2);
 // Touch intent cancels a queued follow before the browser moves the viewport.
 await steps.evaluate(el=>{for(const [type,y] of [['touchstart',200],['touchmove',220]] as const){const event=new Event(type,{bubbles:true});Object.defineProperty(event,'touches',{value:[{clientY:y}]});el.dispatchEvent(event);}});
 const touchHeld=await steps.evaluate(el=>el.scrollTop);
 await push();await expect.poll(()=>steps.evaluate(el=>el.scrollTop)).toBe(touchHeld);
 await steps.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
 await push();await expect.poll(gap).toBeLessThan(2);
 await steps.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
 await push();await expect.poll(()=>steps.evaluate(el=>el.scrollTop)).toBe(0);
 await steps.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
 await push();await expect.poll(gap).toBeLessThan(2);
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  await push();await expect.poll(gap).toBeLessThan(2);
  await page.screenshot({path:'.local/single-scroll-'+width+'.png'});
 }
 turn.steps.push({id:'final',kind:'text',text:'Ready to review.',started_at:at});
 chat.messages[1].text='Ready to review.';
 await page.evaluate(value=>(window as any).source.onmessage({data:JSON.stringify({activity:'thinking',stream_message:value})}),chat.messages[1]);
 await expect(page.locator('.turn-toggle')).toHaveAttribute('aria-expanded','false');
 await expect.poll(gap).toBeLessThan(2);
});
