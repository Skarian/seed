import {test,expect} from '@playwright/test';
test('workspace menu and compact Chats header work on desktop and mobile',async({page})=>{
 await page.goto('/chat');
 await page.getByRole('button',{name:/Pod connection:/}).click();await expect(page.locator('#pod-details')).toBeVisible();await expect(page.locator('#pod-details h2')).toHaveCount(0);await page.getByRole('button',{name:/^Jobs/}).click();await expect(page.getByRole('dialog',{name:'Jobs',exact:true})).toBeVisible();await expect(page.locator('body')).toHaveAttribute('data-scroll-locked',/.+/);await page.screenshot({path:'.local/qa-jobs-modal.png'});await page.getByRole('button',{name:'Close jobs'}).click();await page.getByRole('button',{name:/Pod connection:/}).click();
 await expect(page.locator('.brand-workspace small')).toHaveText('Chat');await expect(page.locator('.sidebar-chats-heading')).toContainText('Chats');await expect(page.getByRole('button',{name:'New chat',exact:true})).toHaveText('+');
 await page.getByRole('button',{name:'Seed',exact:true}).click();await expect(page.getByRole('menu',{name:'Workspace'})).toBeVisible();await page.screenshot({path:'.local/qa-workspace-menu.png'});
 await page.getByRole('menuitem',{name:/Generate/}).click();await expect(page.locator('.brand-workspace small')).toHaveText('Generate');
 await page.getByRole('button',{name:'Seed',exact:true}).click();await page.getByRole('menuitem',{name:/Library/}).click();await expect(page.locator('.brand-workspace small')).toHaveText('Library');
 await page.getByRole('button',{name:'New chat',exact:true}).click();await expect(page.locator('.brand-workspace small')).toHaveText('Chat');await expect(page.getByRole('heading',{name:'What shall we create today?'})).toBeVisible();
 await page.screenshot({path:'.local/qa-sidebar-consistent.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Toggle sidebar'}).click();await page.getByRole('button',{name:'Seed',exact:true}).click();await expect(page.getByRole('menu',{name:'Workspace'})).toBeVisible();await page.screenshot({path:'.local/qa-workspace-mobile.png'});
 await page.getByRole('menuitem',{name:/Generate/}).click();await expect(page.getByRole('dialog',{name:'Sidebar'})).toHaveCount(0);
});
