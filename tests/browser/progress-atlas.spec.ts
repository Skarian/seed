import {test,expect,type Page,type APIRequestContext} from './atlas-fixtures.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

test.use({extraHTTPHeaders:{Origin:'http://127.0.0.1:4311'}});
const catalog = [
  ['521','Worker startup','Fresh model transfer'],
  ['522','Worker startup','Stale transfer reports'],
  ['523','Worker startup','Older worker without telemetry'],
  ['524','Worker startup','Verifying downloaded models'],
  ['525','Worker startup','Starting engine after verification'],
  ['526','Worker startup','Measuring initial download rate'],
  ['527','Worker startup','Explicit retry pending'],
] as const;
const scenarios:Record<string,string> = {521:'preparing',522:'download_stalled',523:'legacy_progress',524:'verifying',525:'engine_start',526:'download_start',527:'base_failure'};
const root=path.resolve(process.env.SEED_ATLAS_ROOT??'.local/todo-repair-atlas');

async function launch(request:APIRequestContext,id:string){
  expect((await request.post('/__qa/scenario',{data:{scenario:scenarios[id]}})).ok()).toBe(true);
  const offers=await(await request.get('/api/v1/pool/offers?worker_class=video')).json();
  const offer=offers.items.find((item:any)=>item.provider==='runpod');
  expect(offer).toBeTruthy();
  const result=await request.post('/api/v1/pool/launch',{headers:{'Idempotency-Key':'progress-atlas-'+id+'-fixture'},data:{selections:[{offer_id:offer.id,quantity:1}],max_hourly:offer.hourly}});
  expect(result.ok()).toBe(true);
  const worker=(await result.json()).workers.at(-1);
  await expect.poll(async()=>{
    const snapshot=await(await request.get('/api/v1/pool')).json();
    return snapshot.workers.find((item:any)=>item.id===worker.id)?.state;
  },{timeout:20000}).toBe(id==='527'?'needs_attention':'preparing');
  return worker.id;
}
async function openWorkers(page:Page){
  if(!await page.getByRole('button',{name:'GPU workers',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:'GPU workers',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();
}

for(const device of ['desktop','mobile'] as const)for(const [id,surface,title] of catalog){
  test(`${id} ${device} · ${title}`,async({page,request},testInfo)=>{
    const width=device==='desktop'?1440:390,height=device==='desktop'?1000:844;
    await page.setViewportSize({width,height});
    await mkdir(path.join(root,device),{recursive:true});
    const filename=`${device}/${id}.png`,captures:{position:string;file:string}[]=[];
    let passed=false,captured=false,release:(()=>void)|undefined;
    async function capture(){
      await page.evaluate(async()=>{await document.fonts.ready;});
      const scroller=page.locator('.pool-content');
      if(await scroller.count())await scroller.evaluate(element=>element.scrollTop=0);
      await page.screenshot({path:path.join(root,filename),animations:'disabled'});captured=true;
      if(await scroller.count()){
        const size=await scroller.evaluate(element=>({height:element.clientHeight,total:element.scrollHeight}));
        if(size.total>size.height+1){
          const file=`${device}/${id}-bottom.png`;
          await scroller.evaluate(element=>element.scrollTop=element.scrollHeight);
          await page.screenshot({path:path.join(root,file),animations:'disabled'});
          captures.push({position:'Bottom',file});
        }
      }
    }
    try{
      const workerId=await launch(request,id);
      await page.goto('/');await expect(page.getByLabel('Prompt',{exact:true})).toBeVisible();await openWorkers(page);
      const preparation=page.getByRole('region',{name:'Worker setup'});
      await expect(preparation).toBeVisible();
      if(id==='521'){
        await expect(preparation.locator('.worker-transfer-stats')).toContainText('/s');
        await expect(preparation.locator('.worker-transfer-freshness')).toContainText('Last transfer update');
        const snapshot=await(await request.get('/api/v1/pool')).json(),files=snapshot.workers.find((worker:any)=>worker.id===workerId).preparation.files;
        expect(files.filter((file:any)=>file.state==='downloading'&&!file.optional)).toHaveLength(1);
        expect(files.filter((file:any)=>file.state==='downloading'&&file.optional).length).toBeLessThanOrEqual(1);
      }
      if(id==='522'){
        await expect(preparation.locator('.worker-transfer-stats')).toContainText('Rate unavailable');
        await expect(preparation.locator('.worker-transfer-freshness')).toContainText('Last transfer update');
        await expect(preparation).not.toContainText('downloads left');
      }
      if(id==='523'){
        await expect(preparation.locator('.worker-transfer-stats')).toContainText('Rate unavailable');
        await expect(preparation.locator('.worker-transfer-freshness')).toHaveCount(0);
        await expect(preparation.locator('.worker-setup-hint')).toContainText('Transfer speed is not reported.');
      }
      if(id==='524'){
        await expect(preparation).toContainText('Checking model files');
        await expect(preparation).not.toContainText('Rate unavailable');
      }
      if(id==='525'){
        await expect(preparation).toContainText('Starting generation engine');
        await expect(preparation.getByRole('progressbar')).toHaveCount(0);
        const snapshot=await(await request.get('/api/v1/pool')).json();
        expect(snapshot.workers.find((worker:any)=>worker.id===workerId).preparation.files.every((file:any)=>file.ready||file.omitted)).toBe(true);
      }
      if(id==='526')await expect(preparation.locator('.worker-transfer-stats')).toContainText('Measuring rate');
      if(id==='527'){
        const held=new Promise<void>(resolve=>{release=resolve;});
        await page.route('**/api/v1/pool/workers/*/actions',async route=>{await held;await route.continue();});
        await page.getByRole('button',{name:'Retry preparation',exact:true}).click();
        await expect(page.getByRole('button',{name:'Retrying…',exact:true})).toBeDisabled();
      }
      await capture();
      if(release){release();release=undefined;await expect(page.locator('.pool-worker .worker-state')).toHaveText('Ready',{timeout:20000});}
      passed=true;
    }finally{
      release?.();
      if(!captured)await capture();
      await writeFile(path.join(root,device,id+'.json'),JSON.stringify({id,title,surface,device,viewport:{width,height},status:passed?'passed':'failed',file:filename,test:testInfo.title,captures,run_id:process.env.SEED_ATLAS_RUN_ID},null,2));
      await testInfo.attach(id+' '+device,{path:path.join(root,filename),contentType:'image/png'});
    }
  });
}
