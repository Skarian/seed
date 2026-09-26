import {test,expect} from './fixtures.js';
import {cardFixture} from './request-card-fixture.js';

const workflows=['text-to-image','image-to-image','text-to-video','reference-to-video'] as const;
for(const workflow of workflows)for(const width of [390,1440])for(const fresh of [false,true])test(`new chat branch: ${workflow}, ${width}px, ${fresh?'new':'same'} seed`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const fixture=await cardFixture(page,workflow,workflow==='image-to-image'?'none':'multiple','completed',{sourceChat:false});
  await fixture.open();
  await page.getByRole('button',{name:'Create another request',exact:true}).click();
  await page.getByRole('button',{name:'Branch in Chat',exact:true}).click();
  await page.getByRole('button',{name:fresh?'New seed':'Same seed',exact:true}).click();
  await expect(page.locator('.branch-draft-preview')).toBeVisible();
  await expect(page.locator('.studio-shell')).toBeVisible();
  await page.reload();
  await expect(page.locator('.branch-draft-preview')).toBeVisible();
  const editor=page.getByRole('combobox',{name:'Chat message',exact:true});
  await editor.fill('Make the lighting warmer.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.branch-draft-preview')).toHaveCount(0);
  await expect(page.getByText('Make the lighting warmer.',{exact:true})).toBeVisible();
  await expect(page.locator('.chat-layout')).toBeVisible();
  expect(fixture.errors).toEqual([]);
  expect(fixture.writes.find(w=>w.path.endsWith('/branch-chat'))?.body).toMatchObject({fresh,job_ids:['card-job'],draft:true});
});

for(const destination of ['New chat','Open chat: New conversation'])test(`leaving a slow branch for ${destination} discards its late response`,async({page})=>{
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(r=>release=r),pending=new Promise<void>(r=>started=r);
  const fixture=await cardFixture(page,'image-to-image','none','completed',{delayJob:async()=>{started();await gate;}});
  await page.goto('/chat?fromJob=card-job&seed=same');
  await pending;
  await page.getByRole('button',{name:destination,exact:true}).click();
  await expect(page.getByText('What shall we create today?',{exact:true})).toBeVisible();
  const response=page.waitForResponse(r=>r.url().endsWith('/jobs/card-job'));
  release();await response;
  // Flush the late response and any source-chat lookup, not an arbitrary timeout.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.locator('.branch-draft-preview')).toHaveCount(0);
  await expect(page.getByText('What shall we create today?',{exact:true})).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('a removed source job leaves a usable new chat with an error',async({page})=>{
  const fixture=await cardFixture(page,'image-to-image','none','completed');
  await page.route('**/api/v1/jobs/card-job',r=>r.fulfill({status:404,json:{error:{message:'Job no longer available.'}}}));
  await page.goto('/chat?fromJob=card-job');
  await expect(page.getByRole('alert')).toContainText('Job no longer available.');
  await expect(page.getByRole('combobox',{name:'Chat message',exact:true})).toBeVisible();
  expect(fixture.errors).toEqual([]);
});
