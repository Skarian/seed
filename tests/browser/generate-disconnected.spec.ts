import {test,expect} from '@playwright/test';
test('disconnected Generate is disabled and labeled No GPU Available',async({page})=>{
 let connected=false,submissions=0;
 await page.route('**/api/v1/studio',async r=>{const response=await r.fetch();const value=await response.json();value.worker={...value.worker,connected,stale:false};await r.fulfill({json:value});});
 await page.route('**/api/v1/jobs',async r=>{if(r.request().method()==='POST'){submissions++;await r.fulfill({json:{}});}else await r.continue();});
 for(const width of [1200,390]){await page.setViewportSize({width,height:900});await page.goto('/');await page.locator('.prompt-editor textarea').fill('A fox resting beneath a tree in soft morning light.');await expect(page.getByRole('button',{name:'No GPU Available',exact:true})).toBeDisabled();await expect(page.getByText('Unable to generate.',{exact:false})).toHaveCount(0);await page.screenshot({path:'.local/generate-disconnected-'+width+'.png',animations:'disabled'});expect(submissions).toBe(0);}
 connected=true;await expect(page.getByRole('button',{name:'No GPU Available',exact:true})).toHaveCount(0,{timeout:10000});expect(submissions).toBe(0);
});
