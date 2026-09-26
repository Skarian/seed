import {test,expect} from './atlas-fixtures.js';
test.use({extraHTTPHeaders:{Origin:'http://127.0.0.1:4311'}});
for(const width of [1440,390])test(`Activity opens an older released startup record at ${width}px`,async({page,request})=>{
  await page.setViewportSize({width,height:900});
  await request.post('/__qa/scenario',{data:{scenario:'acquiring'}});
  const offers=await(await request.get('/api/v1/pool/offers?worker_class=image')).json(),offer=offers.items[0];
  const created=await(await request.post('/api/v1/pool/launch',{headers:{'Idempotency-Key':crypto.randomUUID()},data:{selections:[{offer_id:offer.id,quantity:1}],max_hourly:offer.hourly}})).json();
  const id=created.workers[0].id;
  await expect.poll(async()=>(await(await request.get(`/api/v1/pool/workers/${id}/startup-logs`)).json()).checked_at).toBeTruthy();
  await request.post(`/api/v1/pool/workers/${id}/actions`,{data:{action:'quit'}});
  await expect.poll(async()=>(await(await request.get('/api/v1/pool')).json()).workers[0].state).toBe('released');
  const saved=await(await request.get('/api/v1/pool')).json(),original={...saved.workers[0],gpu:'Older fixture worker'};
  // The endpoint and selected worker are real fixture records. Additional historical
  // rows exercise the list cutoff without creating unrelated fixture rentals.
  const recent=Array.from({length:13},(_,i)=>({...original,id:'history-fixture-'+i,gpu:'Recent fixture '+i,created_at:new Date(Date.now()+i*1000).toISOString(),released_at:new Date(Date.now()+i*1000).toISOString()}));
  await page.route('**/api/v1/pool',route=>route.fulfill({json:{...saved,workers:[original,...recent]}}));
  await page.goto('/');
  if(!await page.getByRole('button',{name:/^Activity/}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:/^Activity/}).click();
  const row=page.locator('.worker-activity').filter({hasText:'Older fixture worker'});
  await row.getByRole('button',{name:'View worker',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();
  const selected=page.locator('.pool-released-worker').filter({hasText:'Older fixture worker'});
  await expect(selected).toBeVisible();await expect(selected.locator('.worker-startup-logs')).toHaveAttribute('open','');
  await expect(selected).toContainText('Worker released');
  const before=await(await request.get('/__qa/status')).json();
  await selected.getByRole('button',{name:'Refresh startup logs'}).click();
  await expect(selected.getByRole('button',{name:'Refresh startup logs'})).toBeEnabled();
  const after=await(await request.get('/__qa/status')).json();
  expect(after.audit.filter((v:any)=>['startup_log','create','destroy'].includes(v.kind))).toEqual(before.audit.filter((v:any)=>['startup_log','create','destroy'].includes(v.kind)));
  await selected.locator('.worker-startup-logs > summary').focus();await page.keyboard.press('Space');
  await expect(selected.locator('.worker-startup-logs')).not.toHaveAttribute('open');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toHaveCount(0);
});
