import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Loras} from '../server/loras.js';
import {LoraImports} from '../server/lora-imports.js';
import {registerAdmin,type AdminOptions} from '../server/admin.js';
import {credential,credentialFields} from '../server/credential-store.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(options:AdminOptions={}){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/admin-'));roots.push(root);const paths=resolvePaths(root);prepareStorage(paths);
  writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify(Object.fromEntries(Object.keys(credentialFields).map(key=>[key,null]))));
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({})),loras=new Loras(paths),imports=new LoraImports(paths,loras,fetcher),app=Fastify();
  registerAdmin(app,paths,loras,imports,{fetcher,...options});await app.ready();return {paths,fetcher,app,imports};
}
it('Admin configures every supported credential without exposing secrets or fal fields',async()=>{
  const f=await fixture();try{
    const initial=(await f.app.inject('/api/v1/admin')).json();expect(Object.keys(initial.credentials)).toEqual(Object.keys(credentialFields));
    for(const field of Object.keys(credentialFields)){
      const saved=await f.app.inject({method:'PATCH',url:'/api/v1/admin/credentials/'+field,payload:{value:'fixture-secret'}});expect(saved.statusCode).toBe(200);expect(saved.body).not.toContain('fixture-secret');
      const check=await f.app.inject({method:'POST',url:'/api/v1/admin/credentials/'+field+'/check'});expect(check.statusCode).toBe(200);expect(check.json().credentials[field].validation).toBe('valid');
      const removed=await f.app.inject({method:'PATCH',url:'/api/v1/admin/credentials/'+field,payload:{value:null}});expect(removed.json().credentials[field]).toMatchObject({configured:false,validation:'unchecked'});
    }
    expect(f.fetcher.mock.calls.map(([url])=>String(url))).toContain('https://api.runpod.io/v2/pods');
    expect((await f.app.inject({method:'PATCH',url:'/api/v1/admin/credentials/falKey',payload:{value:'x'}})).statusCode).toBe(409);
  }finally{await f.app.close();await f.imports.close();}
});
it('validates replacements before committing and serializes live-rental credential changes',async()=>{
  const before=vi.fn<NonNullable<AdminOptions['beforeCredentialChange']>>(async(_field,next)=>{if(next==='wrong-account'||next===null)throw Error('Release outstanding workers before removing this key.');}),changed=vi.fn();
  const f=await fixture({beforeCredentialChange:before,credentialsChanged:changed});try{
    const write=(value:string|null)=>f.app.inject({method:'PATCH',url:'/api/v1/admin/credentials/runpodApiKey',payload:{value}});
    expect((await write('working-account')).statusCode).toBe(200);expect((await write('wrong-account')).statusCode).toBe(409);expect((await write(null)).statusCode).toBe(409);
    expect(credential(f.paths,'runpodApiKey',{})).toBe('working-account');expect(changed).toHaveBeenCalledTimes(1);expect(before).toHaveBeenLastCalledWith('runpodApiKey',null,'working-account');
  }finally{await f.app.close();await f.imports.close();}
});
it('does not leak provider bodies and distinguishes a failed check from missing configuration',async()=>{
  const f=await fixture();try{
    await f.app.inject({method:'PATCH',url:'/api/v1/admin/credentials/vastApiKey',payload:{value:'private-key'}});
    f.fetcher.mockResolvedValueOnce(Response.json({message:'private-key and private account details'},{status:403}));
    const response=await f.app.inject({method:'POST',url:'/api/v1/admin/credentials/vastApiKey/check'});expect(response.statusCode).toBe(409);expect(response.body).not.toContain('private-key');
    expect((await f.app.inject('/api/v1/admin')).json().credentials.vastApiKey).toMatchObject({configured:true,validation:'invalid'});
  }finally{await f.app.close();await f.imports.close();}
});
it('commits credentials only inside the lifecycle transaction supplied by the pool',async()=>{
  let allowed=false;
  const change=vi.fn<NonNullable<AdminOptions['changeCredential']>>(async(_field,_next,_previous,commit)=>{if(!allowed)throw Error('Owned rentals must remain accessible.');commit();});
  const f=await fixture({changeCredential:change});try{
    const write=()=>f.app.inject({method:'PATCH',url:'/api/v1/admin/credentials/vastApiKey',payload:{value:'replacement-fixture'}});
    expect((await write()).statusCode).toBe(409);expect(credential(f.paths,'vastApiKey',{})).toBe('');allowed=true;expect((await write()).statusCode).toBe(200);expect(credential(f.paths,'vastApiKey',{})).toBe('replacement-fixture');
  }finally{await f.app.close();await f.imports.close();}
});
