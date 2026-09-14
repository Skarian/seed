import {test,expect} from '@playwright/test';
test('chat and notifications share the workspace center with either sidebar state',async({page})=>{
 const chat={id:'center',title:'Centering',mode:'sfw',version:0,epoch:0,workflow:null,reasoning:true,activity:'idle',assets:[],jobs:[],accounting:[],groups:[],messages:[{id:'m',role:'assistant',text:'A paragraph of streaming content.\n\n'.repeat(80),assets:[],created_at:new Date().toISOString()}]};
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat}));
 for(const width of [1440,1000,390]){
  await page.setViewportSize({width,height:900});await page.goto('/chat?chat=center');await expect(page.locator('.chat-message')).toBeVisible();
  for(let i=0;i<2;i++){
   const centers=await page.evaluate(()=>Object.fromEntries(['.studio-shell>main','.chat-history-content','.chat-composer','.mode-toasts'].map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return[selector,r.x+r.width/2];})));
   for(const center of Object.values(centers))expect(Math.abs(center-centers['.studio-shell>main']!)).toBeLessThan(1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:'.local/centering-'+width+'-'+i+'.png'});
   if(i===0){if(await page.getByRole('button',{name:'Close sidebar',exact:true}).isVisible())await page.getByRole('button',{name:'Close sidebar',exact:true}).click();else await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();}
  }
 }
});
