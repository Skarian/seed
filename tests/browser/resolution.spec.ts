import { test, expect, type Page } from './fixtures.js';
import type { GeneratePreferences } from '../../shared/resolution.js';
import {cardFixture} from './request-card-fixture.js';

async function setup(page: Page, options: {source?: boolean; failSave?: boolean; delayLoad?: boolean} = {}) {
  let preferences: GeneratePreferences = {image:'image-768',video:'768p'};
  let failSave = options.failSave ?? false;
  const writes: unknown[] = [];
  let release: () => void = () => {};
  const gate = options.delayLoad ? new Promise<void>(resolve => {release = resolve;}) : Promise.resolve();
  await page.route('**/api/v1/generate-preferences', async route => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON(); writes.push(patch);
      if (failSave) return route.fulfill({status:500,json:{error:{message:'Disk full'}}});
      preferences = {...preferences,...patch};
    } else await gate;
    return route.fulfill({json:{preferences,candidates:false}});
  });
  await page.route('**/api/v1/loras*', route => route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/jobs', route => route.fulfill({json:{items:[]}}));
  if (options.source) await page.addInitScript(() => {
    localStorage.setItem('seed.inputs.image-to-image.sfw',JSON.stringify([{id:'source-ref',asset_id:'source',kind:'image',role:'source',name:'Small source',type:'image/png',width:512,height:512,start:0,end:0}]));
  });
  await page.goto('/');
  if (!options.delayLoad) await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('image-768');
  return {writes, remote: (value: Partial<GeneratePreferences>) => {preferences={...preferences,...value};}, saveSucceeds: () => {failSave=false;}, release};
}

test('dimensions flip, image/video memory is separate, and a small source does not rewrite it', async ({page}) => {
  const state = await setup(page,{source:true});
  const resolution = page.getByLabel('Resolution',{exact:true});
  await resolution.selectOption('2mp');
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.getByLabel('Orientation',{exact:true}).click();
  await page.getByRole('button',{name:/Portrait/}).click();
  await expect(resolution.locator('option:checked')).toHaveText('1080 × 1920');
  await page.getByRole('button',{name:'Image to image',exact:true}).click();
  await expect(resolution).toHaveValue('2mp');
  await expect(resolution).toBeDisabled();
  await expect(resolution.locator('option')).toHaveText(['512 × 512']);
  expect(state.writes).toEqual([{image:'2mp'}]);
  await page.getByRole('button',{name:'Text to video',exact:true}).click();
  await expect(resolution).toHaveValue('768p');
  await resolution.selectOption('480p');
  await page.getByLabel('Orientation',{exact:true}).click();
  await page.getByRole('button',{name:'Portrait',exact:true}).click();
  await expect(resolution.locator('option:checked')).toHaveText('480 × 864');
  await page.getByRole('button',{name:'Reference to video',exact:true}).click();
  await expect(resolution).toHaveValue('480p');
  await page.getByRole('button',{name:'Text to image',exact:true}).click();
  await expect(resolution).toHaveValue('2mp');
  expect(state.writes).toEqual([{image:'2mp'},{video:'480p'}]);
  await page.reload();
  await expect(resolution).toHaveValue('2mp');
});

test('normal menus show all approved canvases and swap every size exactly', async ({page}) => {
  await setup(page);
  const resolution=page.getByLabel('Resolution',{exact:true});
  const imageLabels=['864 × 480','1344 × 768','1920 × 1080','2560 × 1440'];
  await expect(resolution.locator('option')).toHaveText(imageLabels);
  for(const [id,label] of [['image-480','480 × 864'],['image-768','768 × 1344'],['2mp','1080 × 1920'],['image-1440','1440 × 2560']]) {
    await resolution.selectOption(id!);
    await page.getByLabel('Orientation',{exact:true}).click();
    await page.getByRole('button',{name:'Portrait',exact:true}).click();
    await expect(resolution.locator('option:checked')).toHaveText(label!);
  }
  await page.getByRole('button',{name:'Text to video',exact:true}).click();
  await expect(resolution.locator('option')).toHaveText(['864 × 480','1344 × 768']);
});

test('a saved legacy image remains visible only while selected', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('seed.drafts.v3',JSON.stringify({'text-to-image':{sourceJob:'historic-job',request:{workflow:'text-to-image',mode:'sfw',prompt:'Keep the old canvas',seed:'42',count:1,output:{aspect:'16:9',size:'1mp'}}}})));
  await setup(page,{delayLoad:true});
  const resolution=page.getByLabel('Resolution',{exact:true});
  await expect(resolution).toHaveValue('1mp');
  await expect(resolution.locator('option:checked')).toHaveText('1280 × 720');
  await resolution.selectOption('image-1440');
  await expect(resolution.locator('option')).toHaveText(['864 × 480','1344 × 768','1920 × 1080','2560 × 1440']);
});

test('failed remembering leaves the active selection and offers retry', async ({page}) => {
  const state=await setup(page,{failSave:true});
  await page.getByLabel('Resolution',{exact:true}).selectOption('image-480');
  await expect(page.getByText(/Selection not remembered/)).toBeVisible();
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('image-480');
  state.saveSucceeds();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  expect(state.writes).toEqual([{image:'image-480'},{image:'image-480'}]);
});

test('late preference loading cannot replace an explicit choice', async ({page}) => {
  const state=await setup(page,{delayLoad:true});
  await page.getByLabel('Prompt',{exact:true}).fill('Already editing');
  await page.getByLabel('Resolution',{exact:true}).selectOption('image-768');
  state.remote({image:'2mp'});
  state.release();
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('image-768');
  await expect(page.getByRole('button',{name:/^Create image/})).toBeEnabled();
});

test('navigation and remote changes do not mutate an unresolved retry', async ({page}) => {
  const state=await setup(page);
  const sent: {body: unknown; key: string}[]=[];
  await page.route('**/api/v1/jobs', route => {
    if(route.request().method()!=='POST')return route.fulfill({json:{items:[]}});
    sent.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']!});
    return sent.length===1?route.abort('failed'):route.fulfill({status:202,json:{jobs:[]}});
  });
  await page.getByLabel('Resolution',{exact:true}).selectOption('2mp');
  await page.getByLabel('Prompt',{exact:true}).fill('A mountain');
  await page.getByRole('button',{name:/^Create image/}).click();
  await expect(page.getByText(/Retrying will check the same submission/)).toBeVisible();
  state.remote({image:'image-480'});
  await page.getByRole('button',{name:'Text to video',exact:true}).click();
  await page.getByRole('button',{name:'Text to image',exact:true}).click();
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('2mp');
  await page.getByRole('button',{name:/^Create image/}).click();
  await expect.poll(()=>sent.length).toBe(2);
  expect(sent[1]).toEqual(sent[0]);
});

test('a pending retry restores its original request after editing in another content mode', async ({page}) => {
  await setup(page);
  const sent: {body: unknown; key: string}[]=[];
  await page.route('**/api/v1/jobs',route=>{
    if(route.request().method()!=='POST')return route.fulfill({json:{items:[]}});
    sent.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']!});
    return sent.length===1?route.abort('failed'):route.fulfill({status:202,json:{jobs:[]}});
  });
  await page.getByLabel('Resolution',{exact:true}).selectOption('2mp');
  await page.getByLabel('Prompt',{exact:true}).fill('Original standard request');
  await page.getByRole('button',{name:/^Create image/}).click();
  await expect(page.getByText(/Retrying will check the same submission/)).toBeVisible();
  await page.getByRole('button',{name:'Seed',exact:true}).click({delay:900});
  await expect(page.getByRole('button',{name:'Return to Seed',exact:true})).toBeVisible();
  await page.getByLabel('Resolution',{exact:true}).selectOption('image-480');
  await page.getByLabel('Prompt',{exact:true}).fill('Unrelated other-mode draft');
  await page.getByRole('button',{name:'Return to Seed',exact:true}).click();
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('2mp');
  await expect(page.getByLabel('Prompt',{exact:true})).toHaveText('Original standard request');
  await page.getByRole('button',{name:/^Create image/}).click();
  await expect.poll(()=>sent.length).toBe(2);
  expect(sent[1]).toEqual(sent[0]);
});

test('saving one family incorporates another device’s change to the other family', async ({page}) => {
  const state=await setup(page);
  state.remote({video:'480p'});
  await page.getByLabel('Resolution',{exact:true}).selectOption('2mp');
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.getByRole('button',{name:'Text to video',exact:true}).click();
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('480p');
});

test('editing or resetting after a failed submission does not restore the old draft on re-entry', async ({page}) => {
  await setup(page);
  await page.route('**/api/v1/jobs',route=>route.request().method()==='POST'?route.abort('failed'):route.fulfill({json:{items:[]}}));
  await page.getByLabel('Resolution',{exact:true}).selectOption('2mp');
  await page.getByLabel('Prompt',{exact:true}).fill('Original mountain');
  await page.getByRole('button',{name:/^Create image/}).click();
  await expect(page.getByText(/Retrying will check the same submission/)).toBeVisible();
  await page.getByLabel('Prompt',{exact:true}).fill('Deliberately edited city');
  await page.getByLabel('Resolution',{exact:true}).selectOption('image-768');
  await page.getByRole('button',{name:'Text to video',exact:true}).click();
  await page.getByRole('button',{name:'Text to image',exact:true}).click();
  await expect(page.getByLabel('Prompt',{exact:true})).toHaveText('Deliberately edited city');
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('image-768');
  await page.getByRole('button',{name:'Reset form',exact:true}).click();
  await page.getByRole('button',{name:'Text to video',exact:true}).click();
  await page.getByRole('button',{name:'Text to image',exact:true}).click();
  await expect(page.getByLabel('Prompt',{exact:true})).toBeEmpty();
});

test('a retained historical size is not replaced by Generate memory', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('seed.drafts.v3',JSON.stringify({'text-to-image':{sourceJob:'historic-job',request:{workflow:'text-to-image',mode:'sfw',prompt:'Historical image',seed:'42',count:1,output:{aspect:'9:16',size:'2mp'}}}})));
  await setup(page,{delayLoad:true});
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('2mp');
  await expect(page.getByLabel('Prompt',{exact:true})).toHaveText('Historical image');
});

test('rapid saves settle on the last selection, while reset changes no preferences', async ({page}) => {
  const state=await setup(page);
  const resolution=page.getByLabel('Resolution',{exact:true});
  await resolution.selectOption('image-480');
  await resolution.selectOption('2mp');
  await resolution.selectOption('image-768');
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await expect.poll(()=>state.writes.length).toBe(3);
  await expect(resolution).toHaveValue('image-768');
  await page.getByRole('button',{name:'Reset form',exact:true}).click();
  await expect(resolution).toHaveValue('image-768');
  expect(state.writes).toEqual([{image:'image-480'},{image:'2mp'},{image:'image-768'}]);
});

test('a delayed old read cannot undo a successful save for the next reset', async ({page}) => {
  await setup(page);
  let release!:()=>void, entered!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}), started=new Promise<void>(resolve=>{entered=resolve;});
  let pair={image:'image-768',video:'768p'};
  await page.route('**/api/v1/generate-preferences',async route=>{
    if(route.request().method()==='PATCH')pair={...pair,...route.request().postDataJSON()};
    const snapshot={...pair};
    if(route.request().method()==='GET'){entered();await held;}
    await route.fulfill({json:{preferences:snapshot,candidates:false}});
  });
  await page.getByRole('button',{name:'Admin',exact:true}).click();
  await page.goBack();await started;
  await page.getByLabel('Resolution',{exact:true}).selectOption('2mp');
  await expect(page.getByText(/Saved\./)).toBeVisible();
  const read=page.waitForResponse(r=>r.url().endsWith('/generate-preferences')&&r.request().method()==='GET');
  release();await read;
  await page.getByRole('button',{name:'Reset form',exact:true}).click();
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('2mp');
});

test('missing source and unsupported saved size remain explicit', async ({page}) => {
  await setup(page);
  await page.getByRole('button',{name:'Image to image',exact:true}).click();
  await expect(page.getByLabel('Resolution',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('Resolution',{exact:true})).toContainText('Choose a source image first.');
  await expect(page.getByRole('button',{name:/^Create image/})).toBeDisabled();
  await page.evaluate(()=>localStorage.setItem('seed.drafts.v3',JSON.stringify({'text-to-image':{request:{output:{aspect:'16:9',size:'future'},prompt:'Keep me'}}})));
  await page.goto('/');
  await page.getByRole('button',{name:'Text to image',exact:true}).click();
  await expect(page.getByLabel('Resolution',{exact:true})).toHaveValue('future');
  await expect(page.getByRole('button',{name:/^Create image/})).toBeDisabled();
  await page.getByLabel('Resolution',{exact:true}).selectOption('image-768');
  await expect(page.getByRole('button',{name:/^Create image/})).toBeEnabled();
});

for(const workflow of ['text-to-image','text-to-video','reference-to-video','image-to-image'] as const) {
  test(`Chat ${workflow} uses request size and never remembers manual edits`, async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    const fixture=await cardFixture(page,workflow,'none');
    const preferenceWrites:unknown[]=[];
    await page.route('**/api/v1/generate-preferences',route=>{
      if(route.request().method()==='PATCH')preferenceWrites.push(route.request().postDataJSON());
      return route.fulfill({json:{preferences:{image:'2mp',video:'480p'},candidates:false}});
    });
    await fixture.open();
    await page.getByRole('button',{name:'Edit request',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Review generation',exact:true});
    const resolution=dialog.getByLabel('Resolution',{exact:true});
    await expect(resolution).toHaveValue(workflow.includes('video')?'768p':'image-768');
    if(workflow==='image-to-image') {
      await expect(resolution.locator('option:checked')).toHaveText('640 × 480');
      await expect(resolution).toBeDisabled();
    } else {
      await resolution.selectOption(workflow.includes('video')?'480p':'2mp');
      await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
      await expect.poll(()=>fixture.writes.filter(w=>w.path.endsWith('/revise')).length).toBe(1);
      expect(fixture.writes.find(w=>w.path.endsWith('/revise'))!.body.request.output.size).toBe(workflow.includes('video')?'480p':'2mp');
    }
    expect(preferenceWrites).toEqual([]);
    expect(fixture.errors).toEqual([]);
    await resolution.scrollIntoViewIfNeeded();
    await page.screenshot({path:'.local/resolution-qa/chat-'+workflow+'.png'});
  });
}

for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:720}]) {
  test(`dimension control fits ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await page.getByLabel('Resolution',{exact:true}).selectOption('2mp');
    await expect(page.getByLabel('Resolution',{exact:true}).locator('option:checked')).toHaveText('1920 × 1080');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'.local/resolution-qa/resolution-'+viewport.width+'.png',fullPage:true});
  });
}
