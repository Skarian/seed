import {test,expect} from './fixtures.js';
test('Markdown formats during streaming and survives completion safely',async({page})=>{
 await page.addInitScript(()=>{(window as any).EventSource=class {onmessage:any;constructor(){(window as any).chatStream=this;}close(){}};});
 const chat:any={id:'markdown',title:'Markdown test',mode:'sfw',workflow:null,version:0,activity:'thinking',reasoning:true,messages:[],groups:[],assets:[],jobs:[],accounting:[]};
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
 await page.goto('/chat');await page.getByRole('button',{name:'Open chat: Markdown test'}).click();
 async function stream(text:string){chat.partial=text;await page.evaluate(value=>(window as any).chatStream.onmessage({data:JSON.stringify(value)}),chat);}
 await stream('Some **cinematic');await expect(page.locator('.chat-markdown strong')).toHaveText('cinematic');
 const text='## Creative directions\n\n* **Cinematic:** A neon city.\n* **Nature:** A quiet forest.\n\n> Keep the lighting natural.\n\n[Example](https://example.com)\n\n```text\nA long prompt with clear instructions.\n```\n\n| Style | Light |\n| --- | --- |\n| Film | Soft |\n\n<script>window.injected=true</script>\n\n[Unsafe](javascript:alert(1))';
 await stream(text);await expect(page.locator('.chat-markdown li')).toHaveCount(2);await expect(page.locator('.chat-markdown pre')).toContainText('A long prompt');await expect(page.locator('.chat-markdown table')).toBeVisible();expect(await page.evaluate(()=>(window as any).injected)).toBeUndefined();await expect(page.locator('.chat-markdown a[href^="javascript:"]')).toHaveCount(0);
 await page.screenshot({path:'.local/qa-markdown-desktop.png'});
 chat.messages=[{id:'answer',role:'assistant',text,assets:[]}];chat.partial='';chat.activity='idle';await page.evaluate(value=>(window as any).chatStream.onmessage({data:JSON.stringify(value)}),chat);
 await expect(page.locator('.chat-markdown')).toHaveCount(1);await page.reload();await expect(page.locator('.chat-markdown li')).toHaveCount(2);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/qa-markdown-mobile.png'});
});
