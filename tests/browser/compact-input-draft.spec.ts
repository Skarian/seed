import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const image=(role='reference',framing='fit')=>({id:'image',asset_id:'image',kind:'image',role,framing});
const video=(audio=false)=>({id:'video',asset_id:'video',kind:'video',role:'reference',range:{start_seconds:2,duration_seconds:5},include_audio:audio});
const audio={id:'audio',asset_id:'audio',kind:'audio',role:'reference',range:{start_seconds:0,duration_seconds:5}};
const variants:any[]=[
 {title:'Mixed inputs / compact',refs:[image(),video(true),audio]},
 {title:'Image settings / expanded',refs:[image(),video(true),audio],action:'image'},
 {title:'Video clip / expanded',refs:[image(),video(true),audio],action:'video'},
 {title:'Audio clip / expanded',refs:[image(),video(true),audio],action:'audio'},
 {title:'File actions / menu',refs:[image(),video(true),audio],action:'menu'},
 {title:'File information',refs:[image(),video(true),audio],action:'info'},
 {title:'Add input / picker',refs:[image()],action:'picker'},
 {title:'Long prompt / expanded',refs:[image(),video(true),audio],action:'prompt'},
];
test('compact inputs draft and edit interactions',async({page})=>{
 test.setTimeout(120000);await fs.mkdir('.local/compact-input-draft',{recursive:true});const manifest:any[]=[];
 for(let i=0;i<variants.length;i++)for(const width of [1200,390,320]){
 const v=variants[i],request:any={workflow:'reference-to-video',mode:'sfw',prompt:'At the start of the video, use Image 1 as the visual reference.\n\nCreate a photorealistic scene in a warmly lit cafe. The subject looks toward the window as the camera slowly moves closer. Preserve the soft lighting, natural expression, and background details. Use Video 1 for camera movement and Audio 1 for ambience.',count:1,seed:'random',output:{aspect:'16:9',size:'native',duration_seconds:5},references:v.refs};
 const assets=[image(),video(true),audio].map((r:any)=>({id:r.asset_id,name:r.kind==='image'?'16e5e4fb-9642-4d7f-be9a-19996eab21f2-0.png':r.kind==='video'?'bd810ef0-4de8-4f75-b9de-3075cdd7bcf0-0.mp4':'Forest ambience.wav',kind:r.kind,note:'Keep the soft morning light.',metadata:r.kind==='image'?{width:1344,height:768}:{duration:10}}));const rev={number:1,request,decision:'undecided',job_ids:[],notes:{}};
 const chat:any={id:'inputs',title:'Inputs',mode:'sfw',workflow:'reference-to-video',version:0,epoch:0,activity:v.busy?'thinking':'idle',reasoning:true,assets:[],asset_manifest:v.missing?[]:assets,jobs:[],messages:[],groups:[{id:'g',state:'reviewing',cards:[{id:'c',workflow:'reference-to-video',revisions:v.history?[rev,{...rev,number:2}]:[rev]}]}]};
 await page.unrouteAll({behavior:'ignoreErrors'});await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[]}:chat}));
 await page.route('**/api/v1/assets/*',async r=>{if(v.loading)await new Promise(resolve=>setTimeout(resolve,2500));await r.fulfill({status:v.missing?404:200,json:assets.find((a:any)=>r.request().url().endsWith(a.id))??{}}).catch(()=>{});});
 await page.route('**/api/v1/assets/*/content',async r=>v.broken?r.fulfill({status:404}):r.request().url().includes('/video/')?r.fulfill({contentType:'video/mp4',body:await fs.readFile('tests/fixtures/request-preview.mp4')}):r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#526752"/><circle cx="355" cy="63" r="38" fill="#eccd86"/><path d="M0 200 90 60 180 190 260 90 420 240H0" fill="#2c4939"/></svg>'}));
 await page.setViewportSize({width,height:1000});await page.goto('/chat?chat=inputs');await page.getByRole('button',{name:'Review / history',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Review generation'});await expect(dialog).toBeVisible();
 if(['image','video','audio'].includes(v.action))await dialog.getByRole('button',{name:'Edit '+(v.action==='image'?'Picture 1':v.action==='video'?'Video 1':'Audio 2'),exact:true}).click();
 if(v.action==='menu'||v.action==='info'){await dialog.getByLabel('More options for Picture 1').click();if(v.action==='info')await dialog.getByRole('button',{name:'File information',exact:true}).click();}
 if(v.action==='picker'){await dialog.getByRole('button',{name:'+ Add input',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add input',exact:true});}
 if(v.action==='prompt'){await dialog.getByRole('button',{name:'Resize prompt',exact:true}).focus();for(let n=0;n<9;n++)await page.keyboard.press('ArrowDown');}
 const file=`${i+1}-${width}.png`;await page.screenshot({path:'.local/compact-input-draft/'+file,animations:'disabled'});manifest.push({file,title:v.title,width});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 if(v.action==='video'){await dialog.getByLabel('Start time (sec)').fill('1');await expect(dialog.locator('.request-input-row').nth(1)).toContainText('Use clip: 1–6 sec');await dialog.getByRole('button',{name:'Edit Video 1',exact:true}).click();await expect(dialog.getByLabel('Start time (sec)')).toHaveCount(0);}
 if(v.action==='picker'){await dialog.getByRole('button').filter({hasText:'mp4'}).click();await expect(page.locator('.request-input-row')).toHaveCount(2);}
 }
 await fs.writeFile('.local/compact-input-draft/manifest.json',JSON.stringify(manifest));
});
