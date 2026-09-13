import {test,expect} from '@playwright/test';
import sharp from 'sharp';

test('Chat persists selection, explicitly activates one workflow and sends card feedback',async({page})=>{
  const chat:any={id:'chat-ui',title:'A new creation',mode:'sfw',workflow:null,version:0,epoch:0,reasoning:true,messages:[],groups:[],assets:[],activity:'idle',error:null,jobs:[],accounting:[]};
  let decisions=0;const messages:any[]=[];
  await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/v1/chats**',async r=>{
    const url=new URL(r.request().url()),method=r.request().method();
    if(url.pathname==='/api/v1/chats'&&method==='GET')return r.fulfill({json:{items:[chat]}});
    if(method==='PATCH'){Object.assign(chat,r.request().postDataJSON());chat.version++;}
    if(url.pathname.endsWith('/messages')){
      const body=r.request().postDataJSON();messages.push(body);chat.messages.push({id:'message-'+messages.length,role:'user',text:body.text,assets:[]});chat.version++;
      if(!chat.groups.length)chat.groups=[{id:'group',after_message_id:chat.messages.at(-1).id,workflow:'text-to-image',state:'reviewing',cards:[{id:'card',workflow:'text-to-image',revisions:[{number:1,decision:'undecided',notes:{},job_ids:[],request:{workflow:'text-to-image',prompt:'A green valley',mode:'sfw',capabilities_revision:'v1',seed:'random',count:1,output:{aspect:'16:9',size:'1mp'}}}]}]}];
    }
    if(url.pathname.endsWith('/decision'))decisions++;
    await r.fulfill({json:chat});
  });
  await page.goto('/chat');await page.getByRole('button',{name:'New chat',exact:true}).click();
  await expect(page.locator('.chat-composer select')).toHaveCount(0);await expect(page.locator('.active-workflow')).toHaveCount(0);
  const input=page.getByLabel('Chat message');
  await page.getByRole('button',{name:'Add attachments'}).click();
  await expect(page.getByRole('button',{name:'Add File(s)',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add from Library',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Add from Library',exact:true})).toBeHidden();

  await input.fill('/');await expect(page.getByRole('listbox',{name:'Commands'})).toBeVisible();await expect(page.getByRole('option')).toHaveCount(4);await page.screenshot({path:'.local/qa-slash-desktop.png'});
  await expect(page.getByRole('checkbox',{name:'Reasoning'})).toHaveCount(0);
  await input.fill('/reasoning');await expect(page.getByRole('option')).toContainText('Reasoning · on');await input.press('Enter');await expect.poll(()=>chat.reasoning).toBe(false);await expect(input).toHaveValue('');expect(messages).toHaveLength(0);
  await input.fill('/reasoning');await expect(page.getByRole('option')).toContainText('Reasoning · off');await input.press('Enter');await expect.poll(()=>chat.reasoning).toBe(true);await expect(input).toHaveValue('');
  await input.fill('Before /ref after');await input.evaluate((e:HTMLTextAreaElement)=>{e.setSelectionRange(11,11);e.dispatchEvent(new Event('select',{bubbles:true}));});await input.press('ArrowLeft');await input.press('ArrowRight');await page.getByRole('option').click();await expect(input).toHaveValue('Before /reference-to-video  after');await input.press('Backspace');await expect(input).toHaveValue('Before  after');await expect.poll(()=>chat.workflow).toBe(null);
  await input.fill('/text');await expect(page.getByRole('option')).toHaveCount(2);await input.press('ArrowDown');await input.press('Enter');
  await expect.poll(()=>chat.workflow).toBe('text-to-video');await expect(input).toHaveValue('/text-to-video ');expect(messages).toHaveLength(0);
  await input.fill('/reference');await page.getByRole('option').click();await expect.poll(()=>chat.workflow).toBe('reference-to-video');
  await input.fill('/');await input.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.fill('/reference-to-video ');await input.press('Backspace');await expect(input).toHaveValue('');await expect.poll(()=>chat.workflow).toBe(null);
  await input.fill('/missing');await input.press('Enter');await expect(page.getByRole('alert')).toContainText('No matching command');expect(messages).toHaveLength(0);
  await input.fill('/');await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>chat.workflow).toBe('text-to-image');expect(messages).toHaveLength(0);
  await page.getByLabel('Chat message').fill('/text-to-image A valley');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(()=>chat.workflow).toBe('text-to-image');await expect.poll(()=>messages[0]?.text).toBe('A valley');expect(decisions).toBe(0);
  await page.getByRole('button',{name:'Review / history'}).click();
  const review=page.getByRole('dialog',{name:'Review generation'});await expect(review).toBeVisible();
  await review.getByLabel('Provide feedback').fill('Make the valley misty');await review.getByLabel('Provide feedback').press('Enter');
  await expect(review).toHaveCount(0);await expect(page.locator('.chat-card')).not.toContainText('A green valley');
  expect(await page.locator('.chat-history-content > .chat-message, .chat-history-content > .chat-group').evaluateAll(nodes=>nodes.map(n=>n.classList.contains('chat-group')?'request':n.textContent))).toEqual(['YouA valley','request','YouMake the valley misty']);
  expect(messages[1]).toMatchObject({text:'Make the valley misty',card_id:'card',revision:1});expect(decisions).toBe(0);
  await page.getByRole('button',{name:'Library',exact:true}).first().click();await page.getByRole('button',{name:'Chat',exact:true}).click();
  await expect.poll(()=>chat.workflow).toBe('text-to-image');
  await page.reload();await expect(page.getByRole('button',{name:'Open chat: A new creation'})).toBeVisible();
  chat.groups[0].cards[0].revisions.push({...chat.groups[0].cards[0].revisions[0],number:2,request:{...chat.groups[0].cards[0].revisions[0].request,prompt:'A misty valley'}});chat.version++;
  const card=page.locator('.chat-card');await expect(card.locator('.revision-controls')).toContainText('2/2');await card.getByRole('button',{name:'Previous request revision'}).click();await expect(card.locator('.revision-controls')).toContainText('1/2');await card.click({button:'right',position:{x:30,y:20}});await page.getByRole('button',{name:'Edit request',exact:true}).click();await expect(review.getByRole('textbox',{name:'Prompt',exact:true})).toHaveValue('A green valley');await page.keyboard.press('Escape');await card.getByRole('button',{name:'Next request revision'}).click();
  await page.screenshot({path:test.info().outputPath('chat-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await input.fill('/');await expect(page.getByRole('listbox')).toBeVisible();await page.screenshot({path:'.local/qa-slash-mobile.png'});await input.press('Escape');await input.fill('');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('chat-mobile.png'),fullPage:true});
  await page.route('**/api/v1/chats/chat-ui/cards/card/decision',r=>r.fulfill({status:409,json:{error:{message:'GPU worker is disconnected. Connect it before generating.'}}}));
  await page.getByRole('button',{name:'Review / history'}).click();
  await review.getByRole('button',{name:/^Generate/}).click();
  await expect(review.getByRole('alert')).toContainText('GPU worker is disconnected');
  await expect(review).toBeVisible();

});

test('real Chat API supports rename and delete without a configured model',async({page})=>{
  await page.goto('/chat');await page.getByRole('button',{name:'New chat',exact:true}).click();
  await expect(page.locator('.chat-sidebar > button.selected')).toBeVisible();
  await expect(page.locator('.chat-header')).toHaveCount(0);await page.locator('.chat-sidebar > button.selected').click({button:'right'});await page.getByRole('menuitem',{name:'Rename',exact:true}).click();await page.getByLabel('Chat title').fill('Browser persistence test');await page.getByRole('button',{name:'Save name'}).click();await expect(page.getByRole('dialog',{name:'Rename chat'})).toHaveCount(0);
  await page.reload();await expect(page.getByRole('button',{name:'Open chat: Browser persistence test'})).toBeVisible();
  await page.getByRole('button',{name:'Open chat: Browser persistence test'}).focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Delete',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete chat',exact:true}).click();await expect(page.getByRole('heading',{name:'What shall we create today?'})).toBeVisible();
});

test('Chat upload reaches Library before sending and notes reject stale writes',async({page})=>{
  await page.goto('/chat');await page.getByRole('button',{name:'New chat',exact:true}).click();
  const pixels=await sharp({create:{width:32,height:32,channels:3,background:'#638450'}}).png().toBuffer();
  let assetId='';page.on('response',async response=>{if(response.request().method()==='POST'&&response.url().endsWith('/api/v1/uploads'))assetId=response.headers().location!.split('/').at(-1)!;});
  await page.locator('input[type=file]').setInputFiles({name:'Chat reference.png',mimeType:'image/png',buffer:pixels});
  const modal=page.getByRole('dialog',{name:'Describe assets'});await expect(modal).toBeVisible();
  await modal.getByLabel('Asset note').fill('Green fabric reference');await modal.getByRole('button',{name:'Save note'}).click();
  await expect.poll(async()=>{const response=await page.request.get('/api/v1/notes/'+assetId);return (await response.json()).revision;}).toBe(1);
  await modal.getByRole('button',{name:'Done / Skip'}).click();
  const library=await page.request.get('/api/v1/assets?mode=sfw');expect((await library.json()).items.some((a:any)=>a.id===assetId)).toBe(true);
  const conflict=await page.request.put('/api/v1/notes/'+assetId,{headers:{origin:'http://127.0.0.1:4311'},data:{note:'Stale replacement',revision:0}});expect(conflict.status()).toBe(409);
  expect((await(await page.request.get('/api/v1/notes/'+assetId)).json()).note).toBe('Green fabric reference');
});


test('empty Chat has a centered welcome and bottom composer and creates a conversation on first send',async({page})=>{
  const chat:any={id:'welcome-chat',title:'New chat',mode:'sfw',workflow:null,version:0,epoch:0,reasoning:true,messages:[],groups:[],assets:[],activity:'idle',error:null,jobs:[],accounting:[]};
  let creates=0;
  await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/v1/chats**',async r=>{
    const path=new URL(r.request().url()).pathname;
    if(path==='/api/v1/chats'&&r.request().method()==='GET')return r.fulfill({json:{items:[]}});
    if(path==='/api/v1/chats'&&r.request().method()==='POST')creates++;
    if(path.endsWith('/messages')){chat.messages.push({id:'first',role:'user',text:r.request().postDataJSON().text,assets:[]});chat.version++;}
    await r.fulfill({json:chat});
  });
  await page.goto('/chat');
  await expect(page.getByRole('heading',{name:'What shall we create today?'})).toBeVisible();
  expect(creates).toBe(0);
  await page.screenshot({path:'.local/qa-welcome-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.local/qa-welcome-mobile.png'});
  const box=await page.locator('.chat-composer').boundingBox();expect(box!.y).toBeGreaterThan(650);expect(box!.y+box!.height).toBeLessThanOrEqual(844);
  await page.setViewportSize({width:390,height:500});await page.screenshot({path:'.local/qa-welcome-keyboard.png'});const compact=await page.locator('.chat-composer').boundingBox();expect(compact!.y+compact!.height).toBeLessThanOrEqual(500);await expect(page.getByRole('heading',{name:'What shall we create today?'})).toBeVisible();
  await page.getByLabel('Chat message').fill('A quiet mountain lake');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.chat-message.user')).toContainText('A quiet mountain lake');
  await expect(page.locator('.chat-welcome-heading')).toHaveCount(0);expect(creates).toBe(1);
});

test('mobile chat menu survives finger release and supports a separate action tap',async({page})=>{
 const base={mode:'sfw',workflow:null,version:0,reasoning:true,messages:[],groups:[],assets:[],activity:'idle',jobs:[],accounting:[]};
 const chats=[{...base,id:'one',title:'First chat'},{...base,id:'two',title:'Second chat'}];
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:chats}:chats[0]}));
 await page.setViewportSize({width:390,height:844});await page.goto('/chat');await page.getByRole('button',{name:'Toggle sidebar'}).click();
 const row=page.getByRole('button',{name:'Open chat: Second chat'});const box=await row.boundingBox();const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box!.x+30,y:box!.y+15}]});
 const menu=page.getByRole('menu',{name:'Chat actions: Second chat'});await expect(menu).toBeVisible();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(menu).toBeVisible();await expect(row).not.toHaveClass('selected');
 await page.screenshot({path:'.local/qa-chat-hold-release.png'});
 const action=await page.getByRole('menuitem',{name:'Rename'}).boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:action!.x+30,y:action!.y+15}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('dialog',{name:'Rename chat'})).toBeVisible();await expect(page.getByLabel('Chat title')).toHaveValue('Second chat');
});
