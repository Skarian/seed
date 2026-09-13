import {test,expect} from '@playwright/test';
test('request summaries stay compact and usable across mobile and desktop widths',async({page})=>{
 const request={workflow:'reference-to-video',prompt:'Hidden prompt',mode:'sfw',capabilities_revision:'v1',seed:'random',count:16,output:{aspect:'16:9',size:'720p',duration_seconds:5}};
 const chat={id:'cards',title:'Card layout',mode:'sfw',workflow:null,version:0,activity:'idle',reasoning:true,messages:[],assets:[],jobs:[],accounting:[],groups:['reviewing','released','stopped'].map((state,i)=>({id:'group'+i,workflow:'reference-to-video',state,cards:[{id:'card'+i,workflow:'reference-to-video',revisions:[1,2,3].map(number=>({number,decision:i===1?'approved':'undecided',request,notes:{},job_ids:[]}))}]}))};
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
 await page.goto('/chat');await page.getByRole('button',{name:'Open chat: Card layout'}).click();
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:844});await page.locator('.chat-history').evaluate(e=>e.scrollTop=0);
  await expect(page.locator('.chat-card')).toHaveCount(3);
  for(const card of await page.locator('.chat-card').all()){
   const box=await card.boundingBox();expect(box!.height).toBeLessThanOrEqual(130);
   expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
   const review=await card.getByRole('button',{name:'Review / history'}).boundingBox();expect(review!.x+review!.width).toBeLessThanOrEqual(box!.x+box!.width);
  }
  await page.screenshot({path:'.local/qa-request-cards-'+width+'.png'});
 }
});
