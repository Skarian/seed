import {test,expect} from './fixtures.js';
test('switching chats does not show the new-chat welcome while loading',async({page})=>{
 const base={mode:'sfw',workflow:null,version:0,epoch:0,reasoning:true,groups:[],assets:[],activity:'idle',error:null,jobs:[],accounting:[]};
 const first={...base,id:'first',title:'First chat',messages:[{id:'m1',role:'user',text:'First message',assets:[]}]};
 const second={...base,id:'second',title:'Second chat',messages:[{id:'m2',role:'user',text:'Second message',assets:[]}]};
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.addInitScript(()=>{(window as any).EventSource=class{close(){}}});
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/api/v1/chats')return r.fulfill({json:{items:[first,second]}});
  if(path.endsWith('/second')){await gate;return r.fulfill({json:second});}
  return r.fulfill({json:first});
 });
 await page.goto('/chat?chat=first');
 await expect(page.getByText('First message',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open chat: Second chat',exact:true}).click();
 await expect(page.locator('.chat-welcome-heading')).toHaveCount(0);
 await expect(page.locator('.chat-main')).not.toHaveClass(/chat-welcome/);
 release();
 await expect(page.getByText('Second message',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New chat',exact:true}).click();
 await expect(page.getByText('What shall we create today?',{exact:true})).toBeVisible();
});
