import {chromium,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {cases,fixtures} from './agent-ui-cases.mjs';
import {createFixtures} from './agent-eval-fixtures.mjs';
import {inputLabels} from '../dist/shared/reference-labels.js';

const {values:args}=parseArgs({options:{base:{type:'string',default:'http://127.0.0.1:4313'},out:{type:'string',default:'.local/agent-ui-browser-v1'},ids:{type:'string'},resume:{type:'string'},concurrency:{type:'string',default:'4'}}});
const root=path.resolve(args.out);mkdirSync(root,{recursive:true});
if(existsSync(path.join(root,'results.json')))throw Error('Use a fresh output directory.');
const generated=path.join(root,'fixtures');await createFixtures(generated);
const selected=cases.filter(c=>!args.ids||args.ids.split(',').includes(c.id));
const results=[],states=new Map();
const browser=await chromium.launch({headless:true});
if(args.resume){for(const prior of JSON.parse(readFileSync(path.join(args.resume,'results.json'),'utf8'))){if(!prior.chatId||!prior.request)continue;const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();await page.goto(args.base+'/chat?chat='+prior.chatId);states.set(prior.id,{context,page,chatId:prior.chatId});}}
const api=async(method,url,body)=>{const response=await fetch(args.base+url,{method,headers:{Origin:args.base,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;};
function fixture(key){const f=fixtures[key];if(!f)throw Error('Unknown fixture '+key);const source=f.sourcePath??path.join(generated,(f.id??f.evalId??('eval-'+key))+'.'+(f.kind==='video'?'mp4':f.kind==='audio'?'wav':'png'));return {...f,source,name:f.name??path.basename(source)};}
const save=()=>writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));
async function run(c){
 const directory=path.join(root,c.id);mkdirSync(directory,{recursive:true});
 const result={id:c.id,parentId:c.parentId,passed:false,semanticReview:'pending',rubric:c.rubric,errors:[],screenshots:[]};
 let state=c.parentId?states.get(c.parentId):undefined;
 try{
  if(c.parentId&&!state)throw Error('Prerequisite did not complete: '+c.parentId);
  if(!state){const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();let chat=await api('POST','/api/v1/chats',{mode:'sfw'});chat=await api('PATCH','/api/v1/chats/'+chat.id,{version:chat.version,workflow:c.workflow,title:'UI test '+c.id});state={context,page,chatId:chat.id};await page.goto(args.base+'/chat?chat='+chat.id);}
  const {page,chatId}=state;result.chatId=chatId;await api('POST','/__eval/case',{id:c.id,chat_id:chatId});
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  const before=await api('GET','/api/v1/chats/'+chatId);const beforeCard=before.groups.flatMap(g=>g.cards).at(-1);result.beforeRequest=beforeCard?.revisions.at(-1)?.request;
  if(c.parentId){await page.getByRole('button',{name:'Review / history',exact:true}).last().click();await page.getByRole('dialog',{name:'Review generation'}).getByRole('button',{name:/Provide feedback/}).click();}
  else{await page.locator('.composer-actions input[type=file]').setInputFiles(c.assets.map(key=>{const f=fixture(key);return {name:f.name,mimeType:f.kind==='image'?'image/jpeg':f.kind==='video'?'video/mp4':'audio/wav',buffer:readFileSync(f.source)};}));await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();}
  const composer=page.getByRole('combobox',{name:'Chat message'});await expect(composer).toBeVisible();await composer.fill('');
  const choices=[];
  for(const segment of c.segments){
   await composer.focus();
   if(typeof segment==='string')await page.keyboard.insertText(segment);
   else{
    await page.keyboard.insertText('@');
    const picker=page.getByRole('listbox',{name:'Input references'});await expect(picker).toBeVisible();
    let option=picker.getByRole('option').filter({has:page.locator('small').filter({hasText:new RegExp('^'+fixture(segment.mention).name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s|$)')})});
    if(segment.label)option=option.filter({hasText:segment.label});
    await expect(option).toHaveCount(1);
    choices.push({asset:segment.mention,text:await option.innerText()});await option.click();
   }
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  result.pickerChoices=choices;result.composerText=await composer.innerText();
  await expect(composer.locator('.input-mention.missing')).toHaveCount(0);
  const screenshot=async(name)=>{const file=path.join(directory,name+'.png');await page.screenshot({path:file,fullPage:false});result.screenshots.push(file);};
  await screenshot('composer');
  const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/chats/'+chatId+'/messages'));
  const posted=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/chats/'+chatId+'/messages'));
  await page.getByRole('button',{name:'Send',exact:true}).click();result.submitted=(await posted).postDataJSON();const response=await accepted;if(!response.ok())throw Error('Message rejected: '+await response.text());
  let chat;await expect.poll(async()=>{chat=await api('GET','/api/v1/chats/'+chatId);return chat.activity;},{timeout:660000,intervals:[500,1000,2000]}).toBe('idle');
  if(chat.error)throw Error(chat.error);
  const allCards=chat.groups.flatMap(g=>g.cards),card=allCards.at(-1),revision=card?.revisions.at(-1);if(!revision)throw Error('Agent produced no review request.');
  if(c.parentId&&card.id!==beforeCard.id)throw Error('Edit created a different request.');
  if(c.parentId&&revision.number<=beforeCard.revisions.at(-1).number)throw Error('Edit did not create a revision.');
  result.request=revision.request;result.cardId=card.id;result.revision=revision.number;result.chat=chat;states.set(c.id,state);result.toolSteps=chat.messages.filter(m=>m.role==='assistant').at(-1)?.transcript?.steps.filter(s=>s.kind==='tool')??[];result.toolErrors=result.toolSteps.filter(s=>s.state==='failed');
  const user=chat.messages.filter(m=>m.role==='user').at(-1);result.savedMessage=user;
  expect(user.text).toBe(result.submitted.text);expect(user.assets.length).toBeGreaterThanOrEqual(c.parentId?0:2);
  expect(user.text).not.toMatch(/asset:reference-/);expect(user.text).not.toMatch(/\[removed reference\]/);
  const assetKeys=Object.fromEntries((chat.asset_manifest??[]).map(a=>[a.id,Object.keys(fixtures).find(key=>fixture(key).name===a.name)??a.name]));result.assetKeys=assetKeys;
  const refs=revision.request.references??[];
  if(c.expected?.references){expect(refs).toHaveLength(c.expected.references.length);const remaining=[...refs];c.expected.references.forEach(r=>{const index=remaining.findIndex(a=>assetKeys[a.asset_id]===(r.asset??r.assetKey)&&(!r.range||JSON.stringify(a.range)===JSON.stringify(r.range)));expect(index,'Expected source and clip '+JSON.stringify(r)).toBeGreaterThanOrEqual(0);const [actual]=remaining.splice(index,1);for(const key of ['kind','role','framing','include_audio','range'])if(r[key]!==undefined)expect(key==='framing'?(actual[key]??'fit'):actual[key]).toEqual(r[key]);});}
  for(const [key,value]of Object.entries(c.expected??{}))if(key!=='references')typeof value==='object'?expect(revision.request[key]).toMatchObject(value):expect(revision.request[key]).toEqual(value);
  const latestUser=page.locator('.chat-message.user').last();await expect(latestUser.locator('.input-mention')).toHaveCount(choices.length);
  await page.getByRole('button',{name:'Review / history',exact:true}).last().scrollIntoViewIfNeeded();await screenshot('history');
  await page.getByRole('button',{name:'Review / history',exact:true}).last().click();const dialog=page.getByRole('dialog',{name:'Review generation'});await expect(dialog).toBeVisible();await expect(dialog.locator('.input-mention.missing')).toHaveCount(0);await expect(dialog.locator('.request-input-row')).toHaveCount(refs.length);await screenshot('review');
  const labels=inputLabels(refs);
  for(let i=0;i<refs.length;i++){
   const ref=refs[i],row=dialog.locator('.request-input-row').nth(i),button=row.getByRole('button',{name:/^Preview /}).first();await button.click();
   await expect(page.getByRole('button',{name:'Close preview',exact:true})).toBeVisible();
   if(refs.length>1)await expect(page.getByRole('navigation',{name:'Input navigation'})).toContainText(`${i+1} of ${refs.length}`);
   const label=labels.get(ref.id)?.slice(1,-1);if(label)await expect(page.locator('.viewer-reference-label')).toHaveText(label);
   const media=page.locator('.viewer-canvas img,.viewer-canvas video,.viewer-canvas audio');await expect(media).toHaveCount(1);expect(await media.first().getAttribute('src')).toContain(ref.asset_id);await expect.poll(()=>media.evaluate(el=>el.tagName==='IMG'?el.complete&&el.naturalWidth>0:el.readyState>=1),{timeout:15000}).toBe(true);
   if(i===0||i===refs.length-1)await screenshot('preview-'+(i+1));
   await page.getByRole('button',{name:'Close preview',exact:true}).click();
  }
  await dialog.getByRole('button',{name:'Close review',exact:true}).click();
  result.errors=pageErrors;expect(pageErrors).toEqual([]);expect(result.toolErrors,'Tool calls must succeed without repairs').toEqual([]);result.passed=true;states.set(c.id,state);
 }catch(error){result.errors.push(error.message);if(state)try{await state.page.screenshot({path:path.join(directory,'failure.png')});}catch{}}
 finally{writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));results.push(result);save();console.log(JSON.stringify({id:c.id,passed:result.passed,errors:result.errors}));}
}
const pending=[...selected],active=new Set();
try{while(pending.length||active.size){while(active.size<Number(args.concurrency)){const index=pending.findIndex(c=>!c.parentId||states.has(c.parentId)||results.some(r=>r.id===c.parentId));if(index<0)break;const [c]=pending.splice(index,1);const promise=run(c).finally(()=>active.delete(promise));active.add(promise);}if(active.size)await Promise.race(active);else if(pending.length)throw Error('Unresolved case dependencies.');}}finally{await browser.close();save();}
console.log(JSON.stringify({done:true,root,passed:results.filter(r=>r.passed).length,total:results.length}));
