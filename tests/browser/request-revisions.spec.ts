import {test,expect} from '@playwright/test';
test('replaced requests stay read-only in sequence and latest remains reviewable',async({page})=>{
 const request={workflow:'text-to-image',prompt:'A quiet forest',mode:'sfw',seed:'random',count:1,output:{aspect:'16:9',size:'1mp'}};
 const chat={id:'revisions',title:'Forest study',mode:'sfw',workflow:'text-to-image',version:2,epoch:0,reasoning:true,activity:'idle',assets:[],jobs:[],accounting:[],messages:[{id:'u1',role:'user',text:'A forest scene',assets:[]},{id:'a1',role:'assistant',text:'Here is the first request.',assets:[]},{id:'u2',role:'user',text:'Add morning mist',assets:[]},{id:'a2',role:'assistant',text:'I added morning mist.',assets:[]}],groups:[{id:'g',state:'reviewing',workflow:'text-to-image',after_message_id:'u1',cards:[{id:'c',workflow:'text-to-image',revisions:[{number:1,request,decision:'undecided',job_ids:[],notes:{},after_message_id:'a1'},{number:2,request:{...request,prompt:'A misty forest'},decision:'undecided',job_ids:[],notes:{},after_message_id:'a2'}]}]}]};
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
 for(const width of [1440,390]){
 await page.setViewportSize({width,height:900});await page.goto('/chat?chat=revisions');
 const cards=page.locator('.job-chat-wrap');await expect(cards).toHaveCount(2);
 await expect(cards.first()).toContainText('Replaced');await expect(page.getByRole('button',{name:'Review / history'})).toHaveCount(1);
 expect(await page.locator('.chat-history-content > article, .chat-history-content > section').evaluateAll(nodes=>nodes.map(n=>n.tagName))).toEqual(['ARTICLE','ARTICLE','SECTION','ARTICLE','ARTICLE','SECTION']);
 await cards.first().getByRole('button',{name:'View request',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Earlier revision · read-only');await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);await expect(page.getByRole('dialog').getByRole('button',{name:'Approve'})).toHaveCount(0);await page.keyboard.press('Escape');
 await expect(cards.first().getByRole('button',{name:'View latest'})).toHaveCount(0);await expect(cards.last()).toContainText('2/2');
 await cards.last().getByRole('button',{name:'Previous request revision'}).click();await expect(page.getByRole('button',{name:'Review / history'})).toHaveCount(0);
 await cards.last().getByRole('button',{name:'Next request revision'}).click();await expect(page.getByRole('button',{name:'Review / history'})).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/request-revisions-'+width+'.png'});
 }
});
