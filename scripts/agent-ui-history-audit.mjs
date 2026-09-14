import {chromium,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.local/agent-ui-browser-v1');
const results=JSON.parse(readFileSync(path.join(root,'results.json'),'utf8'));
const browser=await chromium.launch({headless:true});
const checked=[];
try{for(const result of results){
 if(!result.savedMessage)continue;
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),audit={id:result.id,mentions:0,errors:[]};
 try{
  await page.goto('http://127.0.0.1:4313/chat?chat='+result.chatId);
  const users=result.chat.messages.filter(m=>m.role==='user'),index=users.findIndex(m=>m.id===result.savedMessage.id);
  const article=page.locator('.chat-message.user').nth(index);
  const mentions=[...result.savedMessage.text.matchAll(/\[([^\]]+)\]\(asset:([^)]+)\)/g)];
  await expect(article.locator('.input-mention')).toHaveCount(mentions.length);
  for(let i=0;i<mentions.length;i++){
   await article.locator('.input-mention').nth(i).click();
   await expect(page.locator('.viewer-reference-label')).toHaveText(mentions[i][1]);
   const media=page.locator('.viewer-canvas img,.viewer-canvas video,.viewer-canvas audio');
   await expect(media).toHaveCount(1);expect(await media.getAttribute('src')).toContain(mentions[i][2]);
   await expect.poll(()=>media.evaluate(el=>el.tagName==='IMG'?el.complete&&el.naturalWidth>0:el.readyState>=1),{timeout:15000}).toBe(true);
   await page.getByRole('button',{name:'Close preview',exact:true}).click();audit.mentions++;
  }
 }catch(error){audit.errors.push(error.message);}finally{await page.close();checked.push(audit);writeFileSync(path.join(root,'history-audit.json'),JSON.stringify(checked,null,2));console.log(JSON.stringify(audit));}
}}finally{await browser.close();}
