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
      if(!chat.groups.length)chat.groups=[{id:'group',workflow:'text-to-image',state:'reviewing',cards:[{id:'card',workflow:'text-to-image',revisions:[{number:1,decision:'undecided',notes:{},job_ids:[],request:{workflow:'text-to-image',prompt:'A green valley',mode:'sfw',capabilities_revision:'v1',seed:'random',count:1,output:{aspect:'16:9',size:'1mp'}}}]}]}];
    }
    if(url.pathname.endsWith('/decision'))decisions++;
    await r.fulfill({json:chat});
  });
  await page.goto('/chat');await page.getByRole('button',{name:'New chat',exact:true}).click();
  await expect(page.locator('.chat-composer select')).toHaveCount(0);await expect(page.locator('.active-workflow')).toHaveCount(0);
  const input=page.getByLabel('Chat message');
  await input.fill('/');await expect(page.getByRole('listbox',{name:'Workflows'})).toBeVisible();await expect(page.getByRole('option')).toHaveCount(3);await page.screenshot({path:'.local/qa-slash-desktop.png'});
  await input.fill('/create');await expect(page.getByRole('option')).toHaveCount(2);await input.press('ArrowDown');await input.press('Enter');
  await expect(page.locator('.active-workflow')).toContainText('Create video');await expect(input).toHaveValue('');expect(messages).toHaveLength(0);
  await input.fill('/anim');await page.getByRole('option').click();await expect(page.locator('.active-workflow')).toContainText('Animate image');
  await input.fill('/');await input.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button',{name:'Deactivate workflow'}).click();await expect(page.locator('.active-workflow')).toHaveCount(0);
  await input.fill('/missing');await input.press('Enter');await expect(page.getByRole('alert')).toContainText('No matching workflow');expect(messages).toHaveLength(0);
  await input.fill('/');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.locator('.active-workflow')).toContainText('Create image');expect(messages).toHaveLength(0);
  await page.getByLabel('Chat message').fill('/create-image A valley');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.active-workflow')).toContainText('Create image');await expect.poll(()=>messages[0]?.text).toBe('A valley');expect(decisions).toBe(0);
  await page.getByRole('button',{name:'Review / history'}).click();
  const review=page.getByRole('dialog',{name:'Review generation'});await expect(review).toBeVisible();
  await review.getByLabel('Provide feedback').fill('Make the valley misty');await review.getByLabel('Provide feedback').press('Enter');
  await expect(review).toHaveCount(0);expect(messages[1]).toMatchObject({text:'Make the valley misty',card_id:'card',revision:1});expect(decisions).toBe(0);
  await page.getByRole('button',{name:'Library',exact:true}).first().click();await page.getByRole('button',{name:'Chat',exact:true}).click();
  await expect(page.locator('.active-workflow')).toContainText('Create image');
  await page.reload();await expect(page.getByRole('heading',{name:'A new creation'})).toBeVisible();
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
  await expect(page.getByRole('heading',{name:'New chat',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Rename',exact:true}).click();await page.getByLabel('Chat title').fill('Browser persistence test');await page.getByRole('button',{name:'Save name'}).click();
  await page.reload();await expect(page.getByRole('heading',{name:'Browser persistence test'})).toBeVisible();
  await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete chat',exact:true}).click();await expect(page.getByRole('heading',{name:'Direct your next creation'})).toBeVisible();
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

