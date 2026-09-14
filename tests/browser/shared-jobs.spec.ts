import {test,expect} from '@playwright/test';
const request={workflow:'text-to-image',prompt:'A mountain in soft morning light',mode:'sfw',capabilities_revision:'v1',seed:'random',count:3,note:'Mountain study',output:{aspect:'16:9',size:'1mp'}};
const jobs=['completed','running','failed'].map((state,i)=>({id:'job'+i,submission_id:'batch',submission_index:i,state,request,seed:String(4100+i),outputs:i===0?['output']:[],generation_percent:62,error:i===2?'GPU connection lost':null,created_at:'2026-09-13T15:42:00Z',updated_at:'2026-09-13T15:43:00Z',source:{chat_id:'test'},graph:{},input_snapshot:[]}));
const chat={id:'test',title:'Job design',mode:'sfw',workflow:null,version:0,epoch:0,activity:'idle',reasoning:true,messages:[],assets:[],jobs,accounting:[],groups:[{id:'g',workflow:'text-to-image',state:'released',cards:[{id:'c',workflow:'text-to-image',revisions:[{number:1,decision:'approved',request,notes:{},job_ids:jobs.map(j=>j.id)}]}]},{id:'g2',workflow:'text-to-image',state:'reviewing',cards:[{id:'c2',workflow:'text-to-image',revisions:[{number:1,decision:'undecided',request,notes:{},job_ids:[]}]}]}]};
test('shared output states, filters, details and compact layouts',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/jobs**',r=>r.fulfill({json:{items:jobs,next_cursor:null}}));
 await page.route('**/api/v1/assets/output',r=>r.fulfill({json:{name:'Mountain',kind:'image'}}));
 await page.route('**/api/v1/assets/output/content',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#647c77"/><path d="M0 400 270 50 600 400" fill="#d9deca"/></svg>'}));
 await page.goto('/chat?chat=test');
 await expect(page.locator('.job-request-card')).toHaveCount(2);
 await expect(page.locator('.job-request-card .job-output-tiles')).toHaveCount(0);
 await expect(page.locator('.job-chat-wrap > .job-output-tiles')).toHaveCount(1);
 await expect(page.locator('.job-chat-wrap .revision-controls')).toHaveCount(0);
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:844});await page.locator('.chat-history').evaluate(e=>e.scrollTop=0);for(const card of await page.locator('.job-request-card').all())expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({animations:'disabled',path:'.local/jobs-chat-'+width+'.png'});}
 await page.setViewportSize({width:1280,height:900});
 await page.getByRole('button',{name:'View job details',exact:true}).first().click();
 await expect(page.getByRole('dialog',{name:'Job details'})).toBeVisible();
 await page.getByRole('dialog',{name:'Job details'}).locator('button.job-output-tile.failed').click();
 await expect(page.locator('.job-output-detail')).toContainText('could not be completed');
 await page.screenshot({animations:'disabled',path:'.local/jobs-detail-desktop.png'});
 await page.getByRole('dialog',{name:'Job details'}).locator('button.job-output-tile.completed').click();
 await expect(page.getByRole('button',{name:'Expand preview',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Open full screen preview',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Media preview'})).toBeVisible();
 await page.getByRole('button',{name:'Close preview',exact:true}).click();
 await page.getByRole('button',{name:'Close job details'}).click();
 if(await page.getByRole('button',{name:'Toggle sidebar',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await page.locator('.jobs-button').click();
 await page.getByRole('button',{name:'Errors',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Jobs',exact:true});
 await expect(modal.locator('.job-output-tile')).toHaveCount(1);
 await expect(modal.locator('.job-output-tile')).toHaveClass(/failed/);
 await page.screenshot({animations:'disabled',path:'.local/jobs-errors-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({animations:'disabled',path:'.local/jobs-errors-mobile.png'});
 expect(errors).toEqual([]);
});





test('direct approval sends the current revision and preserves an approval error',async({page})=>{
 let approved=false;
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/decision')){expect(r.request().postDataJSON()).toEqual({revision:1,decision:'approved'});approved=true;return r.fulfill({status:409,json:{error:{message:'GPU is unavailable. Reconnect and try again.'}}});}
  return r.fulfill({json:path==='/api/v1/chats'?{items:[chat]}:chat});
 });
 await page.goto('/chat?chat=test');
 await page.locator('.job-chat-wrap').getByRole('button',{name:'Approve',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Review generation'});
 await expect(dialog.getByRole('alert')).toHaveText('GPU is unavailable. Reconnect and try again.');
 await expect(page.locator('.chat-composer [role=alert]')).toHaveCount(0);
 expect(approved).toBe(true);
});

test('approval and denial update the card, with input previews on mobile',async({page})=>{
 const data=structuredClone(chat);data.jobs=[];data.groups=[data.groups[1]!];
 Object.assign(data.groups[0]!.cards[0]!.revisions[0]!.request,{references:[{asset_id:'input',kind:'image',role:'reference'}]});
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/assets/input',r=>r.fulfill({json:{id:'input',kind:'image',name:'Reference',width:80,height:80}}));
 await page.route('**/api/v1/assets/input/content',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#647c77"/></svg>'}));
 await page.route('**/api/v1/chats**',r=>{const path=new URL(r.request().url()).pathname;if(path.endsWith('/decision'))data.groups[0]!.cards[0]!.revisions[0]!.decision=r.request().postDataJSON().decision;return r.fulfill({json:path==='/api/v1/chats'?{items:[data]}:data});});
 await page.setViewportSize({width:390,height:844});await page.goto('/chat?chat=test');
 const card=page.locator('.job-chat-wrap');await expect(card).toContainText('1 input');await expect(card.locator('.asset-thumbnail')).toBeVisible();
 await page.screenshot({path:'.local/request-input-pending-mobile.png'});
 await card.getByRole('button',{name:'Approve',exact:true}).click();await expect(card).toContainText('Approved');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(card).not.toContainText('Queued');
 data.groups[0]!.cards[0]!.revisions[0]!.decision='undecided';await page.reload();await card.getByRole('button',{name:'Deny',exact:true}).click();await expect(card).toContainText('Denied');await expect(card.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);
});
