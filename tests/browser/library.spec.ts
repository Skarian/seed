import { test, expect } from '@playwright/test';
test('Library floating delete requires confirmation and keeps the item on failure', async ({page}) => {
  let removed=false, fail=true, deletes=0;
  await page.route('**/api/v1/assets', r=>r.fulfill({json:{items:removed?[]:[{id:'delete-test',kind:'image',name:'Test image'}]}}));
  await page.route('**/api/v1/assets/delete-test/content', r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64')}));
  await page.route('**/api/v1/assets/delete-test', r=>{deletes++;if(fail)return r.fulfill({status:409,json:{error:{message:'File is busy.'}}});removed=true;return r.fulfill({status:204});});
  await page.setViewportSize({width:390,height:844}); await page.goto('/library');
  const remove=page.getByRole('button',{name:'Delete Test image'});
  await expect(remove).toBeVisible();
  page.once('dialog', d=>d.dismiss()); await remove.click(); expect(deletes).toBe(0);
  page.once('dialog', d=>{expect(d.message()).toContain('cannot be undone');return d.accept();}); await remove.click();
  await expect(page.getByRole('alert')).toContainText('File is busy.'); await expect(remove).toBeVisible();
  await page.screenshot({path:'.local/library-delete-mobile.png',fullPage:true});
  fail=false;page.once('dialog',d=>d.accept());await remove.click();
  await expect(remove).toHaveCount(0);await expect(page.getByText('No saved files yet.')).toBeVisible();expect(deletes).toBe(2);
});
test('NSFW Library images require opt-in and reset on reload', async ({page}) => {
  await page.route('**/api/v1/assets', r=>r.fulfill({json:{items:[{id:'adult',kind:'image',mode:'nsfw',name:'Hidden image'}]}}));
  await page.route('**/api/v1/assets/adult/content',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64')}));
  await page.goto('/library');
  await expect(page.getByLabel('Show NSFW')).not.toBeChecked();
  await expect(page.getByRole('img',{name:'Hidden image'})).toHaveCount(0);
  await page.getByLabel('Show NSFW').check();
  await expect(page.getByRole('img',{name:'Hidden image'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img',{name:'Hidden image'})).toHaveCount(0);
});
