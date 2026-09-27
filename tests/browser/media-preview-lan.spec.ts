import {test,expect} from './fixtures.js';

for(const device of ['desktop','mobile'] as const)test.describe(device,()=>{
  test.use({baseURL:'http://seed-qa.test:4311',viewport:device==='desktop'?{width:1440,height:1000}:{width:390,height:844},isMobile:device==='mobile',hasTouch:device==='mobile'});
  test('plain HTTP preview opens, zooms, closes and reopens without a secure context',async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Fixture browser error:',error.message);});
    await page.route('**/api/v1/assets?*',r=>r.fulfill({json:{items:[{id:'lan-fixture',name:'LAN fixture',kind:'image',mode:'sfw'}]}}));
    await page.route('**/api/v1/assets/lan-fixture/content',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#52877b"/><circle cx="480" cy="320" r="130" fill="#eeb458"/></svg>'}));
    await page.route('**/api/v1/notes/lan-fixture',r=>r.fulfill({json:{note:'',revision:0}}));
    await page.goto('/library');
    expect(await page.evaluate(()=>({secure:isSecureContext,uuid:typeof crypto.randomUUID,random:typeof crypto.getRandomValues}))).toEqual({secure:false,uuid:'undefined',random:'function'});
    for(const method of ['back','button']){
      await page.getByRole('button',{name:'LAN fixture',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'Saved image',exact:true})).toBeVisible({timeout:5000});
      await expect.poll(()=>page.locator('.preview-image img').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(960);
      await page.locator('.preview-image-surface').dblclick();await expect(page.getByRole('button',{name:'Reset zoom',exact:true})).toBeVisible();
      if(method==='back')await page.goBack();else await page.getByRole('button',{name:'Close preview',exact:true}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL('http://seed-qa.test:4311/library');
      await expect(page.getByRole('button',{name:'LAN fixture',exact:true})).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
