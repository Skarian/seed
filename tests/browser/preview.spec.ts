import {test,expect} from '@playwright/test';
import sharp from 'sharp';
test('preview maximizes portrait space and supports hover and held metadata',async({page})=>{
 const image=await sharp({create:{width:600,height:900,channels:3,background:'#789269'}}).png().toBuffer();
 await page.goto('/chat');await page.locator('input[type=file]').setInputFiles({name:'Portrait.png',mimeType:'image/png',buffer:image});
 await page.getByRole('dialog',{name:'Describe assets'}).getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('.composer-attachments').getByRole('button',{name:'Preview Portrait.png'}).click();
 const viewer=page.getByRole('dialog',{name:'Media preview'});
 await expect(viewer.locator('.viewer-controls')).toHaveCount(0);
 await expect.poll(async()=>{const b=await viewer.locator('.viewer-canvas').boundingBox();return b!.height;}).toBeGreaterThan(650);
 await page.getByLabel('File information').hover();await expect(viewer.getByText('600 × 900')).toBeVisible();
 await page.mouse.move(500,600);await expect(viewer.getByText('600 × 900')).not.toBeVisible();
 await page.screenshot({path:'.local/qa-preview-desktop.png'});
 await page.getByRole('button',{name:'Edit note',exact:true}).click();await expect(viewer.getByLabel('Asset note',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit note',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 const info=page.getByLabel('File information');const b=(await info.boundingBox())!;
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+20,y:b.y+20}]});
 await expect(viewer.getByText('600 × 900')).toBeVisible();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(viewer.getByText('600 × 900')).toBeVisible();
 await page.screenshot({path:'.local/qa-preview-mobile-info.png'});
});

