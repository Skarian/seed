import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Pricing,billingUnits} from '../server/pricing.js';
import {Loras} from '../server/loras.js';
import {saveCredential,credential} from '../server/credential-store.js';
import {falIssue} from '../server/fal-errors.js';
import {createApp} from '../server/http.js';
import {priceInput} from '../shared/pricing.js';
const roots:string[]=[];
function fixture(){mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/admin-'));roots.push(root);const paths=resolvePaths(root);prepareStorage(paths);saveCredential(paths,'falKey','fixture-key');const loras=new Loras(paths);const fetcher=vi.fn<typeof fetch>(async url=>{const endpoint=new URL(String(url)).searchParams.get('endpoint_id')!;return Response.json({prices:[{endpoint_id:endpoint,unit_price:endpoint.includes('krea')?(endpoint.endsWith('/lora')?.01:.008):(endpoint.endsWith('/lora')?.0625:.05),currency:'USD',unit:endpoint.includes('krea')?'megapixels':'seconds'}]});});return {paths,loras,fetcher,pricing:new Pricing(paths,loras,fetcher)};}
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const request:any={workflow:'text-to-image',mode:'sfw',prompt:'A watercolor landscape',output:{aspect:'16:9',size:'1mp'},count:1,seed:'42',loras:[]};
it('prices Krea megapixels and batches, caches rates, and binds a preview to settings',async()=>{
  const {pricing,fetcher}=fixture(),input=priceInput(request),quote=await pricing.estimate(input);
  expect(quote.per_item).toBe(.00703125);expect(pricing.accept(quote.id,request).total).toBe(.00703125);
  const batch=await pricing.estimate({...input,count:4});expect(batch.total).toBe(.028125);expect(fetcher).toHaveBeenCalledTimes(1);
  expect(()=>pricing.accept(quote.id,{...request,count:4})).toThrow('changed or expired');
  expect(()=>pricing.accept(undefined,request)).toThrow('changed or expired');
  vi.useFakeTimers();vi.setSystemTime(Date.now()+11*60000);expect(()=>pricing.accept(quote.id,request)).toThrow('expired');
});
it('prices 768p output plus input video, and picks the matching LoRA route',async()=>{
  const {paths,pricing}=fixture();writeFileSync(path.join(paths.config,'loras.json'),JSON.stringify([{id:'ref',revision:'v1',name:'Reference style',route:'ref',availability:'all'}]));
  const input:any={workflow:'reference-to-video',mode:'sfw',aspect:'16:9',size:'768p',count:4,duration:15,loras:[{id:'ref',revision:'v1',scale:1}],references:[{kind:'video',role:'reference',duration:3},{kind:'image',role:'reference'}]};
  const quote=await pricing.estimate(input);expect(quote).toMatchObject({per_item:1.35,total:5.4,endpoint:'minimax/h3/reference-to-video/lora'});
  expect(billingUnits({...input,loras:[],references:[{kind:'image',role:'first_frame'}]}).endpoint).toBe('minimax/h3/image-to-video');
  await expect(pricing.estimate({...input,loras:[{id:'missing',revision:'v1',scale:1}]})).rejects.toThrow('version');
});
it.each([
  [402,{},'insufficient_funds'],[403,{detail:'User is locked. Reason: Exhausted balance'},'insufficient_funds'],
  [403,{detail:'Permission denied'},'access_denied'],[401,{},'invalid_credentials'],[429,{},'rate_limited'],
  [422,{detail:[{type:'content_policy_violation',input:'private-url',msg:'secret'}]},'content_rejected'],
  [422,{detail:[{type:'file_download_error'}]},'input_unavailable'],[422,{detail:[{type:'no_media_generated'}]},'no_output'],
  [504,{error_type:'request_timeout'},'provider_timeout'],[503,{error_type:'runner_unavailable'},'provider_unavailable'],
])('models safe fal errors for status %s', (status,body,code)=>{const issue=falIssue(status as number,body,'30');expect(issue.code).toBe(code);expect(issue.retry_after_seconds).toBe(30);expect(JSON.stringify(issue)).not.toMatch(/private-url|secret|Permission denied/);});
it('stores and removes credentials without returning secrets or falling back to removed environment keys',async()=>{
  const {paths,fetcher}=fixture();vi.stubEnv('CIVITAI_API_KEY','environment-fixture');
  const app=await createApp({paths,port:4311,providerFetch:fetcher});const headers={host:'127.0.0.1:4311',origin:'http://127.0.0.1:4311'};
  try{
    let response=await app.inject({url:'/api/v1/admin',headers});expect(response.json().credentials.falKey.configured).toBe(true);expect(response.body).not.toContain('fixture-key');
    response=await app.inject({method:'PATCH',url:'/api/v1/admin/credentials/civitaiKey',headers,payload:{value:'new-civitai-key'}});expect(response.statusCode).toBe(200);expect(response.body).not.toContain('new-civitai-key');expect(credential(paths,'civitaiKey')).toBe('new-civitai-key');
    await app.inject({method:'PATCH',url:'/api/v1/admin/credentials/civitaiKey',headers,payload:{value:null}});expect(credential(paths,'civitaiKey')).toBe('');
    expect((await app.inject({method:'PATCH',url:'/api/v1/admin/credentials/billingKey',headers,payload:{value:'no'}})).statusCode).toBe(409);
    const quote=(await app.inject({method:'POST',url:'/api/v1/estimates',headers,payload:priceInput(request)})).json();expect(quote.total).toBe(.00703125);
    const missing=await app.inject({method:'POST',url:'/api/v1/jobs',headers:{...headers,'idempotency-key':'no-approval-fixture'},payload:request});expect(missing.statusCode).toBe(409);
    const mismatch=await app.inject({method:'POST',url:'/api/v1/jobs',headers:{...headers,'idempotency-key':'bad-approval-fixture','x-seed-estimate':quote.id},payload:{...request,count:4}});expect(mismatch.statusCode).toBe(409);
    expect((await app.inject({url:'/api/v1/jobs',headers})).json().items).toHaveLength(0);
  }finally{await app.close();}
});
