import {test,expect} from './fixtures.js';
import {cardFixture} from './request-card-fixture.js';

type Fixture=Awaited<ReturnType<typeof cardFixture>>;
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};};

// These are explicit API snapshots for UI tests. Transaction/restart/idempotency
// behavior is tested against the real service in tests/chat.test.ts.
function preparing(fixture:Fixture,cardId='card'){
  fixture.update(chat=>{
    const group=chat.groups[0],revision=group.cards.find((card:any)=>card.id===cardId).revisions.at(-1);
    revision.decision='approved';revision.approved_snapshot=true;revision.request.resolved_seeds??=[revision.request.seed];
    delete group.submission_error;chat.activity='preparing';chat.version++;return chat;
  });
}
function admitted(fixture:Fixture){
  fixture.update(chat=>{
    const group=chat.groups[0];
    if(group.state==='stopped')return chat;
    chat.jobs=group.cards.filter((card:any)=>card.revisions.at(-1).decision==='approved').map((card:any)=>{
      const revision=card.revisions.at(-1),id='queued-'+card.id;
      revision.job_ids=[id];return {...fixture.job,id,submission_id:'submission-'+card.id,state:'queued',request:revision.request,seed:revision.request.resolved_seeds[0],outputs:[],source:{chat_id:chat.id,card_id:card.id,revision:revision.number}};
    });
    delete group.submission_error;group.state='released';chat.activity='generating';return chat;
  });
}

for(const width of [390,1440])test.describe(`approval lifecycle ${width}px`,()=>{
  test.use({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});

  test('waiting action finds the undecided sibling in a long conversation',async({page})=>{
    const fixture=await cardFixture(page,'text-to-image','unbroken','waiting-many',{historyMessages:72});
    await fixture.open();
    const approved=page.locator('.job-request-card').first();
    await expect(approved).toContainText('Waiting for 2 other decisions');
    await approved.getByRole('button',{name:'Review next request',exact:true}).click();
    const review=page.getByRole('dialog',{name:'Review generation',exact:true});
    await expect(review).toBeVisible();
    await expect(review.getByLabel('Prompt',{exact:true})).toHaveValue('Synthetic sibling proposal 1.');
    expect(fixture.writes).toEqual([]);expect(fixture.errors).toEqual([]);
  });

  test('approval prepares inline and Stop remains available while its response is pending',async({page})=>{
    const fixture=await cardFixture(page,'image-to-image','none');
    const entered=gate(),held=gate();
    fixture.onDecision(async()=>{preparing(fixture);entered.release();await held.promise;admitted(fixture);});
    try{
      await fixture.open();
      await page.getByRole('button',{name:'Approve',exact:true}).click();await entered.promise;
      const card=page.locator('.job-request-card').first();
      await expect(card).toContainText('Preparing');
      await expect(page.getByRole('dialog',{name:'Review generation',exact:true})).toHaveCount(0);
      await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toHaveCount(0);
      await expect(page.locator('.job-output-tile')).toHaveCount(0);
      await card.getByRole('button',{name:'Stop',exact:true}).click();
      await page.getByRole('dialog',{name:'Stop this chat?',exact:true}).getByRole('button',{name:'Stop chat and jobs',exact:true}).click();
      await expect(card).toContainText('Stopped');
      const response=page.waitForResponse(r=>r.url().endsWith('/decision'));held.release();await response;
      await expect(card).toContainText('Stopped');await expect(card).not.toContainText('Preparing');
      await expect(page.locator('.job-output-tile')).toHaveCount(0);
      expect(fixture.writes.filter(w=>w.path.endsWith('/decision'))).toHaveLength(1);
      expect(fixture.errors).toEqual([]);
    }finally{held.release();}
  });

  test('a preparation failure stays on the card without opening workers',async({page})=>{
    const fixture=await cardFixture(page,'reference-to-video','multiple');
    fixture.onDecision(()=>{
      preparing(fixture);fixture.update(chat=>{chat.activity='idle';chat.groups[0].submission_error='An input could not be prepared. Check the selected references and retry.';return chat;});
    });
    await fixture.open();await page.getByRole('button',{name:'Approve',exact:true}).click();
    const card=page.locator('.job-request-card').first();
    await expect(card).toContainText('Couldn’t start');await expect(card).toContainText('An input could not be prepared.');
    await expect(card.getByRole('button',{name:'Retry start',exact:true})).toBeVisible();
    await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toHaveCount(0);
    await page.reload();await expect(card).toContainText('Couldn’t start');
    expect(fixture.writes.filter(w=>w.path.endsWith('/decision'))).toHaveLength(1);expect(fixture.errors).toEqual([]);
  });

  for(const count of [1,2])test(`retry starts ${count} approved request(s) through the original decision identity`,async({page})=>{
    const fixture=await cardFixture(page,'text-to-image','multiple','start-failed',{siblings:count-1});
    fixture.update(chat=>{for(const card of chat.groups[0].cards){const revision=card.revisions.at(-1);revision.decision='approved';revision.approved_snapshot=true;revision.request.resolved_seeds=[revision.request.seed];}return chat;});
    const before=fixture.snapshot().groups[0].cards.map((card:any)=>({id:card.id,revision:card.revisions.at(-1).number,request:card.revisions.at(-1).request}));
    fixture.onDecision(()=>{preparing(fixture);admitted(fixture);});
    await fixture.open();
    await page.locator('.job-request-card').first().getByRole('button',{name:count===1?'Retry start':'Retry approved requests',exact:true}).click();
    await expect(page.locator('.job-output-tile.queued')).toHaveCount(count);
    await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();
    expect(fixture.writes.filter(w=>w.path.endsWith('/decision'))).toEqual([{path:'/api/v1/chats/card-chat/cards/card/decision',body:{revision:1,decision:'approved'}}]);
    expect(fixture.snapshot().groups[0].cards.map((card:any)=>({id:card.id,revision:card.revisions.at(-1).number,request:card.revisions.at(-1).request}))).toEqual(before);
    expect(fixture.errors).toEqual([]);
  });

  for(const state of ['interrupted','legacy'] as const)test(`${state} unfinished approval offers explicit retry without an automatic submission`,async({page})=>{
    const fixture=await cardFixture(page,'reference-to-video','long',state);
    await fixture.open();await page.reload();
    const card=page.locator('.job-request-card').first();
    await expect(card).toContainText('Couldn’t start');
    await expect(card).toContainText(state==='interrupted'?'Preparation was interrupted':'These approved requests did not start');
    await expect(card.getByRole('button',{name:'Retry start',exact:true})).toBeVisible();
    await expect(page.locator('.job-output-tile')).toHaveCount(0);expect(fixture.writes).toEqual([]);expect(fixture.errors).toEqual([]);
  });

  test('an approved stopped request cannot offer a retry',async({page})=>{
    const fixture=await cardFixture(page,'reference-to-video','multiple','stopped-approved');
    await fixture.open();const card=page.locator('.job-request-card').first();
    await expect(card).toContainText('Stopped');await expect(card).not.toContainText('Approved');
    await expect(card.getByRole('button',{name:/Retry/})).toHaveCount(0);expect(fixture.writes).toEqual([]);expect(fixture.errors).toEqual([]);
  });

  test('the existing review dialog retries the same approved revision',async({page})=>{
    const fixture=await cardFixture(page,'reference-to-video','multiple','review-retry');
    fixture.onDecision(()=>{preparing(fixture);admitted(fixture);});
    await fixture.open();
    const review=page.getByRole('dialog',{name:'Review generation',exact:true});
    await expect(review).toContainText('An input could not be prepared.');
    await review.getByRole('button',{name:'Retry start',exact:true}).click();
    await expect(review).toHaveCount(0);await expect(page.locator('.job-output-tile.queued')).toHaveCount(1);
    expect(fixture.writes.filter(w=>w.path.endsWith('/decision'))).toEqual([{path:'/api/v1/chats/card-chat/cards/card/decision',body:{revision:1,decision:'approved'}}]);
    expect(fixture.errors).toEqual([]);
  });
});
