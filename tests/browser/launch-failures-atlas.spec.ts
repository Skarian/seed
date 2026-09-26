import {test,expect,type Page,type APIRequestContext} from './atlas-fixtures.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

test.use({extraHTTPHeaders:{Origin:'http://127.0.0.1:4311'}});
const catalog = [
  ['511','Workers','Rejected launch · no rental'],
  ['512','Workers','Rejected launch beside ready worker'],
  ['513','Workers','Multiple rejected launches'],
  ['514','Activity','Dismissed launch retains its failure history'],
  ['515','Workers','Replacement selection starts fresh'],
] as const;
const snapshot=async(request:APIRequestContext)=>(await request.get('/api/v1/pool')).json();
async function open(page:Page) {
  if(!await page.getByRole('button',{name:'GPU workers',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:'GPU workers',exact:true}).click();
}
for(const device of ['desktop','mobile'] as const)for(const [id,surface,title] of catalog) {
  test(`${id} ${device} · ${title}`,async({page,request},testInfo)=>{
    const viewport=device==='desktop'?{width:1440,height:1000}:{width:390,height:844};
    const root=path.resolve(process.env.SEED_ATLAS_ROOT??'.local/todo-repair-atlas'), directory=path.join(root,device);
    await mkdir(directory,{recursive:true});
    let passed=false;
    try {
      await request.post('/__qa/scenario',{data:{scenario:'launch_failure'}});
      await page.setViewportSize(viewport);
      await page.goto('/');await open(page);
      await page.getByRole('button',{name:'Add workers',exact:true}).click();
      await page.getByRole('button',{name:/Video worker H3/}).click();
      await page.locator('.pool-offer input[type=checkbox]').first().check();
      const mixed=['512','515'].includes(id);
      if(mixed){await page.getByRole('button',{name:'RunPod',exact:true}).click();await page.locator('.pool-offer input[type=checkbox]').first().check();}
      await page.getByRole('button',{name:new RegExp(`^Start ${mixed?2:1} worker`)}).click();
      const failure=page.getByRole('article',{name:'Video worker launch failed'});
      await expect(failure).toBeVisible({timeout:15000});
      await expect(failure).toContainText('No rental was created');
      await expect(failure).toContainText('Estimated rental spend: $0.00');
      await expect(page.locator('.pool-worker')).toHaveCount(mixed?1:0);
      if(mixed)await expect(page.locator('.pool-worker .worker-state')).toHaveText('Ready');
      const current=await snapshot(request), rejected=current.workers.find((w:any)=>w.create_rejected);
      expect(current.summary.active).toBe(mixed?1:0);
      expect(current.summary.hourly).toBe(mixed?1.24:0);
      await expect(page.locator('.pool-released')).toHaveCount(0);
      if(id==='513'){
        const offers=await(await request.get('/api/v1/pool/offers?worker_class=image')).json();
        const offer=offers.items.find((o:any)=>o.provider==='vast');
        expect((await request.post('/api/v1/pool/launch',{headers:{'Idempotency-Key':'second-rejection-fixture'},data:{selections:[{offer_id:offer.id,quantity:1}],max_hourly:offer.hourly}})).ok()).toBe(true);
        await expect(page.locator('.pool-launch-failure')).toHaveCount(2);
      }
      if(id!=='515'){await page.reload();await open(page);await expect(failure).toBeVisible();}
      if(id==='515'){
        const before=(await(await request.get('/__qa/status')).json()).audit.filter((e:any)=>e.kind==='create').length;
        await failure.getByRole('button',{name:'Find another GPU'}).click();
        await expect(page.getByRole('button',{name:/Video worker H3/})).toHaveAttribute('aria-pressed','true');
        await expect(page.locator('.pool-offer').first()).toBeVisible();
        await expect(page.locator('.pool-offer input[type=checkbox]:checked')).toHaveCount(0);
        await page.getByRole('button',{name:'RunPod',exact:true}).click();
        await expect(page.getByRole('button',{name:'RunPod',exact:true})).toHaveAttribute('aria-pressed','true');
        await expect(page.locator('.pool-offer input[type=checkbox]:checked')).toHaveCount(0);
        await expect(page.getByRole('button',{name:/^Start workers/})).toBeDisabled();
        expect((await(await request.get('/__qa/status')).json()).audit.filter((e:any)=>e.kind==='create').length).toBe(before);
      } else if(id==='514') {
        await failure.getByRole('button',{name:'Dismiss',exact:true}).click();await expect(failure).toHaveCount(0);
        await page.reload();await open(page);await expect(failure).toHaveCount(0);
        const dismissed=(await snapshot(request)).workers.find((w:any)=>w.id===rejected.id);
        expect(dismissed.launch_failure_dismissed_at).toBeTruthy();expect(dismissed.issue.code).toBe('capacity_unavailable');
        await page.getByRole('button',{name:'Close GPU workers'}).click();
        if(!await page.getByRole('button',{name:/^Activity/}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
        await page.getByRole('button',{name:/^Activity/}).click();
        await expect(page.locator('.worker-activity').filter({hasText:'Launch failed'}).first()).toContainText('No rental was created');
      }
      if(!['514','515'].includes(id))expect(await failure.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      if(id==='515')await expect(page.locator('.mode-toast.is-visible')).toHaveCount(0,{timeout:10000});
      await page.screenshot({path:path.join(directory,id+'.png'),animations:'disabled'});
      passed=true;
    } finally {
      await writeFile(path.join(directory,id+'.json'),JSON.stringify({id,surface,title,device,viewport,status:passed?'passed':'failed',file:`${device}/${id}.png`,captures:[`${device}/${id}.png`],run_id:process.env.SEED_ATLAS_RUN_ID??null},null,2));
    }
  });
}
