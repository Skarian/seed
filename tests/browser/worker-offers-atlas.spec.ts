import {test,expect} from './fixtures.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {WorkerOffer} from '../../shared/pool.js';

const catalog = [
  ['301','Workers','Vast image hosts'],['302','Workers','Vast video hosts'],
  ['303','Workers','Vast transfer and machine details'],['304','Workers','RunPod regional stock'],
  ['305','Workers','Multiple workers selected'],['306','Workers','Provider and price filters'],
  ['307','Workers','Download speed comparison'],['308','Workers','Missing measurements edge case'],
  ['309','Workers','RunPod availability comparison'],['310','Workers','RunPod credentials need attention'],
] as const;
const root=path.resolve(process.env.SEED_OFFERS_ROOT??'.local/worker-offers-atlas');
for(const device of ['desktop','mobile'] as const)for(const [id,surface,title] of catalog){
  test(`${id} ${device} · ${title}`,async({page},testInfo)=>{
    const captured=JSON.parse(await readFile(path.join(root,'live-offers.json'),'utf8'));
    const width=device==='desktop'?1440:390,height=device==='desktop'?1000:844;
    await page.setViewportSize({width,height});
    page.setDefaultTimeout(5000);
    let rentals=0,passed=false;
    await page.route('**/api/v1/pool/launch',route=>{rentals++;return route.abort();});
    await page.route('**/api/v1/pool/offers?*',route=>{
      const role=new URL(route.request().url()).searchParams.get('worker_class')??'image';
      let items:WorkerOffer[]=captured[role].map((o:WorkerOffer)=>({...o,expires_at:new Date(Date.now()+120000).toISOString()}));
      if(id==='308')items=items.filter(o=>o.provider==='vast').slice(0,1).map(o=>({...o,download_mbps:undefined,download_per_gb:undefined,upload_per_gb:undefined,reliability:undefined}));
      const issues=id==='310'?[{provider:'runpod',code:'missing_credentials',message:'Add your RunPod key in Admin to see available GPUs.',retryable:false}]:[];
      if(id==='310')items=items.filter(o=>o.provider!=='runpod');
      return route.fulfill({json:{items,issues,searched_at:captured.captured_at}});
    });
    try{
      await page.goto('/');
      if(!await page.getByRole('button',{name:'GPU workers',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
      await page.getByRole('button',{name:'GPU workers',exact:true}).click();
      await page.getByRole('button',{name:'Add workers',exact:true}).click();
      if(id==='302'||id==='304')await page.getByRole('button',{name:/Video worker H3/}).click();
      await expect(page.locator('.pool-offer').first()).toBeVisible();
      if(id==='303'||id==='306'||id==='308')await page.getByRole('button',{name:'Vast',exact:true}).click();
      if(['304','309','310'].includes(id))await page.getByRole('button',{name:'RunPod',exact:true}).click();
      if(id==='309'){
        const sort=page.getByRole('combobox',{name:'Sort by',exact:true});
        await expect(sort.locator('option')).toHaveText(['Lowest hourly rate','Highest availability']);
        await sort.selectOption('availability');
        await expect(page.locator('.pool-offer').first()).toContainText('High availability');
        await expect(page.getByRole('combobox',{name:'Region',exact:true})).toHaveCount(0);
        await expect(page.locator('.pool-offer-signals').first()).not.toContainText(/Not quoted|Advertised download|reliability/);
        await page.getByRole('button',{name:'Vast',exact:true}).click();
        await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('download_speed');
        await page.getByRole('button',{name:'RunPod',exact:true}).click();
        await expect(sort).toHaveValue('availability');
      }
      if(id==='310'){
        await expect(page.getByRole('button',{name:'Open Credentials',exact:true})).toBeVisible();
        await expect(page.getByRole('heading',{name:'Availability needs attention'})).toBeVisible();
        await expect(page.locator('.pool-offer')).toHaveCount(0);
        await page.getByRole('button',{name:'Vast',exact:true}).click();
        await expect(page.locator('.pool-offer').first()).toBeVisible();
        await expect(page.getByRole('button',{name:'Open Credentials',exact:true})).toHaveCount(0);
        await page.getByRole('button',{name:'RunPod',exact:true}).click();
      }
      if(id==='306'){
        const items:WorkerOffer[]=captured.image.filter((o:WorkerOffer)=>o.provider==='vast');
        const ceiling=Math.min(...items.map(o=>o.hourly))+.2;
        await page.getByLabel('Maximum hourly rate').fill(ceiling.toFixed(2));
        expect(await page.locator('.pool-offer').count()).toBe(items.filter(o=>o.hourly<=Number(ceiling.toFixed(2))).length);
      }
      if(id==='307'){
        await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('download_speed');
        const best=captured.image.filter((o:WorkerOffer)=>o.download_mbps!==undefined).sort((a:WorkerOffer,b:WorkerOffer)=>b.download_mbps!-a.download_mbps!)[0];
        await expect(page.locator('.pool-offer').first()).toContainText(best.gpu);
      }
      if(id==='305'){
        await page.getByRole('button',{name:'RunPod',exact:true}).click();
        await page.locator('.pool-offer input[type=checkbox]').first().check();
        await page.getByLabel(/Quantity for/).selectOption('3');
        await page.getByRole('button',{name:'Vast',exact:true}).click();
        await page.locator('.pool-offer input[type=checkbox]').first().check();
        await expect(page.getByRole('button',{name:/Start 4 workers/})).toBeEnabled();
        await expect(page.locator('.pool-selection-providers')).toHaveText('1 Vast · 3 RunPod');
        await page.getByRole('button',{name:'RunPod',exact:true}).click();
        await expect(page.getByLabel(/Quantity for/)).toHaveValue('3');
        await page.getByRole('button',{name:'Vast',exact:true}).click();
        await expect(page.locator('.pool-offer input[type=checkbox]').first()).toBeChecked();
      }
      if(id==='303'||id==='304')await page.locator('.pool-offer summary').first().click();
      if(id==='304'){
        await expect(page.locator('.pool-offer').first()).toContainText('RunPod chooses the location at launch');
        await expect(page.locator('.pool-offer').first()).not.toContainText('16 available');
        await expect(page.locator('.pool-offer').first()).toContainText('Secure Cloud');
      }
      if(id==='308')await expect(page.locator('.pool-offer').first()).toContainText('Not quoted');
      if(id!=='310')await expect(page.locator('.pool-offer').first()).toContainText('Disk included');
      for(const w of device==='desktop'?[768,1024,1440]:[320,360,390]){
        await page.setViewportSize({width:w,height});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await page.locator('.pool-offer').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth))).toBe(true);
      }
      await page.setViewportSize({width,height});
      await page.locator('.pool-content').evaluate(el=>el.scrollTop=0);
      passed=true;
    }finally{
      const folder=path.join(root,device);await mkdir(folder,{recursive:true});
      await page.evaluate(()=>document.fonts.ready);
      const overview=`${id}-overview.png`,file=`${id}.png`;
      await page.screenshot({path:path.join(folder,overview),animations:'disabled'});
      if(await page.locator('.pool-offer').count())await page.locator('.pool-offer').first().evaluate(el=>el.scrollIntoView({block:'start'}));
      if(id==='305')await page.locator('.pool-launch-footer').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(folder,file),animations:'disabled'});
      const captures=[{position:'Overview',file:device+'/'+overview}];
      if(id==='304'){
        await page.locator('.pool-offer-locations').first().locator('li').last().evaluate(el=>el.scrollIntoView({block:'center'}));
        const bottom=`${id}-details-bottom.png`;
        await page.screenshot({path:path.join(folder,bottom),animations:'disabled'});
        captures.push({position:'Regional stock',file:device+'/'+bottom});
      }
      await writeFile(path.join(folder,id+'.json'),JSON.stringify({id,surface,title,device,viewport:{width,height},run_id:process.env.SEED_ATLAS_RUN_ID,status:passed?'passed':'failed',file:device+'/'+file,captures,test:testInfo.title,source:captured.captured_at}));
      expect(rentals).toBe(0);
    }
  });
}
