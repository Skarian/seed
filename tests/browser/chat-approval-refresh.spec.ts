import {test,expect,type Page} from './fixtures.js';
import {cardFixture} from './request-card-fixture.js';

type Fixture=Awaited<ReturnType<typeof cardFixture>>;
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};};
const paint=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
function markPreparing(fixture:Fixture){fixture.update(chat=>{const revision=chat.groups[0].cards[0].revisions[0];revision.decision='approved';revision.approved_snapshot=true;revision.request.resolved_seeds=['42'];chat.activity='preparing';chat.version++;return chat;});}
function markQueued(fixture:Fixture){fixture.update(chat=>{const group=chat.groups[0],revision=group.cards[0].revisions[0];group.state='released';revision.job_ids=['queued-card'];chat.jobs=[{...fixture.job,id:'queued-card',request:revision.request,state:'queued',outputs:[]}];chat.activity='generating';return chat;});}

/** Holds a real full-view response; later refreshes wait so they cannot mask a regression. */
function holdRead(fixture:Fixture){
  const entered=gate(),held=gate(),fresh=gate();let captured:any,first=true;
  fixture.onRead(async snapshot=>{if(first){first=false;captured=snapshot;entered.release();await held.promise;return snapshot;}await fresh.promise;return fixture.snapshot();});
  return {entered,held,fresh,snapshot:()=>captured};
}

test.use({viewport:{width:1440,height:1000}});

test('a preparing GET cannot overwrite accepted jobs at the same chat version',async({page})=>{
  const fixture=await cardFixture(page,'text-to-image','long');
  const preparing=gate(),commit=gate();let read:ReturnType<typeof holdRead>|undefined;
  fixture.onDecision(async()=>{markPreparing(fixture);preparing.release();await commit.promise;markQueued(fixture);});
  try{
    await fixture.open();await page.getByRole('button',{name:'Approve',exact:true}).click();await preparing.promise;
    read=holdRead(fixture);await read.entered.promise;
    const posted=page.waitForResponse(r=>r.url().endsWith('/decision'));commit.release();await posted;
    await expect(page.locator('.job-output-tile.queued')).toHaveCount(1);
    expect(read.snapshot().version).toBe(fixture.snapshot().version);
    const stale=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith('/chats/card-chat'));
    read.held.release();await stale;await paint(page);
    await expect(page.locator('.job-output-tile.queued')).toHaveCount(1);
    await expect(page.locator('.job-request-card').first()).not.toContainText('Preparing');
    expect(fixture.errors).toEqual([]);
  }finally{commit.release();read?.held.release();read?.fresh.release();}
});

test('an older full view cannot restore preparation after Stop is accepted',async({page})=>{
  const fixture=await cardFixture(page,'reference-to-video','multiple','preparing');
  await fixture.open();const read=holdRead(fixture);
  try{
    await read.entered.promise;
    const card=page.locator('.job-request-card').first();
    await card.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('dialog',{name:'Stop this chat?',exact:true}).getByRole('button',{name:'Stop chat and jobs',exact:true}).click();
    await expect(card).toContainText('Stopped');
    const stale=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith('/chats/card-chat'));
    read.held.release();await stale;await paint(page);
    await expect(card).toContainText('Stopped');await expect(card).not.toContainText('Preparing');
    expect(fixture.errors).toEqual([]);
  }finally{read.held.release();read.fresh.release();}
});

test('a slow read for the previous chat cannot block opening or overwrite another chat',async({page})=>{
  const fixture=await cardFixture(page,'text-to-image','long','approved');
  await fixture.open();const read=holdRead(fixture);
  try{
    await read.entered.promise;
    await page.getByRole('button',{name:'Open chat: New conversation',exact:true}).click();
    // This must complete before the old chat responds, not merely after it settles.
    await expect(page.getByText('What shall we create today?',{exact:true})).toBeVisible();
    const stale=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith('/chats/card-chat'));
    read.held.release();await stale;await paint(page);
    await expect(page.getByText('What shall we create today?',{exact:true})).toBeVisible();
    await expect(page.locator('.job-request-card')).toHaveCount(0);expect(fixture.errors).toEqual([]);
  }finally{read.held.release();read.fresh.release();}
});

test('a delayed approval response cannot undo a newer Stop response',async({page})=>{
  const fixture=await cardFixture(page,'image-to-image','none');
  const prepared=gate(),commit=gate(),committed=gate(),deliver=gate(),fresh=gate();
  await page.route('**/api/v1/chats/card-chat/cards/card/decision',async route=>{
    markPreparing(fixture);prepared.release();await commit.promise;
    markQueued(fixture);const response=fixture.snapshot();committed.release();await deliver.promise;
    await route.fulfill({json:response});
  });
  await page.route('**/api/v1/chats/card-chat/stop',async route=>{
    fixture.update(chat=>{chat.activity='idle';chat.epoch++;chat.version++;chat.jobs=chat.jobs.map((job:any)=>({...job,state:'cancelled'}));return chat;});
    await route.fulfill({json:fixture.snapshot()});
  });
  try{
    await fixture.open();await page.getByRole('button',{name:'Approve',exact:true}).click();await prepared.promise;
    const card=page.locator('.job-request-card').first();await expect(card).toContainText('Preparing');
    // The UI has the pre-commit view; commit on the server but delay its response.
    // Hold subsequent reads so only the two mutation responses determine the UI.
    fixture.onRead(async()=>{await fresh.promise;return fixture.snapshot();});
    commit.release();await committed.promise;
    await card.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('dialog',{name:'Stop this chat?',exact:true}).getByRole('button',{name:'Stop chat and jobs',exact:true}).click();
    await expect(page.locator('.job-output-tile.cancelled')).toHaveCount(1);
    const stale=page.waitForResponse(r=>r.url().endsWith('/decision'));deliver.release();await stale;await paint(page);
    await expect(page.locator('.job-output-tile.cancelled')).toHaveCount(1);
    await expect(page.locator('.job-output-tile.queued')).toHaveCount(0);
    await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  }finally{commit.release();deliver.release();fresh.release();}
});

test('a lower-version preparing stream update cannot undo Stop',async({page})=>{
  const fixture=await cardFixture(page,'reference-to-video','long','preparing');
  const fresh=gate();
  try{
    await fixture.open();const before=fixture.snapshot();
    const card=page.locator('.job-request-card').first();
    await card.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('dialog',{name:'Stop this chat?',exact:true}).getByRole('button',{name:'Stop chat and jobs',exact:true}).click();
    await expect(card).toContainText('Stopped');
    fixture.onRead(async()=>{await fresh.promise;return fixture.snapshot();});
    await fixture.emit({version:before.version,activity:'preparing',error:null,partial:'',partial_reasoning:''});await paint(page);
    await expect(card).toContainText('Stopped');
    await expect(page.locator('.composer-actions .stop-action')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  }finally{fresh.release();}
});

test('a preparing stream update does not swallow a successful approval or its worker prompt',async({page})=>{
  const fixture=await cardFixture(page,'text-to-image','multiple');
  const entered=gate(),held=gate();
  fixture.onDecision(async()=>{markPreparing(fixture);entered.release();await held.promise;markQueued(fixture);});
  try{
    await fixture.open();await page.getByRole('button',{name:'Approve',exact:true}).click();await entered.promise;
    await fixture.emit({version:fixture.snapshot().version,activity:'preparing',error:null,partial:'',partial_reasoning:''});
    await expect(page.locator('.job-request-card').first()).toContainText('Preparing');
    await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toHaveCount(0);
    held.release();
    await expect(page.locator('.job-output-tile.queued')).toHaveCount(1);
    await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();
    expect(fixture.errors).toEqual([]);
  }finally{held.release();}
});

test('a held preparing GET cannot block the refresh after approval succeeds',async({page})=>{
  const fixture=await cardFixture(page,'text-to-image','multiple');
  const preparing=gate(),commit=gate(),readEntered=gate(),heldRead=gate();let first=true;
  fixture.onDecision(async()=>{markPreparing(fixture);preparing.release();await commit.promise;markQueued(fixture);});
  try{
    await fixture.open();await page.getByRole('button',{name:'Approve',exact:true}).click();await preparing.promise;
    fixture.onRead(async snapshot=>{if(first){first=false;readEntered.release();await heldRead.promise;return snapshot;}return fixture.snapshot();});
    await fixture.emit({version:fixture.snapshot().version,activity:'preparing',error:null,partial:'',partial_reasoning:''});
    await readEntered.promise;
    const posted=page.waitForResponse(r=>r.url().endsWith('/decision'));commit.release();await posted;
    // The obsolete read is still held: a fresh read must bypass it immediately.
    await expect(page.locator('.job-output-tile.queued')).toHaveCount(1);
    await expect(page.getByRole('dialog',{name:'GPU workers',exact:true})).toBeVisible();
    heldRead.release();await paint(page);
    await expect(page.locator('.job-output-tile.queued')).toHaveCount(1);expect(fixture.errors).toEqual([]);
  }finally{commit.release();heldRead.release();}
});
