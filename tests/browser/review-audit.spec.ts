import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const out='.local/review-implemented';
const base:any={workflow:'text-to-image',capabilities_revision:'test',mode:'sfw',prompt:'A red fox resting in a mossy forest clearing. Soft morning light, realistic fur, natural colors, shallow depth of field.',count:1,seed:'random',output:{aspect:'16:9',size:'1mp'}};
const image=(id:string,role='reference')=>({id,asset_id:id,kind:'image',role,framing:'fit'});
const video:any={...base,workflow:'text-to-video',quality:'fast',output:{aspect:'16:9',size:'720p',duration_seconds:5,format:'video'},audio:{output:'generated'}};
const cases=[
 {title:'01 · Image / single output',request:base},
 {title:'02 · Image / batch + note + fixed seed',request:{...base,count:4,seed:'424242',note:'Forest collection',output:{aspect:'9:16',size:'1mp'}}},
 {title:'03 · Text to video / fast + audio',request:video},
 {title:'04 · Video / high + frames + Spicy mode',request:{...video,mode:'nsfw',quality:'high',count:3,output:{aspect:'9:16',size:'native',duration_seconds:10,format:'images'},audio:{output:'silent'}}},
 {title:'05 · Ref to video / first + last frame',request:{...video,workflow:'reference-to-video',references:[image('forest-opening','first_frame'),image('forest-ending','last_frame')]}},
 {title:'06 · Ref to video / image + video + audio',request:{...video,workflow:'reference-to-video',references:[image('forest-reference'),{id:'camera-motion',asset_id:'camera-motion',kind:'video',role:'reference',range:{start_seconds:2,duration_seconds:5},include_audio:true},{id:'forest-audio',asset_id:'forest-audio',kind:'audio',role:'reference',range:{start_seconds:0,duration_seconds:5}}]}},
 {title:'07 · Earlier revision / read-only (bottom)',request:{...video,workflow:'reference-to-video',references:[image('forest-reference')]},historical:true,bottom:true},
 {title:'08 · Edited request + validation error (bottom)',request:{...video,workflow:'reference-to-video',references:[image('forest-reference')]},error:'Choose a duration between 5 and 15 seconds.',dirty:true,bottom:true},
];
test('render actual review UI combinations',async({page})=>{
 test.setTimeout(120000);await fs.mkdir(out,{recursive:true});
 for(let index=0;index<cases.length;index++)for(const width of [1200,390,320]){
 const c=cases[index]!;const req=c.request;const refs=req.references??[];
 const rev={number:1,request:req,decision:'undecided',job_ids:[],notes:{},after_message_id:'a'};
 const chat:any={id:'audit',title:'Forest study',mode:req.mode,workflow:req.workflow,version:0,epoch:0,reasoning:true,activity:'idle',assets:refs.map((r:any)=>r.asset_id),asset_manifest:refs.map((r:any)=>({id:r.asset_id,name:r.asset_id.replaceAll('-',' '),kind:r.kind,note:'Soft morning light through the trees',metadata:{duration:10}})),jobs:[],accounting:[],error:c.error??null,messages:[{id:'a',role:'assistant',text:'Here is your request for review.',assets:[]}],groups:[{id:'g',state:'reviewing',workflow:req.workflow,cards:[{id:'c',workflow:req.workflow,revisions:c.historical?[rev,{...rev,number:2,request:{...req,prompt:'The fox walks toward the camera.'}}]:[rev]}]}]};
 await page.unrouteAll({behavior:'wait'});
 await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[]}:chat}));
 await page.route('**/api/v1/assets/*',r=>r.fulfill({json:chat.asset_manifest.find((a:any)=>r.request().url().endsWith(a.id))??{}}));
 await page.route('**/api/v1/assets/*/content',async r=>r.request().url().includes('/camera-motion/')?r.fulfill({contentType:'video/mp4',body:await fs.readFile('tests/fixtures/request-preview.mp4')}):r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#526752"/><circle cx="355" cy="63" r="38" fill="#eccd86"/><path d="M0 200 90 60 180 190 260 90 420 240H0" fill="#2c4939"/><path d="M0 235Q170 160 480 220V270H0" fill="#92a279"/></svg>'}));
 await page.setViewportSize({width,height:900});await page.goto('/chat?chat=audit');await page.evaluate(mode=>sessionStorage.setItem('seed.spicy',String(mode==='nsfw')),req.mode);await page.reload();
 if(c.historical)await page.getByRole('button',{name:'View request',exact:true}).first().click();else await page.getByRole('button',{name:'Review / history'}).click();
 const dialog=page.getByRole('dialog',{name:'Review generation'});await expect(dialog).toBeVisible();
 if(c.dirty)await dialog.getByRole('textbox',{name:'Prompt',exact:true}).fill('');
 if(index===1||index===3)await dialog.getByText('Advanced settings',{exact:true}).click();if(index===5)await dialog.getByRole('button',{name:'Edit Video 1',exact:true}).click();if(c.historical)await dialog.getByText('Settings',{exact:true}).click();if(c.bottom)await dialog.locator('.review-body').evaluate(e=>e.scrollTop=e.scrollHeight);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),c.title+' '+width).toBe(true);for(const row of await dialog.locator('.review-input').all()){const thumb=await row.locator('.asset-thumbnail').boundingBox(),content=await row.locator('.review-input-content').boundingBox();if(thumb&&content)expect(thumb.x+thumb.width).toBeLessThanOrEqual(content.x);}
 await page.screenshot({path:`${out}/${index+1}-${width}.png`});
 }
 await fs.writeFile(`${out}/cases.json`,JSON.stringify(cases.map(c=>c.title)));
});
