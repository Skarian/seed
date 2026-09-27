import { test, expect, type Page, type APIRequestContext } from './atlas-fixtures.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

test.use({extraHTTPHeaders:{Origin:'http://127.0.0.1:4311'}});
const catalog = [
  ['001','Generate','Image · empty prompt'],['002','Generate','Image · ready and quantity'],['003','Generate','Video · full width settings'],['004','Generate','References · empty inputs'],['005','Generate','Fixed seed'],['006','Generate','LoRA · needs a new worker'],
  ['007','Admin','Credentials'],['008','Admin','LoRA catalog'],['009','Admin','Civitai file mapping'],['010','Admin','Unsupported model family'],
  ['011','Chat','New conversation'],['012','Chat','Request approval'],['013','Chat','Expanded request review'],['014','Library','Library'],
  ['015','Workers','Empty pool'],['016','Workers','Image offers'],['017','Workers','Video offers'],['018','Workers','Multiple workers selected'],['019','Workers','No matching offers'],['020','Workers','One provider unavailable'],['021','Workers','Missing provider credentials'],
  ['022','Workers','Preparing model assets'],['023','Workers','Ready worker'],['024','Workers','Generation in progress'],['025','Workers','LoRA download failure'],['026','Workers','Connection interrupted'],['027','Workers','Termination not confirmed'],['028','Workers','Released rental'],['029','Activity','Mixed worker and request activity'],
  ['030','Generate','Queued without capacity'],['031','Generate','Video queue needs a worker'],['032','Generate','Completed output'],['033','Library','Saved result'],['034','Preview','Image preview'],['035','Chat','Approved request waiting'],['036','Cross-page','Credentials round trip'],['037','Workers','Finish jobs and quit'],['038','Workers','Mixed worker pool'],['039','Workers','Elapsed rental spend'],['040','Admin','LoRA import confirmation'],['041','Workers','Base model download fallback'],
  ['042','Acquisition','Provider allocating worker'],['043','Acquisition','Download speed warming up'],['044','Acquisition','Live video model download'],['045','Acquisition','Transfer waiting for data'],['046','Acquisition','File verification'],['047','Acquisition','Engine starting'],['048','Acquisition','Model download details'],['049','Acquisition','Ready notification'],['050','Acquisition','Queued job starts automatically'],['051','Acquisition','Retry download succeeds'],['052','Acquisition','Continue without failed adapter'],['053','Acquisition','Quit during acquisition'],['054','Acquisition','Background preparation in sidebar'],['055','Acquisition','Older worker without telemetry'],['056','Acquisition','Finish queued work during setup'],['057','Acquisition','Preparing and ready workers'],
] as const;
const root = path.resolve('.local/worker-pool-atlas');
async function scenario(request: APIRequestContext, name: string, advance_seconds?: number) { const result=await request.post('/__qa/scenario',{data:{scenario:name,...(advance_seconds?{advance_seconds}:{})}});expect(result.ok()).toBeTruthy(); }
async function launch(request: APIRequestContext, role='image', provider='runpod', quantity=1) {
  const offers=await (await request.get('/api/v1/pool/offers?worker_class='+role)).json(),offer=offers.items.find((value:any)=>value.provider===provider);
  expect(offer).toBeTruthy();const response=await request.post('/api/v1/pool/launch',{headers:{'Idempotency-Key':'atlas-'+Date.now()+'-'+Math.random().toString(36).slice(2)},data:{selections:[{offer_id:offer.id,quantity}],max_hourly:offer.hourly*quantity}});expect(response.ok()).toBeTruthy();
  return (await response.json()).workers.filter((worker:any)=>worker.state!=='released').at(-1).id;
}
async function waitState(request:APIRequestContext,state:string) { await expect.poll(async()=>{const result=await(await request.get('/api/v1/pool')).json();return result.workers.some((worker:any)=>worker.state===state);},{timeout:20000}).toBeTruthy(); }
async function openWorkers(page:Page, tab:'workers'|'add'='workers') {
  if(await page.getByRole('dialog',{name:'GPU workers',exact:true}).isVisible()){await page.getByRole('navigation',{name:'GPU worker views'}).getByRole('button',{name:tab==='add'?'Add workers':/^Workers/}).click();return;}
  if(!await page.getByRole('button',{name:'GPU workers',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.getByRole('button',{name:'GPU workers',exact:true}).click();
  if(tab==='add')await page.getByRole('button',{name:'Add workers',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();
}
async function workflow(page:Page,name:string) {if(!await page.getByRole('button',{name,exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();}
async function waitForWorkerBadge(page:Page){const opened=!(await page.locator('.worker-status-button').count());if(opened)await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await expect(page.locator('.worker-status-button')).toContainText(/1 (preparing|ready|busy|need attention)/);if(opened)await page.getByRole('button',{name:'Close sidebar',exact:true}).click();}
async function chatProposal(page:Page) {await page.goto('/chat');const composer=page.getByRole('combobox',{name:'Chat message'});await composer.fill('/text-to-image A watercolor mountain lake');await composer.press('Enter');await expect(page.getByRole('button',{name:'Approve',exact:true})).toBeEnabled({timeout:15000});}

for(const device of ['desktop','mobile'] as const)for(const [id,surface,title] of catalog) {
  test(`${id} ${device} · ${title}`,async({page,request},testInfo)=>{
    const width=device==='desktop'?1440:390,height=device==='desktop'?1000:844;
    await page.setViewportSize({width,height});await mkdir(path.join(root,device),{recursive:true});
    await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)||url.protocol==='data:'?route.continue():route.abort('blockedbyclient');});
    let completed=false;
    try {
      await page.goto('/');await expect(page.getByLabel('Prompt',{exact:true})).toBeVisible();
      if(Number(id)>=42){
        const stages:Record<string,string>={'042':'acquiring','043':'download_start','045':'download_stalled','046':'verifying','047':'engine_start','051':'base_failure','052':'lora_failure','053':'acquiring','055':'legacy_progress'};
        await scenario(request,stages[id]??'preparing');
        const workerId=await launch(request,id==='052'?'image':'video');
        await waitState(request,['042','053'].includes(id)?'starting':['051','052'].includes(id)?'needs_attention':'preparing');
        await openWorkers(page);
        await expect(page.locator('.worker-preparation')).toBeVisible();
        if(['044','048'].includes(id)){await expect(page.locator('.worker-transfer-stats')).toContainText('/s');await expect(page.locator('.worker-setup-hint')).toContainText('downloads left');}
        if(id==='044'){
          const snapshot=await(await request.get('/api/v1/pool')).json(),files=snapshot.workers.find((worker:any)=>worker.id===workerId).preparation.files;
          expect(files.filter((file:any)=>file.state==='downloading'&&!file.optional)).toHaveLength(1);
          expect(files.filter((file:any)=>file.state==='downloading'&&file.optional).length).toBeLessThanOrEqual(1);
          await expect(page.locator('.worker-transfer-freshness')).toContainText('Last transfer update');
        }
        if(id==='043')await expect(page.locator('.worker-setup-hint')).toContainText('Measuring download speed');
        if(id==='045'){await expect(page.locator('.worker-setup-hint')).toContainText('Waiting for transfer updates');await expect(page.locator('.worker-transfer-stats')).toContainText('Rate unavailable');await expect(page.locator('.worker-transfer-freshness')).toContainText('Last transfer update');}
        if(id==='046')await expect(page.locator('.worker-setup-heading')).toContainText('Checking model files');
        if(id==='047'){
          await expect(page.locator('.worker-setup-heading')).toContainText('Starting generation engine');await expect(page.getByRole('progressbar')).toHaveCount(0);
          const snapshot=await(await request.get('/api/v1/pool')).json();
          expect(snapshot.workers.find((worker:any)=>worker.id===workerId).preparation.files.every((file:any)=>file.ready||file.omitted)).toBe(true);
        }
        if(id==='048')await page.locator('.worker-download-files summary').click();
        if(id==='049'){await scenario(request,'normal');await waitState(request,'ready');await expect(page.getByText('Video worker ready',{exact:true})).toBeVisible();}
        if(id==='051'){await page.getByRole('button',{name:'Retry preparation',exact:true}).click();await waitState(request,'ready');await expect(page.locator('.pool-worker .worker-state')).toHaveText('Ready');}
        if(id==='052'){await page.getByRole('button',{name:/Continue without/}).click();await waitState(request,'ready');await expect(page.locator('.pool-worker .worker-state')).toHaveText('Ready');}
        if(id==='053'){await page.getByRole('button',{name:'Cancel jobs and quit now',exact:true}).click();await page.getByRole('dialog',{name:'Quit this worker now?',exact:true}).getByRole('button',{name:'Quit now',exact:true}).click();await waitState(request,'released');await expect(page.locator('.pool-released')).toBeVisible();await page.locator('.pool-released summary').click();}
        if(id==='054'){await page.getByRole('button',{name:'Close GPU workers'}).click();if(!await page.locator('.worker-status-button').isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await expect(page.locator('.worker-status-button')).toContainText('1 preparing');await expect(page.locator('.worker-status-button')).not.toContainText('1 running');}
        if(id==='055'){await expect(page.locator('.worker-transfer-stats')).toContainText('Rate unavailable');await expect(page.locator('.worker-setup-hint')).not.toContainText('downloads left');await expect(page.locator('.worker-transfer-freshness')).toHaveCount(0);}
        if(['050','056'].includes(id)){
          const response=await request.post('/api/v1/jobs',{headers:{'Idempotency-Key':'atlas-queued-'+id},data:{workflow:'text-to-video',prompt:'A sailboat crosses a calm lake.',mode:'sfw',output:{aspect:'16:9',size:'768p',duration_seconds:5},audio:{output:'generated'},seed:'42',count:1,loras:[]}});expect(response.ok(),await response.text()).toBeTruthy();
          if(id==='050'){await scenario(request,'generating');await expect(page.getByText('Video worker ready',{exact:true})).toBeVisible();await waitState(request,'generating');await expect(page.locator('.pool-worker .worker-state')).toHaveText('Generating');}
          else {await request.post('/api/v1/pool/workers/'+workerId+'/actions',{data:{action:'finish'}});await expect(page.locator('.pool-worker .worker-state')).toHaveText('Finishing');await expect(page.getByRole('button',{name:'Cancel jobs and quit now',exact:true})).toBeEnabled();}
        }
        if(id==='057'){await scenario(request,'normal');await waitState(request,'ready');await scenario(request,'acquiring');await launch(request,'image','vast');await expect(page.locator('.pool-worker')).toHaveCount(2);await expect(page.locator('.pool-worker .worker-state').filter({hasText:'Ready'})).toHaveCount(1);await expect(page.locator('.pool-worker .worker-state').filter({hasText:'Starting'})).toHaveCount(1);}
      }
      if(['002','005','006'].includes(id))await page.getByLabel('Prompt',{exact:true}).fill('A quiet mountain lake at sunrise, soft natural light and gentle reflections.');
      if(id==='002'){await page.getByLabel('Quantity',{exact:true}).selectOption('4');await expect(page.getByRole('button',{name:/^Create 4 images/})).toBeEnabled();}
      if(id==='003'){await workflow(page,'Text to video');await page.getByLabel('Prompt',{exact:true}).fill('A sailboat glides across the lake. Gentle wind and water fill the soundtrack.');}
      if(id==='004')await workflow(page,'Reference to video');
      if(id==='005'){await page.getByLabel('Seed mode').selectOption('fixed');await page.getByLabel('Starting seed').fill('42');}
      if(id==='006')await page.getByRole('checkbox',{name:/Watercolor study/}).first().check();
      if(['007','008','009','010','040'].includes(id)){
        await page.goto('/admin'+(id==='007'?'':'?section=loras'));
        await expect(page.getByRole('heading',{name:id==='007'?'Credentials':'Your LoRAs',exact:true})).toBeVisible();
        if(id==='007')await expect(page.getByLabel('Vast API key',{exact:true})).toBeVisible();
        if(id==='008')await expect(page.locator('.admin-lora-card').first()).toBeVisible();
        if(['009','010','040'].includes(id)){await page.getByRole('button',{name:'+ Add LoRA',exact:true}).click();await page.getByLabel('Civitai URL').fill(id==='010'?'https://civitai.com/models/7?modelVersionId=13':'https://civitai.com/models/6?modelVersionId=11');await page.getByRole('button',{name:'Look up',exact:true}).click();await expect(page.getByRole('region',{name:'Import LoRA'})).toContainText(id==='010'?'not supported':'MiniMax H3');if(id==='040'){await page.getByLabel('Workflow mapping for tone-a.safetensors').selectOption('fl');await page.getByLabel('Workflow mapping for tone-b.safetensors').selectOption('ref');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByText('LoRA request submitted · Track it in Activity').first()).toBeVisible();}}
      }
      if(id==='011'){await page.goto('/chat');await expect(page.getByRole('combobox',{name:'Chat message'})).toBeVisible();}
      if(['012','013','035'].includes(id)){await chatProposal(page);if(id==='013')await page.getByRole('button',{name:'Edit request',exact:true}).first().click();if(id==='035'){await page.getByRole('button',{name:'Approve',exact:true}).click();await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close GPU workers'}).click();}}
      if(id==='014'){await page.goto('/library');await expect(page.locator('.library-grid,.library-empty')).toBeVisible();}
      if(['015','016','017','018','019','020','021','036'].includes(id)){
        if(id==='020')await scenario(request,'provider_error');if(id==='021')for(const field of ['vastApiKey','runpodApiKey'])await request.patch('/api/v1/admin/credentials/'+field,{data:{value:null}});
        await openWorkers(page,id==='015'?'workers':'add');
        if(id==='017')await page.getByRole('button',{name:/Video worker H3/}).click();
        if(id==='020')await page.getByRole('button',{name:'RunPod',exact:true}).click();
        if(['016','017','018','019','020','036'].includes(id))await expect(page.locator('.pool-offer').first()).toBeVisible();
        if(id==='018'){await page.locator('.pool-offer input[type=checkbox]').first().check();await page.getByRole('button',{name:'RunPod',exact:true}).click();await page.locator('.pool-offer input[type=checkbox]').first().check();await page.getByLabel(/Quantity for .*RunPod/).selectOption('3');}
        if(id==='019')await page.getByLabel('Maximum hourly rate').fill('0.1');
        if(id==='036'){await page.locator('.pool-offer input[type=checkbox]').first().check();await request.patch('/api/v1/admin/credentials/runpodApiKey',{data:{value:null}});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'RunPod',exact:true}).click();await page.getByRole('button',{name:'Open Credentials',exact:true}).click();await expect(page.getByText('Your worker selection is saved.')).toBeVisible();}
      }
      if(['022','023','024','025','026','027','028','029','037','038','039','041'].includes(id)){
        if(id==='022')await scenario(request,'preparing');if(id==='025')await scenario(request,'lora_failure');if(id==='041')await scenario(request,'base_failure');
        const workerId=await launch(request);
        if(id==='022')await waitState(request,'preparing');else if(['025','041'].includes(id))await waitState(request,'needs_attention');else await waitState(request,'ready');
        await waitForWorkerBadge(page);
        if(['024','029','037'].includes(id)){await scenario(request,'generating');await page.getByLabel('Prompt',{exact:true}).fill('A quiet lake');await page.getByRole('button',{name:/^Create image/}).click();await waitState(request,'generating');}
        if(id==='026'){await scenario(request,'disconnected');await waitState(request,'needs_attention');}
        if(id==='027'){await scenario(request,'release_failure');await request.post('/api/v1/pool/workers/'+workerId+'/actions',{data:{action:'quit'}});await waitState(request,'releasing');}
        if(id==='028'){await request.post('/api/v1/pool/workers/'+workerId+'/actions',{data:{action:'quit'}});await expect.poll(async()=>(await(await request.get('/api/v1/pool')).json()).summary.active).toBe(0);}
        if(id==='037')await request.post('/api/v1/pool/workers/'+workerId+'/actions',{data:{action:'finish'}});
        if(id==='038'){await launch(request,'video','vast');await waitState(request,'ready');}
        if(id==='039')await scenario(request,'normal',7200);
        if(id==='029'){if(!await page.getByRole('button',{name:/^Activity/}).isVisible())await page.getByRole('button',{name:'Toggle sidebar'}).click();await page.getByRole('button',{name:/^Activity/}).click();await expect(page.locator('.worker-activity').first()).toBeVisible();}else {await openWorkers(page);if(id==='028'){await expect(page.locator('.pool-released')).toBeVisible();await page.locator('.pool-released summary').click();}else await expect(page.locator('.pool-worker').first()).toBeVisible();}
      }
      if(['030','031','032','033','034'].includes(id)){
        if(['032','033','034'].includes(id)){await launch(request);await waitState(request,'ready');await waitForWorkerBadge(page);}
        if(id==='031')await workflow(page,'Text to video');
        await page.getByLabel('Prompt',{exact:true}).fill('A quiet mountain lake at sunrise');await page.getByRole('button',{name:/^Create (image|video)/}).click();
        if(['030','031'].includes(id)){await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close GPU workers'}).click();}
        else {await expect(page.locator('.generation-thumbnails button').first()).toBeVisible({timeout:20000});if(id==='033')await page.goto('/library');if(id==='034')await page.locator('.generation-thumbnails button').first().click();}
      }
      if(id==='024')await expect(page.locator('.pool-worker .worker-state')).toHaveText('Generating');
      if(id==='025'||id==='026')await expect(page.locator('.pool-worker .worker-state')).toHaveText('Needs attention');
      if(id==='027'){await expect(page.locator('.pool-worker .worker-state')).toHaveText('Releasing');await expect(page.locator('.pool-worker')).toContainText('not confirmed');}
      if(id==='028')await expect(page.locator('.pool-worker')).toHaveCount(0);
      if(id==='029')await expect(page.locator('.worker-activity').first()).toContainText('Generating');
      if(id==='033'){await expect(page.locator('.library-grid img').first()).toBeVisible();await expect.poll(()=>page.locator('.library-grid img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);}
      if(id==='037')await expect(page.locator('.pool-worker .worker-state')).toHaveText('Finishing');
      if(id==='038')await expect(page.locator('.pool-worker')).toHaveCount(2);
      if(id==='039')await expect(page.locator('.pool-summary')).toContainText('$2.48');
      if(id==='041')await expect(page.getByRole('button',{name:'Download through this PC',exact:true})).toBeVisible();
      if(['025','041'].includes(id))await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toHaveCount(0);
      if(['027','037'].includes(id)){await expect(page.getByRole('button',{name:'Finish jobs and quit',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Cancel jobs and quit now',exact:true})).toBeEnabled();}
      if(['030','031'].includes(id))await expect(page.locator('.generate-feedback')).toContainText('queued · waiting for a worker');
      if(id==='014')await expect(page.locator('.library-empty')).toBeVisible();
      if(id==='033')await expect(page.locator('.library-grid img')).toHaveCount(1);
      if(id==='021')await expect(page.getByRole('heading',{name:'Availability needs attention'})).toBeVisible();
      if(id==='035')await expect.poll(async()=>(await(await request.get('/api/v1/jobs')).json()).items.some((job:any)=>job.state==='queued')).toBe(true);
      if(['029','034'].includes(id))await expect(page.locator('.mode-toast.is-visible')).toHaveCount(0,{timeout:10000});
      await expect(page.locator('body')).not.toContainText('Cost Estimate:');
      await expect(page.locator('.initial-loading')).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      completed=true;
    } finally {
      const filename=id+'-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'')+'.png';
      const screenshot=path.join(root,device,filename);
      const record:{id:string;title:string;surface:string;device:string;viewport:{width:number;height:number};status:string;file:string|null;test:string;captures:{position:string;file:string}[];capture_error?:string}={id,title,surface,device,viewport:{width,height},status:completed?'passed':'failed',file:device+'/'+filename,test:testInfo.title,captures:[]};
      try{
        await page.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;await Promise.all([...document.images].filter(img=>!img.closest('[hidden]')).map(img=>img.decode().catch(()=>{})));});
        const scroller=page.locator('.pool-content,.review-body,.shared-jobs').filter({visible:true}).first();
        if(await scroller.count())await scroller.evaluate(element=>element.scrollTop=0);
        await page.screenshot({path:screenshot,fullPage:!(await page.getByRole('dialog').count()),animations:'disabled'});
        if(completed&&await scroller.count()){
          const size=await scroller.evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));
          if(size.total>size.height+1){
            // Full-resolution viewport captures at overlapping scroll stops.
            const positions:number[]=[];
            for(let top=Math.floor(size.height*.7);top<size.total-size.height;top+=Math.floor(size.height*.7))positions.push(top);
            positions.push(size.total-size.height);
            for(const [index,top] of positions.entries()){
              await scroller.evaluate((el,top)=>el.scrollTop=top,top);
              const file=device+'/'+filename.replace('.png',`-scroll-${index+1}.png`);
              await page.screenshot({path:path.join(root,file),animations:'disabled'});
              record.captures.push({position:`Scroll ${index+1}`,file});
            }
          }
        }
      }catch(error){record.file=null;record.status='failed';record.capture_error=(error as Error).message;}
      await writeFile(path.join(root,device,id+'.json'),JSON.stringify(record,null,2));
      if(record.file)await testInfo.attach(id+' '+device,{path:screenshot,contentType:'image/png'});
    }
  });
}
