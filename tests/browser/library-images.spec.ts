import {test,expect} from './fixtures.js';
import sharp from 'sharp';

test.beforeEach(async({page})=>{
  const png=await sharp({create:{width:480,height:270,channels:3,background:'#647c65'}}).png().toBuffer();
  await page.route('**/api/v1/assets?*',r=>r.fulfill({json:{items:[{id:'frame',name:'Picked frame',kind:'image',mode:'sfw'}]}}));
  await page.route('**/api/v1/assets/frame',r=>r.fulfill({json:{id:'frame',name:'Picked frame',kind:'image',mime_type:'image/png',mode:'sfw',metadata:{width:480,height:270}}}));
  await page.route('**/api/v1/assets/frame/content',r=>r.fulfill({contentType:'image/png',body:png}));
  await page.route('**/api/v1/notes/frame',r=>r.fulfill({json:{note:'',revision:0}}));
});

test('Library shows frames as ordinary images with a normal preview',async({page})=>{
  await page.goto('/library');await expect(page.getByRole('button',{name:'Frame sequences',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Images',exact:true}).click();
  await page.getByRole('button',{name:'Picked frame',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Saved image',exact:true})).toBeVisible();
  await expect(page.getByRole('slider',{name:'Frame',exact:true})).toHaveCount(0);
});

test('Gallery selects a saved frame directly as an image reference',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Reference to video',exact:true}).click();await page.getByRole('button',{name:'Gallery',exact:true}).click();
  await page.getByRole('button',{name:'Select Picked frame',exact:true}).click();await page.getByRole('button',{name:'Select (1)',exact:true}).click();
  await expect(page.getByRole('button',{name:'Preview Picked frame',exact:true})).toBeVisible();
});
