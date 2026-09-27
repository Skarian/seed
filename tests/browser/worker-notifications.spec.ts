import {test,expect} from './fixtures.js';

for(const width of [390,1440])test(`${width}px opening historical failures stays quiet; new failures notify once`,async({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width,height:900});
  let reads=0;
  const failure=(id:string,role='image')=>({id,provider:'vast',worker_class:role,state:'released',create_rejected:true,
    gpu:'Fixture GPU',created_at:'2026-09-23T13:52:00Z',released_at:'2026-09-23T13:52:01Z',hourly:1,estimated_spend:0,
    issue:{code:'capacity_unavailable',message:'This fixture offer is no longer available.'},available_actions:['dismiss_launch_failure'],installed_loras:[],requested_loras:[]});
  const workers:any[]=[failure('old-1'),failure('old-2'),failure('old-3','video')];
  await page.route('**/api/v1/pool',route=>{reads++;return route.fulfill({json:{workers,server_time:new Date().toISOString(),summary:{active:0,hourly:0,estimated_spend:0,needs_attention:0,ready:0}}});});
  const seen:string[]=[];
  await page.exposeFunction('recordFixtureToast',(message:string)=>seen.push(message));
  await page.addInitScript(()=>{
    const start=()=>new MutationObserver(()=>{
      for(const node of document.querySelectorAll('.mode-toast.is-visible'))(window as any).recordFixtureToast(node.textContent??'');
    }).observe(document.body,{subtree:true,childList:true,attributes:true});
    if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  });
  await page.goto('/');await expect.poll(()=>reads).toBeGreaterThanOrEqual(3);
  expect(seen.filter(text=>text.includes('worker launch failed'))).toEqual([]);
  if(width===390)await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:'GPU workers',exact:true}).click();
  await expect(page.locator('.pool-launch-failure')).toHaveCount(3);
  await page.getByRole('button',{name:'Close GPU workers',exact:true}).click();
  // A fast rejection can arrive without the browser ever seeing its starting state.
  workers.push(failure('new-fast','video'));
  await expect(page.locator('.mode-toast.is-visible').filter({hasText:'Video worker launch failed'})).toHaveCount(1);
  const before=reads;await expect.poll(()=>reads,{timeout:12000}).toBeGreaterThanOrEqual(before+4);
  await expect(page.locator('.mode-toast.is-visible').filter({hasText:'worker launch failed'})).toHaveCount(0);
  // Also exercise an observed in-progress launch becoming rejected.
  workers.push({...failure('new-pending'),state:'starting',create_rejected:false,released_at:undefined,issue:undefined});
  const pending=reads;await expect.poll(()=>reads).toBeGreaterThan(pending);
  workers[4]=failure('new-pending');
  await expect(page.locator('.mode-toast.is-visible').filter({hasText:'Image worker launch failed'})).toHaveCount(1);
  seen.length=0;reads=0;
  await page.reload();await expect.poll(()=>reads).toBeGreaterThanOrEqual(3);
  expect(seen.filter(text=>text.includes('worker launch failed'))).toEqual([]);
});
