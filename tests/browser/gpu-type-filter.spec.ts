import {test, expect} from './fixtures.js';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {WorkerOffer} from '../../shared/pool.js';

const catalog = [
  ['701','Workers','Image GPUs on Vast'],['702','Workers','Image GPUs on RunPod'],
  ['703','Workers','Video GPUs on Vast'],['704','Workers','Video GPUs on RunPod'],
] as const;
const root=path.resolve(process.env.SEED_OFFERS_ROOT??'.local/gpu-type-filter');
for(const device of ['desktop','mobile'] as const)for(const [id,surface,title] of catalog){
  test(`${id} ${device} · ${title}`,async({page},testInfo)=>{
    const captured=JSON.parse(await readFile(path.join(root,'live-offers.json'),'utf8'));
    const role=id==='701'||id==='702'?'image':'video',provider=id==='701'||id==='703'?'vast':'runpod';
    const providerName=provider==='vast'?'Vast':'RunPod';
    const items:WorkerOffer[]=captured[role].filter((o:WorkerOffer)=>o.provider===provider);
    const types=[...new Set(items.map(o=>o.gpu))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true,sensitivity:'base'}));
    expect(types.length,'Live catalog needs at least two GPU types').toBeGreaterThanOrEqual(2);
    const chosen=[...types].sort((a,b)=>b.length-a.length).slice(0,2);
    let launches=0,dropSelected=false,passed=false;
    const width=device==='desktop'?1440:390,height=device==='desktop'?1000:844;
    await page.setViewportSize({width,height});
    await page.route('**/api/v1/pool/launch',route=>{launches++;return route.abort();});
    await page.route('**/api/v1/pool/offers?*',route=>{
      const requested=new URL(route.request().url()).searchParams.get('worker_class')!;
      return route.fulfill({json:{items:captured[requested].filter((o:WorkerOffer)=>!dropSelected||o.provider!==provider||!chosen.includes(o.gpu)).map((o:WorkerOffer)=>({...o,expires_at:new Date(Date.now()+120000).toISOString()})),issues:[],searched_at:captured.captured_at}});
    });
    const filter=page.getByRole('group',{name:'GPU type',exact:true});
    const sort=page.getByRole('combobox',{name:'Sort by',exact:true});
    const cards=page.locator('.pool-offer-choice > span:nth-of-type(1) > strong');
    const openFilter=async()=>{if(!await filter.locator('details').getAttribute('open').then(v=>v!==null))await filter.locator('summary').click();};
    try{
      await page.goto('/');
      if(!await page.getByRole('button',{name:'GPU workers',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
      await page.getByRole('button',{name:'GPU workers',exact:true}).click();
      await page.getByRole('button',{name:'Add workers',exact:true}).click();
      if(role==='video')await page.getByRole('button',{name:/Video worker H3/}).click();
      await page.getByRole('button',{name:providerName,exact:true}).click();
      await expect(cards).toHaveCount(items.length);
      await openFilter();
      await expect(filter.locator('label > span')).toHaveText(types);
      await filter.getByRole('checkbox',{name:chosen[0],exact:true}).check();
      await expect(cards).toHaveCount(items.filter(o=>o.gpu===chosen[0]).length);
      await filter.getByRole('checkbox',{name:chosen[1],exact:true}).check();
      const selected=items.filter(o=>chosen.includes(o.gpu));
      await expect(cards).toHaveCount(selected.length);
      const order=provider==='vast'?'download_speed':'availability';
      await sort.selectOption(order);
      const metric=(o:WorkerOffer)=>provider==='vast'?(o.download_mbps??-1):({HIGH:3,MEDIUM:2,LOW:1}[o.stock!]??-1);
      await expect(cards).toHaveText([...selected].sort((a,b)=>metric(b)-metric(a)||a.hourly-b.hourly).map(o=>o.gpu));
      await expect(filter.locator('label > span')).toHaveText(types);
      // Each provider and worker class retains its own choices and sort order.
      await page.getByRole('button',{name:provider==='vast'?'RunPod':'Vast',exact:true}).click();
      await expect(filter.locator('summary')).toHaveText('All GPU types⌄');
      await page.getByRole('button',{name:providerName,exact:true}).click();
      await expect(filter.locator('summary')).toContainText('2 GPU types selected');
      await expect(sort).toHaveValue(order);
      await page.getByRole('button',{name:role==='image'?/Video worker H3/:/Image worker Krea/}).click();
      await expect(filter.locator('summary')).toHaveText('All GPU types⌄');
      await page.getByRole('button',{name:role==='image'?/Image worker Krea/:/Video worker H3/}).click();
      await expect(cards).toHaveCount(selected.length);
      await expect(sort).toHaveValue(order);
      const ceiling=Math.min(...selected.map(o=>o.hourly));
      await page.getByLabel('Maximum hourly rate').fill(String(ceiling));
      await expect(cards).toHaveCount(selected.filter(o=>o.hourly<=ceiling).length);
      await page.getByLabel('Maximum hourly rate').fill('');
      if(id==='701'){
        dropSelected=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
        await expect(cards).toHaveCount(0);await openFilter();
        await expect(filter.getByText('Currently unavailable')).toHaveCount(2);
        dropSelected=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(cards).toHaveCount(selected.length);
      }
      await openFilter();await filter.getByRole('button',{name:'Clear GPU filter'}).click();
      await expect(cards).toHaveCount(items.length);await expect(sort).toHaveValue(order);
      // Keyboard interaction uses the same native checkboxes as touch/mouse.
      await filter.getByRole('checkbox',{name:chosen[0],exact:true}).focus();await page.keyboard.press('Space');
      await filter.getByRole('checkbox',{name:chosen[1],exact:true}).check();
      await expect(cards).toHaveCount(selected.length);
      for(const w of device==='desktop'?[768,1024,1440]:[320,360,390]){
        await page.setViewportSize({width:w,height});
        expect(await filter.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      }
      passed=true;
    }finally{
      await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
      const folder=path.join(root,device);await mkdir(folder,{recursive:true});
      await filter.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(folder,id+'.png'),animations:'disabled'});
      await filter.locator('summary').click();await filter.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(folder,id+'-results.png'),animations:'disabled'});
      await writeFile(path.join(folder,id+'.json'),JSON.stringify({id,surface,title,device,viewport:{width,height},run_id:process.env.SEED_ATLAS_RUN_ID,status:passed?'passed':'failed',file:device+'/'+id+'.png',captures:[{position:'Filtered results and independent sort',file:device+'/'+id+'-results.png'}],test:testInfo.title,source:captured.captured_at}));
      expect(launches).toBe(0);
    }
  });
}
