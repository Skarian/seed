import {test,expect,type Page} from './fixtures.js';
test('mobile credential and request actions have usable touch targets',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/admin');await expect(page.locator('.credential-actions').first()).toBeVisible();
 for(const action of await page.locator('.credential-actions button,.credential-actions a').all())expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.goto('/chat');await page.getByRole('combobox',{name:'Chat message'}).fill('/text-to-image A mountain lake');await page.getByRole('combobox',{name:'Chat message'}).press('Enter');
 await expect(page.getByRole('button',{name:'Approve',exact:true})).toBeEnabled();
 for(const name of ['Edit request','Deny','Approve'])expect((await page.getByRole('button',{name,exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
async function ready(page:Page) {
 await page.route('**/api/v1/studio',r=>r.fulfill({json:{pool:{active:0,ready:0,busy:0,preparing:0,needs_attention:0,hourly:0,estimated_spend:0,image:0,video:0},activity:{active:0,waiting:0,needs_attention:0},outputs:{pending:0}}}));
 await page.route('**/api/v1/loras*',r=>r.fulfill({json:{items:[{id:'image-adapter',revision:'sha-image',name:'Krea adapter',route:'image',format:'lokr',compatibility:'untested'},{id:'video-adapter',revision:'sha-video',name:'H3 frame adapter',route:'fl',format:'lora',compatibility:'untested'}]}}));
 await page.route('**/api/v1/jobs',r=>r.request().method()==='POST'?r.fulfill({status:202,json:{submission_id:'test',jobs:[]}}):r.fulfill({json:{items:[]}}));
}
test('drafting is available without provider credentials',async({page})=>{
 await page.route('**/api/v1/studio',r=>r.fulfill({json:{pool:{active:0,ready:0,busy:0,preparing:0,needs_attention:0,hourly:0,estimated_spend:0,image:0,video:0},activity:{active:0,waiting:0,needs_attention:0},outputs:{pending:0}}}));
 await page.goto('/');await expect(page.getByRole('button',{name:/^Create image/})).toBeDisabled();await page.getByLabel('Prompt',{exact:true}).fill('A quiet lake');await expect(page.getByRole('button',{name:/^Create image/})).toBeEnabled();
 await expect(page.getByRole('button',{name:'GPU workers',exact:true})).toBeVisible();await expect(page.locator('.cost-preview')).toHaveCount(0);await expect(page.getByRole('button',{name:/Pod connection/})).toHaveCount(0);await expect(page.getByLabel('Connection code',{exact:true})).toHaveCount(0);
});
test('Krea sends explicit pinned adapters and keeps strength after reload',async({page})=>{
 await ready(page);await page.goto('/');await page.getByLabel('Prompt',{exact:true}).fill('A quiet cafe');
 await page.getByRole('checkbox',{name:'Krea adapter'}).check();await page.getByLabel('Strength',{exact:true}).fill('1.7');await page.reload();
 await expect(page.getByLabel('Strength',{exact:true})).toHaveValue('1.7');
 const sent=page.waitForRequest(r=>r.url().endsWith('/api/v1/jobs')&&r.method()==='POST');await page.getByRole('button',{name:/^Create image/}).click();
 expect((await sent).postDataJSON()).toMatchObject({workflow:'text-to-image',loras:[{id:'image-adapter',revision:'sha-image',scale:1.7}]});
});
test('H3 has one quality path and only shows matching adapters',async({page})=>{
 await ready(page);await page.goto('/');await page.getByRole('button',{name:'Text to video',exact:true}).click();await page.getByLabel('Prompt',{exact:true}).fill('A sailboat crosses a pond');
 await expect(page.getByText('H3 · 768P',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Advanced',exact:true})).toHaveCount(0);await expect(page.getByLabel('Seed mode')).toBeVisible();await expect(page.getByRole('combobox',{name:'Export',exact:true})).toHaveCount(0);await expect(page.getByRole('option',{name:'Fast',exact:true})).toHaveCount(0);
 await expect(page.getByRole('checkbox',{name:'H3 frame adapter'})).toBeVisible();await expect(page.getByRole('checkbox',{name:'Krea adapter'})).toHaveCount(0);
 const sent=page.waitForRequest(r=>r.url().endsWith('/api/v1/jobs')&&r.method()==='POST');await page.getByRole('button',{name:/^Create video/}).click();expect((await sent).postDataJSON()).toMatchObject({output:{size:'768p'},loras:[]});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/worker-forms-mobile.png',fullPage:true});
});
