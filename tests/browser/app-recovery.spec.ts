import {test,expect,type Page} from './fixtures.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const catalog = [
  ['501','Recovery','Render failure with safe recovery actions'],
  ['502','Recovery','Return to Generate after a render failure'],
] as const;
const root=path.resolve(process.env.SEED_ATLAS_ROOT??'.local/todo-repair-atlas');
async function capture(page:Page,device:string,id:string) {
  const [,surface,title]=catalog.find(row=>row[0]===id)!,file=`${device}/${id}.png`;
  await mkdir(path.join(root,device),{recursive:true});await page.screenshot({path:path.join(root,file)});
  await writeFile(path.join(root,device,id+'.json'),JSON.stringify({id,surface,title,device,file,viewport:page.viewportSize(),status:'passed',run_id:process.env.SEED_ATLAS_RUN_ID}));
}
for(const device of ['desktop','mobile'] as const)test.describe(device,()=>{
  test.use({baseURL:'http://seed-qa.test:4311',viewport:device==='desktop'?{width:1440,height:1000}:{width:390,height:844},isMobile:device==='mobile',hasTouch:device==='mobile'});
  test('render failure recovers without depending on the failed app or sending private content',async({page})=>{
    const reports:any[]=[];
    page.on('request',r=>{if(r.url().endsWith('/diagnostics/client-failure'))reports.push(r.postDataJSON());});
    // Replace only the fixture's lazy Chat module to exercise the production boundary.
    await page.route(/\/assets\/chat-[\w-]+\.js$/,r=>r.fulfill({contentType:'text/javascript',body:'export function Chat(){throw new TypeError("PRIVATE_FIXTURE_PROMPT /chat?secret=FIXTURE_ID");}'}));
    await page.goto('/chat');
    await expect(page.getByRole('heading',{name:'This screen couldn’t load'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Reload',exact:true})).toBeVisible();
    await expect.poll(()=>reports.filter(r=>r.kind==='render').length).toBe(1);
    const evidence=reports.find(r=>r.kind==='render');
    expect(evidence).toMatchObject({kind:'render',error_class:'TypeError',route:'chat',frame:{asset:expect.stringMatching(/^chat-.*\.js$/)}});
    expect(JSON.stringify(reports)).not.toMatch(/PRIVATE|FIXTURE|secret|message|stack|https?:/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await capture(page,device,'501');
    await page.getByRole('button',{name:'Reload',exact:true}).click();
    await expect(page.getByRole('heading',{name:'This screen couldn’t load'})).toBeVisible();
    await page.getByRole('link',{name:'Open Generate',exact:true}).click();
    await expect(page.getByLabel('Prompt',{exact:true})).toBeVisible();
    await expect(page).toHaveURL('http://seed-qa.test:4311/');
    await capture(page,device,'502');
  });
  test('asynchronous errors are recorded without hiding a working screen',async({page})=>{
    const reports:any[]=[];page.on('request',r=>{if(r.url().endsWith('/diagnostics/client-failure'))reports.push(r.postDataJSON());});
    await page.goto('/');await expect(page.getByLabel('Prompt',{exact:true})).toBeVisible();
    await page.evaluate(()=>{window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:new RangeError('PRIVATE_FIXTURE_PROMPT')}));});
    await expect.poll(()=>reports.length).toBe(1);
    expect(reports[0]).toMatchObject({kind:'async',error_class:'RangeError',route:'generate'});
    expect(JSON.stringify(reports)).not.toContain('PRIVATE');
    await expect(page.getByLabel('Prompt',{exact:true})).toBeVisible();
    await expect(page.locator('.app-recovery')).toHaveCount(0);
  });
});
