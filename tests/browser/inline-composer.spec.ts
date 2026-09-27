import {test,expect} from './fixtures.js';
test('inline workflow badges survive sending and rename is compact across sizes',async({page})=>{
 let chat:any={id:'inline',title:'A long chat name for a creative project',mode:'sfw',version:0,epoch:0,workflow:null,reasoning:true,activity:'idle',assets:[],jobs:[],accounting:[],groups:[],messages:[]};
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>{
  const req=r.request(),path=new URL(req.url()).pathname;
  if(req.method()==='PATCH'){chat={...chat,...req.postDataJSON(),version:chat.version+1};}
  if(path.endsWith('/messages')&&req.method()==='POST'){const body=req.postDataJSON();chat={...chat,messages:[...chat.messages,{id:'m'+chat.messages.length,role:'user',text:body.text,assets:[],created_at:new Date().toISOString()}],version:chat.version+1};}
  return r.fulfill({json:path==='/api/v1/chats'?{items:[chat]}:chat});
 });
 await page.setViewportSize({width:1440,height:900});await page.goto('/chat?chat=inline');
 const editor=page.getByRole('combobox',{name:'Chat message'});
 await editor.fill('Before /text-to-i');await page.getByRole('option',{name:/Text to image/}).click();
 await expect(editor.locator('.command-badge')).toHaveText('Text to image×');
 await page.keyboard.insertText('after');await expect(editor).toContainText('Before Text to image× after');
 await page.screenshot({path:'.local/inline-composer-desktop.png'});
 await editor.press('Enter');await expect(page.locator('.chat-message.user .command-badge')).toHaveText('Text to image');
 expect(chat.messages[0].text).toBe('Before /text-to-image after');
 await editor.fill('A /text-to-video B');await editor.getByRole('button',{name:'Remove Text to video'}).click();await expect(editor).toHaveText('A  B');
 await editor.fill('A /text-to-image ');await editor.press('End');await editor.press('Backspace');await expect(editor.locator('.command-badge')).toHaveCount(0);
 await editor.fill('Before /reference-to-video after');await page.reload();await expect(editor.locator('.command-badge')).toHaveText('Reference to video×');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});if(width===390)await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:'Open chat: '+chat.title}).click({button:'right'});await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Rename chat'});await expect(dialog).toBeVisible();expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({path:'.local/rename-chat-'+width+'.png'});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 }
 expect((await page.request.get('/favicon.svg')).status()).toBe(200);expect(errors).toEqual([]);
});


