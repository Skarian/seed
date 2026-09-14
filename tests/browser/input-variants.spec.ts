import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const image=(role='reference',framing='fit')=>({id:'image',asset_id:'image',kind:'image',role,framing});
const video=(audio=false)=>({id:'video',asset_id:'video',kind:'video',role:'reference',range:{start_seconds:2,duration_seconds:5},include_audio:audio});
const audio={id:'audio',asset_id:'audio',kind:'audio',role:'reference',range:{start_seconds:0,duration_seconds:5}};
const variants:any[]=[
 ...['reference','first_frame','last_frame'].flatMap(role=>['fit','fill'].map(framing=>({group:'images',title:role.replaceAll('_',' ')+' / '+framing,refs:[image(role,framing)]}))),
 ...[false,true].flatMap(sound=>[false,true].map(expanded=>({group:'clips',title:'Video / audio '+(sound?'on':'off')+' / '+(expanded?'expanded':'collapsed'),refs:[video(sound)],expanded}))),
 ...[false,true].map(expanded=>({group:'clips',title:'Audio / '+(expanded?'expanded':'collapsed'),refs:[audio],expanded})),
 {group:'states',title:'Empty / add an input',refs:[]},
 {group:'states',title:'File no longer available',refs:[image()],missing:true},
 {group:'states',title:'Image preview failed',refs:[image()],broken:true},
 {group:'states',title:'File metadata loading',refs:[image()],loading:true},
 {group:'states',title:'Saving / controls disabled',refs:[video(true)],busy:true},
 {group:'states',title:'Mixed / reorder and remove',refs:[image(),video(true),audio]},
 {group:'history',title:'Read-only / image + saved note',refs:[image()],history:true},
 {group:'history',title:'Read-only / video clip + audio',refs:[video(true)],history:true},
 {group:'history',title:'Read-only / audio clip',refs:[audio],history:true},
 {group:'history',title:'Read-only / missing file',refs:[image()],history:true,missing:true},
];
test('render every distinct input section variation',async({page})=>{
 test.setTimeout(120000);await fs.mkdir('.local/input-variants',{recursive:true});const manifest:any[]=[];
 for(let i=0;i<variants.length;i++){
 const v=variants[i],request:any={workflow:'reference-to-video',mode:'sfw',prompt:'Use these references to create a forest scene.',count:1,seed:'random',output:{aspect:'16:9',size:'native',duration_seconds:5},references:v.refs};
 const assets=v.refs.map((r:any)=>({id:r.asset_id,name:r.kind==='image'?'Forest reference.png':r.kind==='video'?'Camera movement.mp4':'Forest ambience.wav',kind:r.kind,note:'Keep the soft morning light.',metadata:{duration:10}}));const rev={number:1,request,decision:'undecided',job_ids:[],notes:{}};
 const chat:any={id:'inputs',title:'Inputs',mode:'sfw',workflow:'reference-to-video',version:0,epoch:0,activity:v.busy?'thinking':'idle',reasoning:true,assets:[],asset_manifest:v.missing?[]:assets,jobs:[],messages:[],groups:[{id:'g',state:'reviewing',cards:[{id:'c',workflow:'reference-to-video',revisions:v.history?[rev,{...rev,number:2}]:[rev]}]}]};
 await page.unrouteAll({behavior:'ignoreErrors'});await page.route('**/api/v1/chat-config',r=>r.fulfill({json:{configured:true}}));await page.route('**/api/v1/chats**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[]}:chat}));
 await page.route('**/api/v1/assets/*',async r=>{if(v.loading)await new Promise(resolve=>setTimeout(resolve,2500));await r.fulfill({status:v.missing?404:200,json:assets.find((a:any)=>r.request().url().endsWith(a.id))??{}}).catch(()=>{});});
 await page.route('**/api/v1/assets/*/content',async r=>v.broken?r.fulfill({status:404}):r.request().url().includes('/video/')?r.fulfill({contentType:'video/mp4',body:await fs.readFile('tests/fixtures/request-preview.mp4')}):r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#526752"/><circle cx="355" cy="63" r="38" fill="#eccd86"/><path d="M0 200 90 60 180 190 260 90 420 240H0" fill="#2c4939"/></svg>'}));
 await page.setViewportSize({width:390,height:1400});await page.goto('/chat?chat=inputs');await page.getByRole('button',{name:v.history?'View request':'Review / history',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'Review generation'});await expect(dialog).toBeVisible();if(v.expanded)await dialog.getByRole('button',{name:v.refs[0].kind==='video'?'Edit Video 1':'Edit Audio 1',exact:true}).click();
 const section=dialog.locator(v.history?'.request-input-note':'.review-inputs');await expect(section).toBeVisible();if(!v.loading&&!v.missing&&v.refs.some((r:any)=>r.kind==='image'))await expect(section.locator('img')).toHaveCount(1);if(v.history&&v.missing)await expect(section).toContainText('No longer available');
 const file=`${i+1}.png`;await section.screenshot({path:'.local/input-variants/'+file,animations:'disabled'});manifest.push({file,title:v.title,group:v.group});
 }
 await fs.writeFile('.local/input-variants/manifest.json',JSON.stringify(manifest));
});
