import {test,expect} from '@playwright/test';
test('connection loss disables Send and recovery preserves the draft without sending',async({page})=>{
 let offline=false,sends=0;
 await page.route('**/api/v1/chat-config',r=>offline?r.abort():r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>{if(r.request().method()==='POST')sends++;return offline?r.abort():r.fulfill({json:{items:[]}});});
 await page.goto('/chat');const input=page.getByLabel('Chat message');await input.fill('A forest scene');await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 offline=true;await expect(page.getByText('⟳ Reconnecting…')).toBeVisible();await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();await input.fill('A forest scene at sunrise');await input.press('Enter');expect(sends).toBe(0);
 await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible({timeout:10000});offline=false;await page.getByRole('button',{name:'Reconnect',exact:true}).click();await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();await expect(input).toHaveText('A forest scene at sunrise');expect(sends).toBe(0);
});

