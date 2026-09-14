import {test,expect} from '@playwright/test';
test('edit pencil, unknown progress and same-chat branch preserve the page',async({page})=>{
 const request={workflow:'text-to-image',prompt:'A mountain',mode:'sfw',capabilities_revision:'v1',seed:'42',count:1,output:{aspect:'16:9',size:'1mp'}};
 const job:any={id:'j',submission_id:'batch',submission_index:0,state:'running',request,seed:'42',outputs:[],created_at:new Date().toISOString(),source:{chat_id:'c'}};
 const chat={id:'c',title:'Mountains',mode:'sfw',workflow:null,version:0,activity:'idle',reasoning:true,messages:[],assets:[],jobs:[job],groups:[{id:'g',state:'reviewing',cards:[{id:'card',workflow:request.workflow,revisions:[{number:1,decision:'undecided',request,notes:{},job_ids:[]}]}]}]};
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
 await page.route('**/api/v1/jobs**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/j')?job:{items:[job]}}));
 await page.goto('/chat?chat=c');
 await page.getByRole('button',{name:'Edit request',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 await page.locator('.chat-history').click({position:{x:5,y:5}});
 for(const width of [1280,390]){await page.setViewportSize({width,height:844});await page.screenshot({path:`.local/request-pencil-${width}.png`});await page.locator('.job-request-card').screenshot({path:`.local/request-pencil-card-${width}.png`});expect(await page.locator('.job-request-card').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);}
 if(await page.getByRole('button',{name:'Toggle sidebar',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
 await page.locator('.jobs-button').click();await expect(page.locator('.job-loading-spinner')).toBeVisible();await page.screenshot({path:'.local/job-loading-mobile.png'});
 job.generation_percent=37;await expect(page.locator('.job-output-tile')).toContainText('37%');await expect(page.locator('.job-loading-spinner')).toHaveCount(0);
 job.state='completed';await page.getByRole('button',{name:'View job details',exact:true}).click();
 await page.evaluate(()=>{(window as any).__sameDocument=true;});
 await page.getByRole('button',{name:'Create another request',exact:true}).click();await page.getByRole('button',{name:'Branch in Chat',exact:true}).click();await page.getByRole('button',{name:'Same seed',exact:true}).click();
 await expect(page.locator('.branch-draft-preview')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__sameDocument)).toBe(true);
 await expect(page.locator('.job-request-card').first()).toContainText('Text to image');
});
