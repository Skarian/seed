import {test,expect,type Page,type APIRequestContext} from './atlas-fixtures.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

test.use({extraHTTPHeaders:{Origin:'http://127.0.0.1:4311'}});
const catalog = [
  ['601','Startup logs','RunPod boot output'],
  ['602','Startup logs','Waiting for the first read'],
  ['603','Startup logs','Provider has no output yet'],
  ['604','Startup logs','Delayed updates retain previous logs'],
  ['605','Startup logs','Browser refresh failure'],
  ['606','Startup logs','Model downloads and saved progress'],
  ['607','Startup logs','Verification progress'],
  ['608','Startup logs','Engine startup'],
  ['609','Startup logs','Ready with saved startup history'],
  ['610','Startup logs','Setup failure with recovery actions'],
  ['611','Startup logs','Released worker retains logs'],
  ['612','Startup logs','Multiple workers and long output'],
] as const;
const root=path.resolve(process.env.SEED_ATLAS_ROOT??'.local/startup-logs-atlas');
async function configure(request:APIRequestContext,body:object){expect((await request.post('/__qa/scenario',{data:body})).ok()).toBe(true);}
async function launch(request:APIRequestContext,provider='vast',role='image'){
  const offers=await(await request.get('/api/v1/pool/offers?worker_class='+role)).json();const offer=offers.items.find((v:any)=>v.provider===provider);
  const response=await request.post('/api/v1/pool/launch',{headers:{'Idempotency-Key':crypto.randomUUID()},data:{selections:[{offer_id:offer.id,quantity:1}],max_hourly:offer.hourly}});
  expect(response.ok()).toBe(true);return (await response.json()).workers.at(-1).id as string;
}
async function snapshot(request:APIRequestContext,id:string){return (await(await request.get('/api/v1/pool')).json()).workers.find((w:any)=>w.id===id);}
async function logs(request:APIRequestContext,id:string){return (await request.get(`/api/v1/pool/workers/${id}/startup-logs`)).json();}
async function openWorkers(page:Page){
  await page.goto('/');
  if(!await page.getByRole('button',{name:'GPU workers',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:'GPU workers',exact:true}).click();
}
for(const device of ['desktop','mobile'] as const)for(const [id,surface,title] of catalog){
  test(`${id} ${device} · ${title}`,async({page,request},testInfo)=>{
    test.setTimeout(45000);
    const viewport=device==='desktop'?{width:1440,height:1000}:{width:390,height:844};await page.setViewportSize(viewport);
    const scenario=({606:'preparing',607:'verifying',608:'engine_start',610:'base_failure'} as Record<string,string>)[id]??'acquiring';
    await configure(request,{scenario,log_mode:id==='603'?'empty':id==='612'?'long':'normal'});
    const workerId=await launch(request,id==='601'?'runpod':'vast', ['607','608'].includes(id)?'video':'image');
    await expect.poll(()=>snapshot(request,workerId).then(w=>w.state)).toBe(id==='610'?'needs_attention':scenario==='acquiring'?'starting':'preparing');
    if(scenario==='acquiring')await expect.poll(()=>logs(request,workerId).then(r=>r.checked_at)).toBeTruthy();
    if(id==='604'){
      await configure(request,{log_mode:'unavailable',advance_seconds:60});
      await expect.poll(()=>logs(request,workerId).then(r=>r.availability)).toBe('unavailable');
    }
    if(id==='609'){
      await configure(request,{scenario:'normal',advance_seconds:20});
      await expect.poll(()=>snapshot(request,workerId).then(w=>w.state),{timeout:15000}).toBe('ready');
    }
    if(id==='611'){
      expect((await request.post(`/api/v1/pool/workers/${workerId}/actions`,{data:{action:'quit'}})).ok()).toBe(true);
      await expect.poll(()=>snapshot(request,workerId).then(w=>w.state)).toBe('released');
    }
    if(id==='612'){await launch(request,'runpod','video');await expect.poll(async()=>(await(await request.get('/api/v1/pool')).json()).workers.length).toBe(2);}
    let release:(()=>void)|undefined;
    if(id==='602'){
      const hold=new Promise<void>(resolve=>release=resolve);
      await page.route('**/startup-logs',async route=>{await hold;await route.continue();});
    }
    await openWorkers(page);
    if(id==='611')await page.locator('.pool-released > summary').click();
    const panel=page.locator('.worker-startup-logs').first();await panel.locator('summary').click();
    if(id==='602')await expect(panel).toContainText('Loading startup logs');
    else await expect(panel.locator('.startup-log-content pre').first()).toBeVisible();
    if(id==='605'){
      await page.route('**/startup-logs',route=>route.fulfill({status:503,json:{error:{message:'Fixture read unavailable'}}}));
      await panel.getByRole('button',{name:'Refresh startup logs'}).click();await expect(panel).toContainText('Previous logs are still shown');
      await expect(panel).toContainText('checksum');
    }
    if(id==='603')await expect(panel).toContainText('Waiting for provider output');
    if(id==='604')await expect(panel).toContainText('Log updates delayed');
    if(id==='609')await expect(panel).toContainText('Startup complete');
    if(id==='611')await expect(panel).toContainText('Worker released');
    // Real reachable layouts at the narrowest supported phone size, then capture target device.
    if(device==='mobile'){
      await page.setViewportSize({width:320,height:700});
      expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      await page.setViewportSize(viewport);
    }
    await panel.scrollIntoViewIfNeeded();await page.evaluate(async()=>{await document.fonts.ready;});
    const dir=path.join(root,device);await mkdir(dir,{recursive:true});const file=`${device}/${id}.png`;
    await page.screenshot({path:path.join(root,file),animations:'disabled'});
    await writeFile(path.join(dir,id+'.json'),JSON.stringify({id,surface,title,device,viewport,status:'passed',file,test:testInfo.title,run_id:process.env.SEED_ATLAS_RUN_ID},null,2));
    await testInfo.attach(id+' '+device,{path:path.join(root,file),contentType:'image/png'});
    release?.();
    if(id==='601'){
      await configure(request,{scenario:'normal',advance_seconds:20});
      await expect(panel).toContainText('Startup complete',{timeout:15000});await expect(panel).toHaveAttribute('open','');
      const before=(await request.get('/__qa/status')).json();
      await page.getByRole('button',{name:'Close GPU workers',exact:true}).click();await openWorkers(page);
      await page.locator('.worker-startup-logs summary').first().click();await expect(page.locator('.worker-startup-logs').first()).toContainText('Startup complete');
      const after=await(await request.get('/__qa/status')).json();
      expect(after.audit.filter((r:any)=>r.kind==='startup_log').length).toBe((await before).audit.filter((r:any)=>r.kind==='startup_log').length);
    }
  });
}
