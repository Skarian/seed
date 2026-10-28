import {test,expect} from './fixtures.js';

test('opening This PC only reads status and explicit setup shows download progress',async({page})=>{
  const writes:string[]=[];
  const setup={supported:true,installed:false,state:'idle',phase:'Not set up',bytes_done:0,bytes_total:111167216510};
  await page.route('**/api/v1/pool/local',route=>route.fulfill({json:{worker:null,setup}}));
  await page.route('**/api/v1/pool/local/setup',route=>{
    writes.push(route.request().method());setup.state='running';setup.phase='Downloading and verifying models';setup.bytes_done=1024**3;
    return route.fulfill({json:setup});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'GPU workers',exact:true}).click();
  await page.getByRole('button',{name:'Workers',exact:true}).click();
  const card=page.getByRole('region',{name:'This PC worker'});
  await expect(card.getByText('Off',{exact:true})).toBeVisible();
  await expect(card.getByRole('button',{name:'Set up local GPU'})).toBeEnabled();
  expect(writes).toEqual([]);
  await card.getByRole('button',{name:'Set up local GPU'}).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('value',String(1024**3));
  await expect(card.getByText('Downloading and verifying models')).toBeVisible();
  await expect(card.getByRole('button',{name:'Set up local GPU'})).toBeDisabled();
  expect(writes).toEqual(['POST']);
});
