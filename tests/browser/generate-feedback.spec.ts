import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';

test('Spicy LoRAs are discoverable on Ref to video before adding inputs and leave Standard selections',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('seed.spicy','true'));
  await page.route('**/api/v1/studio',r=>r.fulfill({json:{pool:{active:0,ready:0,busy:0,preparing:0,needs_attention:0,hourly:0,estimated_spend:0,image:0,video:0},activity:{active:0,waiting:0,needs_attention:0},outputs:{pending:0}}}));
  const entries=[{id:'image',revision:'i1',name:'Private image style',version:'v1',route:'image',availability:'spicy'},{id:'ref',revision:'r1',name:'Private video style',version:'v2',route:'ref',availability:'spicy'}];
  await page.route('**/api/v1/loras*',r=>r.fulfill({json:{items:new URL(r.request().url()).searchParams.get('mode')==='nsfw'?entries:[]}}));
  await page.route('**/api/v1/jobs',r=>r.fulfill({status:r.request().method()==='POST'?202:200,json:r.request().method()==='POST'?{jobs:[]}:{items:[]}}));
  await page.goto('/');await page.getByRole('checkbox',{name:'Private image style v1'}).check();await page.getByLabel('Strength',{exact:true}).fill('2');
  await page.getByRole('button',{name:'Reference to video',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Private video style v2'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Advanced',exact:true})).toHaveCount(0);await expect(page.getByLabel('Seed mode')).toBeVisible();
  await page.getByRole('button',{name:'Text to image',exact:true}).click();await page.getByRole('button',{name:'Return to Seed'}).click();
  await expect(page.getByText('No LoRAs available for this workflow.')).toBeVisible();await expect(page.getByText('Private image style')).toHaveCount(0);
  await page.getByLabel('Prompt',{exact:true}).fill('A forest');const sent=page.waitForRequest(r=>r.url().endsWith('/api/v1/jobs')&&r.method()==='POST');await page.getByRole('button',{name:/^Create image/}).click();expect((await sent).postDataJSON()).toMatchObject({mode:'sfw',loras:[]});
});

test('video preview picks and saves a frame without submitting another generation',async({page})=>{
  const mp4=await readFile('.local/browser-preview.mp4'),png=await sharp({create:{width:480,height:270,channels:3,background:'green'}}).png().toBuffer();let picked:number|undefined;
  await page.route('**/api/v1/assets?*',r=>r.fulfill({json:{items:[{id:'video',kind:'video',name:'Saved video',mode:'sfw'}]}}));
  await page.route('**/api/v1/assets/video',r=>r.fulfill({json:{id:'video',kind:'video',fps:24,duration:3}}));
  await page.route('**/api/v1/assets/video/content',r=>{
    const range=r.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if(!range)return r.fulfill({contentType:'video/mp4',body:mp4,headers:{'Accept-Ranges':'bytes'}});
    const start=Number(range[1]),end=Math.min(Number(range[2]||mp4.length-1),mp4.length-1);
    return r.fulfill({status:206,contentType:'video/mp4',body:mp4.subarray(start,end+1),headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${mp4.length}`}});
  });
  await page.route('**/api/v1/notes/*',r=>r.fulfill({json:{note:'',revision:0}}));
  await page.route('**/api/v1/assets/video/frames',r=>{picked=r.request().postDataJSON().time_seconds;return r.fulfill({json:{id:'picked',url:'/api/v1/assets/picked/content',width:480,height:270}});});
  await page.route('**/api/v1/assets/picked/content',r=>r.fulfill({contentType:'image/png',body:png}));
  const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
  await page.goto('/library');await expect(page.locator('.library-preview.media-ready')).toBeVisible();await page.getByRole('button',{name:'Saved video',exact:true}).click();await page.getByRole('button',{name:'Pick Frame',exact:true}).click();
  await page.getByRole('slider',{name:'Frame position'}).fill('1');await page.getByRole('button',{name:'Next frame',exact:true}).click();
  await page.getByRole('button',{name:'Save frame',exact:true}).click();await expect(page.getByText('Saved to Library',{exact:true})).toBeVisible();expect(picked).toBeGreaterThan(.99);expect(picked).toBeLessThan(1.1);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/pick-frame-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'View frame',exact:true}).click();await expect(page.getByRole('img',{name:'Picked frame',exact:true})).toBeVisible();expect(posts).toEqual(['/api/v1/assets/video/frames']);
  await page.goBack();await expect(page.getByRole('img',{name:'Picked frame',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'View frame',exact:true})).toBeVisible();
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(/\/library$/);
});

test('Generate scopes compact previews to their workflow and announces completion once',async({page})=>{
  await page.route('**/api/v1/pool',r=>r.fulfill({json:{server_time:new Date().toISOString(),workers:[{id:'ready-image',worker_class:'image',state:'ready',installed_loras:[]}],summary:{active:1,ready:1,busy:0,preparing:0,needs_attention:0,hourly:1,estimated_spend:0,image:1,video:0}}}));
  const png=await sharp({create:{width:1280,height:720,channels:3,background:'#758d61'}}).png().toBuffer();
  let jobs:any[]=[];
  await page.route('**/api/v1/jobs?mode=*',r=>r.fulfill({json:{items:jobs}}));
  await page.route('**/api/v1/studio',r=>r.fulfill({json:{pool:{active:1,ready:1,busy:0,preparing:0,needs_attention:0,hourly:1,estimated_spend:0,image:1,video:0},activity:{active:0,waiting:0,needs_attention:0},outputs:{pending:0}}}));
  await page.route('**/api/v1/loras*',r=>r.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/jobs',r=>{
    if(r.request().method()==='POST'){
      const request=r.request().postDataJSON();
      jobs=Array.from({length:request.count},(_,i)=>({id:'new-'+i,submission_id:'new',submission_index:i,request,state:'running',outputs:[],seed:String(i),worker:{id:'ready-image'},error:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}));
      return r.fulfill({status:202,json:{jobs}});
    }
    return r.fulfill({json:{items:jobs}});
  });
  await page.route('**/api/v1/assets/output-*',r=>r.fulfill({json:{id:r.request().url().split('/').at(-1),name:'Generated landscape',kind:'image',mime_type:'image/png'}}));
  await page.route('**/api/v1/assets/output-*/content',r=>r.fulfill({contentType:'image/png',body:png}));
  await page.goto('/');await page.getByLabel('Prompt',{exact:true}).fill('A quiet landscape');await page.getByLabel('Quantity',{exact:true}).selectOption('4');
  await page.getByRole('button',{name:/^Create 4 images/}).click();
  await expect(page.getByText('Request submitted · 4 images',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Latest generation'})).toContainText('4 images in progress');
  await expect(page.locator('.composer .job-request-card')).toHaveCount(0);
  await page.getByRole('button',{name:'Text to video',exact:true}).click();
  await expect(page.getByRole('region',{name:'Latest generation'})).toHaveCount(0);
  jobs=jobs.map((job,i)=>({...job,state:'completed',outputs:['output-'+i]}));
  await expect(page.getByText('4 images saved to Library',{exact:true})).toBeVisible({timeout:10000});
  await expect(page.getByRole('region',{name:'Latest generation'})).toHaveCount(0);
  await page.getByRole('button',{name:'Text to image',exact:true}).click();
  await expect(page.locator('.generation-thumbnail')).toHaveCount(4);
  await page.getByRole('button',{name:'Open image 1 preview'}).click();await expect(page.getByRole('img',{name:'Generated landscape',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/generate-compact-mobile.png',fullPage:true});
  await expect(page.locator('.mode-toast.is-visible').filter({hasText:'4 images saved to Library'})).toHaveCount(0,{timeout:10000});
  await page.getByRole('button',{name:'Toggle sidebar'}).click();await page.getByRole('button',{name:/^Activity/}).click();
  await expect(page.getByRole('dialog',{name:'Activity',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Pause queue|Resume queue/})).toHaveCount(0);
  await expect(page.getByText('4 saved',{exact:true})).toBeVisible();
});

test('Activity uses request-specific continuation and saving recovery',async({page})=>{
  const request={workflow:'text-to-image',prompt:'A watercolor garden',mode:'sfw',output:{aspect:'16:9',size:'1mp'},seed:'random',count:1};
  const base={request,submission_index:0,seed:'42',outputs:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const jobs=[{...base,id:'held',submission_id:'held-request',state:'blocked',error:'Add credit before continuing.'},{...base,id:'save',submission_id:'saved-request',state:'copying',recovery_blocked:true,error:'The generated output could not be saved locally.'}];
  const actions:string[]=[];
  await page.route('**/api/v1/jobs?mode=*',r=>r.fulfill({json:{items:jobs}}));
  await page.route('**/api/v1/jobs/*/continue',r=>{actions.push(r.request().url());return r.fulfill({json:{jobs:[]}});});
  await page.route('**/api/v1/jobs/*/retry-save',r=>{actions.push(r.request().url());return r.fulfill({json:{}});});
  await page.goto('/');await page.getByRole('button',{name:/^Activity/}).click();
  await page.getByRole('button',{name:'Resolve issue',exact:true}).first().click();
  await expect(page.getByText('This output is waiting for a compatible worker.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Continue request',exact:true}).click();await page.getByRole('button',{name:'Close request details'}).click();
  await page.getByRole('button',{name:'Resolve issue',exact:true}).nth(1).click();
  await expect(page.getByText('This does not generate again.',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Retry saving',exact:true}).click();
  expect(actions.map(url=>new URL(url).pathname)).toEqual(['/api/v1/jobs/held/continue','/api/v1/jobs/save/retry-save']);
});
