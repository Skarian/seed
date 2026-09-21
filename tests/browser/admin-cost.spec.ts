import {test,expect} from '@playwright/test';
test('Admin keeps credentials blank, imports a real fixture file, and edits Standard LoRA guidance',async({page})=>{
  await page.goto('/admin');await expect(page.getByRole('heading',{name:'Credentials',exact:true})).toBeVisible();
  await expect(page.getByLabel('fal API key',{exact:true})).toHaveValue('');await expect(page.getByLabel('OpenRouter API key',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Civitai API key',{exact:true})).toBeVisible();await expect(page.getByText('Billing key',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'LoRAs',exact:true}).click();await page.getByRole('button',{name:'+ Add LoRA',exact:true}).click();
  await page.getByRole('textbox',{name:'Civitai URL'}).fill('https://civitai.com/models/5?modelVersionId=10');await page.getByRole('button',{name:'Look up',exact:true}).click();
  await page.getByRole('combobox',{name:'Workflow mapping for watercolor.safetensors',exact:true}).selectOption('image');await page.getByLabel('Description & usage guidance').fill('Watercolor landscapes with soft washes; use 0.8.');await page.getByLabel('Default strength').fill('0.8');
  await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByText('LoRA request submitted · Track it in Activity',{exact:true}).first()).toBeVisible();await expect(page.locator('main progress')).toHaveCount(0);
  await expect(page.getByText('Watercolor landscapes with soft washes; use 0.8.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit',exact:true}).click();await expect(page.getByRole('combobox',{name:'Available in',exact:true})).toHaveCount(0);await expect(page.getByLabel('Default strength')).toHaveValue('0.8');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.locator('main')).not.toContainText(/Standard|Spicy/);
  await page.screenshot({path:'.local/admin-loras-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/admin-loras-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Generate previews single and batch cost and exposes a credit rejection without resubmitting',async({page})=>{
  await page.goto('/');await page.getByRole('checkbox',{name:'Watercolor study v1'}).check();await expect(page.getByLabel('Strength',{exact:true})).toHaveValue('0.8');
  await page.getByLabel('Prompt',{exact:true}).fill('TEST EMPTY BALANCE A quiet landscape');await expect(page.locator('.cost-preview strong')).toHaveText('$0.0088');
  await page.getByRole('combobox',{name:'Quantity',exact:true}).selectOption('4');await expect(page.locator('.cost-preview strong')).toHaveText('$0.0352');await page.getByRole('combobox',{name:'Quantity',exact:true}).selectOption('1');await expect(page.locator('.cost-preview strong')).toHaveText('$0.0088');
  await page.getByRole('button',{name:/^Create image/}).click();await expect(page.getByText('Your fal account does not have enough credit.',{exact:true}).first()).toBeVisible({timeout:15000});await expect(page.getByRole('link',{name:'Add fal credit ↗'}).first()).toBeVisible();
  await page.screenshot({path:'.local/generate-credit-error.png',fullPage:true});
});
test('Standard Chat proposes a named LoRA and approves only with the displayed estimate',async({page})=>{
  await page.goto('/chat');const editor=page.getByRole('combobox',{name:'Chat message'});await editor.fill('/text-to-image A watercolor mountain lake');await editor.press('Enter');
  const approve=page.getByRole('button',{name:'Approve',exact:true});await expect(approve).toBeEnabled({timeout:15000});await expect(page.locator('.selected-loras').first()).toContainText('Watercolor study v1 · 0.8');await expect(page.locator('.request-card-surface > .cost-preview strong')).toHaveText('$0.0088');
  await page.screenshot({path:'.local/chat-cost-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/chat-cost-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const sent=page.waitForRequest(r=>r.url().endsWith('/decision')&&r.method()==='POST');await approve.click();expect((await sent).postDataJSON()).toMatchObject({decision:'approved',estimate_id:expect.any(String)});
  await expect(page.locator('.request-card-surface > .cost-preview')).toHaveCount(0);await expect(page.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);
});
