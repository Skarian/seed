import { test, expect, type Page } from './fixtures.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cardFixture, type Workflow, type Profile, type CardState } from './request-card-fixture.js';

const catalog = [
  ['201','Approval','Image without LoRAs'],['202','Approval','Image editing with two inputs'],['203','Approval','Video with first frame'],['204','Approval','Reference video with three inputs'],
  ['205','Approval','Image short LoRA'],['206','Approval','Image long title and version'],['207','Approval','Image unbroken title'],['208','Approval','Image multilingual title'],['209','Approval','Image three mixed LoRAs'],['210','Approval','Image missing catalog entry'],
  ['211','Approval','Video short LoRA'],['212','Approval','Video long title and version'],['213','Approval','Video unbroken title'],['214','Approval','Video multilingual title'],['215','Approval','Video three mixed LoRAs'],['216','Approval','Video missing catalog entry'],
  ['217','Approval','Reference short LoRA'],['218','Approval','Reference long title and version'],['219','Approval','Reference unbroken title'],['220','Approval','Reference multilingual title'],['221','Approval','Reference three mixed LoRAs'],['222','Approval','Reference missing catalog entry'],
  ['223','Lifecycle','Approved waiting for another proposal'],['224','Lifecycle','Denied'],['225','Lifecycle','Queued'],['226','Lifecycle','Running'],['227','Lifecycle','Failed'],['228','Lifecycle','Completed'],['229','Lifecycle','Revising'],['230','Lifecycle','Stopped'],['231','Lifecycle','Revision history'],
  ['232','Draft','Branch draft with three LoRAs'],['233','Draft','Feedback draft with long LoRA'],['234','Review','Request editor with long LoRAs'],['235','Inputs','Image editing with ten inputs'],['236','Inputs','Video without first frame'],
  ['237','Approval recovery','Preparing inputs'],['238','Approval recovery','Preparation failed with retry'],['239','Approval recovery','Interrupted preparation'],['240','Approval recovery','Older unfinished approval'],['241','Approval recovery','Stopped after approval'],['242','Approval recovery','Two pending siblings in long conversation'],['243','Approval recovery','Retry in existing review dialog'],
  ['244','Transition','Image without LoRAs'],['245','Transition','Image short LoRA'],['246','Transition','Image medium title and version'],['247','Transition','Image long title and version'],['248','Transition','Image unbroken title'],['249','Transition','Image three LoRAs'],
  ['250','Transition','Image editing with two inputs'],
  ['251','Transition','Video without LoRAs'],['252','Transition','Video short LoRA'],['253','Transition','Video medium title and version'],['254','Transition','Video long title and version'],['255','Transition','Video unbroken title'],['256','Transition','Video three LoRAs'],
  ['257','Transition','Reference video without LoRAs'],['258','Transition','Reference video short LoRA'],['259','Transition','Reference video medium title and version'],['260','Transition','Reference video long title and version'],['261','Transition','Reference video unbroken title'],['262','Transition','Reference video three LoRAs'],
] as const;
const root = path.resolve(process.env.SEED_CARDS_ROOT ?? '.local/request-card-atlas');

function parameters(id: string): [Workflow, Profile, CardState] {
  const n = Number(id);
  if (n >= 244) {
    if (n === 250) return ['image-to-image', 'none', 'reviewing'];
    const start = n < 250 ? 244 : n < 257 ? 251 : 257;
    return [n < 250 ? 'text-to-image' : n < 257 ? 'text-to-video' : 'reference-to-video', (['none','short','medium','long','unbroken','multiple'] as const)[n-start]!, 'reviewing'];
  }
  if (n <= 204) return [(['text-to-image','image-to-image','text-to-video','reference-to-video'] as const)[n - 201]!, 'none', 'reviewing'];
  if (n <= 222) return [(['text-to-image','text-to-video','reference-to-video'] as const)[Math.floor((n - 205) / 6)]!, (['short','long','unbroken','multilingual','multiple','missing'] as const)[(n - 205) % 6]!, 'reviewing'];
  if (n <= 231) return ['reference-to-video', 'multiple', (['approved','denied','queued','running','failed','completed','revising','stopped','history'] as const)[n - 223]!];
  if(n>=237)return ['reference-to-video','multiple',(['preparing','start-failed','interrupted','legacy','stopped-approved','waiting-many','review-retry'] as const)[n-237]!];
  return n === 232 ? ['text-to-image','multiple','branch'] : n === 233 ? ['text-to-video','long','feedback'] : n === 234 ? ['reference-to-video','multiple','review'] : n === 235 ? ['image-to-image','none','reviewing'] : ['text-to-video','none','reviewing'];
}

async function assertLayout(page: Page, width: number) {
  const issues = await page.evaluate(() => {
    const issues: string[] = [];
    const visible = (e: Element) => !!e.getClientRects().length;
    for (const card of document.querySelectorAll('.job-request-card, .review-request')) {
      if (!visible(card)) continue;
      const box = card.getBoundingClientRect();
      if (box.right > innerWidth + 1 || box.left < -1) issues.push('Card outside viewport');
      if (card.matches('.job-request-card') && box.width > 641) issues.push('Card exceeds compact desktop width');
      for (const e of card.querySelectorAll('.request-card-body,.request-card-summary,.job-title,.selected-loras,.selected-loras>span,.job-controls,.lora-name,.lora-name>span,.lora-option')) {
        if (visible(e) && e.scrollWidth > e.clientWidth + 1) issues.push('Overflow: ' + e.className);
      }
      const chips = [...card.querySelectorAll('.selected-loras>span')];
      for (const chip of chips) {
        const b = chip.getBoundingClientRect();
        if (b.right > box.right + 1 || b.left < box.left - 1) issues.push('LoRA outside card');
      }
      const buttons = [...card.querySelectorAll('button')].filter(visible);
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        if (r.right > box.right + 1 || r.left < box.left - 1) issues.push('Button outside card: ' + b.getAttribute('aria-label'));
        if (innerWidth <= 600 && b.matches('.request-card-body > .job-controls > button, .request-start-footer button') && r.height < 44) issues.push('Card action below mobile touch size: ' + b.textContent);
        if (!card.matches('.review-request') && (r.bottom > box.bottom + 1 || r.top < box.top - 1)) issues.push('Button outside card vertically');
      }
      const title = card.querySelector('.request-card-title')?.getBoundingClientRect();
      const edit = card.querySelector('.request-card-title-row .icon-only')?.getBoundingClientRect();
      if (title && edit && (edit.top>title.bottom || edit.bottom<title.top)) issues.push('Edit button is not aligned with title');
      const summary = card.querySelector('.request-card-summary')?.getBoundingClientRect();
      const controls = card.querySelector('.request-card-body>.job-controls')?.getBoundingClientRect();
      if (summary && controls && Math.min(summary.right,controls.right)-Math.max(summary.left,controls.left)>1 && Math.min(summary.bottom,controls.bottom)-Math.max(summary.top,controls.top)>1) issues.push('Summary overlaps actions');
      const active = [...card.querySelectorAll('.request-card-body > .job-controls > button')].some(b=>b.textContent?.trim()==='Cancel');
      if (active && summary && controls) {
        if (!edit) issues.push('Active request lost its heading Edit control');
        if (controls.top >= summary.bottom || controls.bottom <= summary.top) issues.push('Active actions detached below the heading');
        const body = card.querySelector('.request-card-body')!, bounds = body.getBoundingClientRect(), css = getComputedStyle(body);
        const badges = body.querySelector(':scope > .selected-loras')?.getBoundingClientRect();
        const contentHeight = Math.max(summary.height,controls.height) + (badges ? badges.height + 8 : 0);
        if (bounds.height > contentHeight + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + 3) issues.push('Unnecessary empty vertical space in active card');
      }
    }
    if (document.documentElement.scrollWidth > innerWidth) issues.push('Page scrolls horizontally');
    return issues;
  });
  expect(issues, `layout at ${width}px`).toEqual([]);
  for (const card of await page.locator('.approval-card').all()) {
    await expect(card).not.toContainText('Keep the subject, change the lighting.');
    if (width <= 600) for (const name of ['Deny','Approve']) {
      const box = await card.getByRole('button',{name,exact:true}).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
}

for (const device of ['desktop','mobile'] as const) test.describe(device, () => {
  test.use({isMobile:device==='mobile',hasTouch:device==='mobile'});
  for (const [id,surface,title] of catalog) {
  test(`${id} ${device} · ${title}`, async ({page}, testInfo) => {
    const [workflow,profile,state] = parameters(id);
    const widths = device === 'mobile' ? [320,360,390,600] : [601,650,651,768,1024,1440];
    const height = device === 'mobile' ? 844 : 1000;
    await page.setViewportSize({width: device === 'mobile' ? 390 : 1440,height});
    const fixture = await cardFixture(page,workflow,profile,state,{...(id==='235'?{references:10}:id==='236'?{references:0}:id==='242'?{historyMessages:72}:{})});
    await mkdir(path.join(root,device),{recursive:true});
    let passed = false;
    const captures: Array<{position:string;file:string}> = [];
    try {
      await fixture.open();
      if (surface === 'Transition') {
        const sweep = async () => {
          for (const width of widths) { await page.setViewportSize({width,height}); await assertLayout(page,width); }
          await page.setViewportSize({width:device==='mobile'?390:1440,height});
        };
        const capture = async (phase:string) => {
          // Preserve all three stages of the reported geometry, plus final states
          // for every valid workflow/adapter combination below.
          if (id!=='246') return;
          const file=`${device}/${id}-${phase}.png`;
          await page.screenshot({path:path.join(root,file),animations:'disabled'});
          captures.push({position:phase,file});
        };
        await sweep(); await capture('approval');
        fixture.onDecision(()=>fixture.update(chat=>{
          const group=chat.groups[0],revision=group.cards[0].revisions[0];
          revision.decision='approved';revision.approved_snapshot=true;revision.job_ids=[fixture.job.id];revision.request.resolved_seeds=['42'];
          group.state='released';chat.activity='generating';chat.version++;
          chat.jobs=[{...fixture.job,state:'queued',request:revision.request}];return chat;
        }));
        await page.getByRole('button',{name:'Approve',exact:true}).click();
        await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();
        await page.getByRole('button',{name:'Close GPU workers',exact:true}).click();
        await expect(page.locator('.job-output-tile.queued')).toBeVisible();
        await sweep(); await capture('queued');
        fixture.update(chat=>{chat.jobs[0].state='running';chat.version++;return chat;});
        const snapshot=fixture.snapshot();
        await fixture.emit({version:snapshot.version,jobs:snapshot.jobs,activity:snapshot.activity});
        await expect(page.locator('.job-output-tile.running')).toBeVisible();
        await sweep();
        if (id==='246') {
          const bounds=(await page.locator('.request-card-surface').boundingBox())!;
          expect(bounds.height).toBeLessThan(115);
          expect(bounds.width).toBeLessThan(device==='mobile'?340:400);
        }
        const headingEdit=page.locator('.request-card-title-row').getByRole('button',{name:'Edit request',exact:true});
        await headingEdit.click();
        await expect(page.getByRole('dialog',{name:'Review generation',exact:true})).toBeVisible();
        await page.getByRole('button',{name:'Close review',exact:true}).click();
      }
      if(id==='242')await page.locator('.job-request-card').first().scrollIntoViewIfNeeded();
      for (const width of widths) {
        await page.setViewportSize({width,height});
        try { await assertLayout(page,width); }
        catch (error) { await page.screenshot({path:testInfo.outputPath(`failed-${width}.png`),animations:'disabled'}); throw error; }
      }
      if (device === 'mobile') {
        await page.setViewportSize({width:844,height:390});
        await assertLayout(page,844);
      } else {
        // Browser zoom reduces the CSS viewport. Check the 1440px / 200% layout too.
        await page.setViewportSize({width:720,height:500});
        await assertLayout(page,720);
      }
      expect(fixture.errors).toEqual([]);
      expect(fixture.writes).toEqual(surface==='Transition'?[{path:'/api/v1/chats/card-chat/cards/card/decision',body:{revision:1,decision:'approved'}}]:[]);
      passed = true;
    } finally {
      await page.setViewportSize({width: device === 'mobile' ? 390 : 1440,height});
      if(['approved','waiting-many'].includes(state))await page.locator('.job-request-card').first().scrollIntoViewIfNeeded();
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const file = `${device}/${id}.png`;
      if (['review','review-retry'].includes(state) && await page.locator('.review-body').count()) {
        const topFile = `${device}/${id}-top.png`;
        await page.screenshot({path:path.join(root,topFile),animations:'disabled'});
        captures.push({position:'Inputs',file:topFile});
        await page.locator('.review-body').evaluate(e=>e.scrollTop=e.scrollHeight);
        await expect(page.locator('.review-request .lora-name').last()).toBeVisible();
        captures.push({position:'LoRAs and settings',file});
      }
      await page.screenshot({path:path.join(root,file),animations:'disabled'});
      await writeFile(path.join(root,device,id+'.json'),JSON.stringify({run_id:process.env.SEED_ATLAS_RUN_ID,id,surface,title,device,status:passed?'passed':'failed',file,captures,workflow,profile,state:surface==='Transition'?'running':state,...(surface==='Transition'?{transitions:['reviewing','queued','running']}:{}),widths,errors:fixture.errors},null,2));
    }
  });
  }
});
