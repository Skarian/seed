import {chromium,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {cases} from './agent-ui-cases.mjs';
import {inputLabels} from '../dist/shared/reference-labels.js';
const root=path.resolve(process.argv[2]),only=process.argv[3];
const records=JSON.parse(readFileSync(path.join(root,'results.json'),'utf8')).filter(r=>!only||r.id===only);
const browser=await chromium.launch({headless:true}),audits=[];
try{for(const r of records){
 const audit={id:r.id,passed:false,errors:[]},c=cases.find(c=>c.id===r.id),page=await browser.newPage({viewport:{width:1440,height:1100}});
 try{
  expect(r.toolErrors).toEqual([]);expect(r.request).toBeTruthy();
  const remaining=[...r.request.references];expect(remaining).toHaveLength(c.expected.references.length);
  for(const wanted of c.expected.references){
   const index=remaining.findIndex(a=>r.assetKeys[a.asset_id]===wanted.asset&&(!wanted.range||JSON.stringify(a.range)===JSON.stringify(wanted.range)));
   expect(index).toBeGreaterThanOrEqual(0);const [actual]=remaining.splice(index,1);
   for(const key of ['kind','role','framing','include_audio','range'])if(wanted[key]!==undefined)expect(key==='framing'?(actual[key]??'fit'):key==='include_audio'?Boolean(actual[key]):actual[key]).toEqual(wanted[key]);
  }
  for(const [key,value] of Object.entries(c.expected))if(key!=='references')typeof value==='object'?expect(r.request[key]).toMatchObject(value):expect(r.request[key]).toEqual(value);
  await page.goto('http://127.0.0.1:4313/chat?chat='+r.chatId);
  await page.getByRole('button',{name:'Review / history',exact:true}).last().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(root,r.id,'history.png')});
  await page.getByRole('button',{name:'Review / history',exact:true}).last().click();
  const dialog=page.getByRole('dialog',{name:'Review generation'});await expect(dialog).toBeVisible();
  // Select the recorded revision when a later follow-up exists in this chat.
  const current=await fetch('http://127.0.0.1:4313/api/v1/chats/'+r.chatId).then(x=>x.json());
  const currentRevision=current.groups.flatMap(g=>g.cards).find(c=>c.id===r.cardId)?.revisions.at(-1)?.number;
  if(currentRevision!==r.revision)throw Error('Audit this case before its follow-up, or use existing captured revision screenshots.');
  await expect(dialog.locator('.input-mention.missing')).toHaveCount(0);
  await expect(dialog.locator('.request-input-row')).toHaveCount(r.request.references.length);
  const thumbnails=dialog.locator('.asset-thumbnail img,.asset-thumbnail video');
  await expect(thumbnails).toHaveCount(r.request.references.filter(ref=>ref.kind!=='audio').length);
  await expect.poll(()=>thumbnails.evaluateAll(items=>items.every(el=>el.tagName==='IMG'?el.complete&&el.naturalWidth>0:el.readyState>=1)),{timeout:15000}).toBe(true);
  await page.screenshot({path:path.join(root,r.id,'review.png')});
  const labels=inputLabels(r.request.references);
  for(let i=0;i<r.request.references.length;i++){
   const ref=r.request.references[i];await dialog.locator('.request-input-row').nth(i).getByRole('button',{name:/^Preview /}).first().click();
   await expect(page.getByRole('button',{name:'Close preview',exact:true})).toBeVisible();
   const label=labels.get(ref.id)?.slice(1,-1);if(label)await expect(page.locator('.viewer-reference-label')).toHaveText(label);
   await expect(page.getByRole('navigation',{name:'Input navigation'})).toContainText(`${i+1} of ${r.request.references.length}`);
   const media=page.locator('.viewer-canvas img,.viewer-canvas video,.viewer-canvas audio');await expect(media).toHaveCount(1);expect(await media.getAttribute('src')).toContain(ref.asset_id);
   await expect.poll(()=>media.evaluate(el=>el.tagName==='IMG'?el.complete&&el.naturalWidth>0:el.readyState>=1),{timeout:15000}).toBe(true);
   await page.screenshot({path:path.join(root,r.id,'preview-'+(i+1)+'.png')});await page.getByRole('button',{name:'Close preview',exact:true}).click();
  }
  audit.passed=true;
 }catch(error){audit.errors.push(error.message);}finally{await page.close();audits.push(audit);writeFileSync(path.join(root,'review-audit'+(only?'-'+only:'')+'.json'),JSON.stringify(audits,null,2));console.log(JSON.stringify(audit));}
}}finally{await browser.close();}
