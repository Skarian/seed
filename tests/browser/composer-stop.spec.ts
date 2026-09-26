import {test,expect} from './fixtures.js';
for(const activity of ['thinking','generating'])test(`composer has one action while ${activity}`,async({page})=>{
 const chat={id:'stop-test',title:'Test',mode:'sfw',workflow:null,version:0,epoch:0,reasoning:true,activity,messages:[],groups:[],jobs:[],assets:[]};let stops=0;
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>{const url=new URL(r.request().url());if(url.pathname.endsWith('/stop')){stops++;chat.activity='idle';}return r.fulfill({json:url.pathname==='/api/v1/chats'?{items:[]}:chat});});
 await page.goto('/chat?chat=stop-test');const actions=page.locator('.composer-actions');await expect(actions.getByRole('button',{name:'Stop',exact:true})).toBeVisible();await expect(actions.getByRole('button',{name:'Send',exact:true})).toHaveCount(0);
 await actions.getByRole('button',{name:'Stop',exact:true}).click();
 if(activity==='generating'){
 const dialog=page.getByRole('dialog',{name:'Stop this chat?'});await expect(dialog).toBeVisible();expect(stops).toBe(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(stops).toBe(0);await actions.getByRole('button',{name:'Stop',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/stop-confirmation-mobile.png'});await dialog.getByRole('button',{name:'Stop chat and jobs',exact:true}).click();
 }
 await expect.poll(()=>stops).toBe(1);await expect(actions.getByRole('button',{name:'Send',exact:true})).toBeVisible();await expect(actions.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
});
test('Generate workflow selection lives only in sidebar',async({page})=>{await page.goto('/');await expect(page.locator('main .workflow-select')).toHaveCount(0);await expect(page.locator('.sidebar-section').filter({hasText:'Workflows'})).toBeVisible();});
