import {test,expect,type Page} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/api/v1/estimates',r=>{const input=r.request().postDataJSON();return r.fulfill({json:{id:'fixture-estimate',total:.01*input.count,per_item:.01,count:input.count,breakdown:'Fixture estimate',expires_at:new Date(Date.now()+600000).toISOString()}});});});
async function ready(page:Page) {
 await page.route('**/api/v1/studio',r=>r.fulfill({json:{provider:{name:'fal',configured:true},activity:{active:0,waiting:0,needs_attention:0},outputs:{pending:0}}}));
 await page.route('**/api/v1/loras*',r=>r.fulfill({json:{items:[{id:'image-adapter',revision:'sha-image',name:'Krea adapter',route:'image',format:'lokr',compatibility:'untested'},{id:'video-adapter',revision:'sha-video',name:'H3 frame adapter',route:'fl',format:'lora',compatibility:'untested'}]}}));
 await page.route('**/api/v1/jobs',r=>r.request().method()==='POST'?r.fulfill({status:202,json:{submission_id:'test',jobs:[]}}):r.fulfill({json:{items:[]}}));
}
test('fal setup replaces GPU connection controls',async({page})=>{
 await page.route('**/api/v1/studio',r=>r.fulfill({json:{provider:{name:'fal',configured:false},activity:{active:0,waiting:0,needs_attention:0},outputs:{pending:0}}}));
 await page.goto('/');await expect(page.getByRole('button',{name:'Configure fal to generate',exact:true})).toBeDisabled();
 await expect(page.getByText('Add your fal key in Admin → Credentials to enable generation.')).toBeVisible();await expect(page.getByRole('button',{name:/fal:|Pod connection/})).toHaveCount(0);await expect(page.getByLabel('Connection code',{exact:true})).toHaveCount(0);
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
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/fal-mobile.png',fullPage:true});
});
