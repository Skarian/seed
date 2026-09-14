import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
test('activity proposal desktop and mobile',async({page})=>{
 await page.route('**/activity-draft',async r=>r.fulfill({contentType:'text/html',body:await fs.readFile('.local/activity-draft.html')}));
 await page.setViewportSize({width:1400,height:1000});await page.goto('/activity-draft');await expect(page.locator('.sample')).toHaveCount(8);await page.screenshot({path:'.local/activity-mosaic-desktop.png',fullPage:true,animations:'disabled'});await page.locator('.grid').nth(0).screenshot({path:'.local/activity-polished-1.png',animations:'disabled'});await page.locator('.grid').nth(1).screenshot({path:'.local/activity-polished-2.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/activity-mosaic-mobile.png',fullPage:true,animations:'disabled'});
 await page.locator('.sample').nth(1).locator('summary').click();await expect(page.locator('.sample').nth(1).locator('.trace')).toBeVisible();
});
