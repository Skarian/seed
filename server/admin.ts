import type {FastifyInstance} from 'fastify';
import type {StudioPaths} from './storage.js';
import type {Loras} from './loras.js';
import type {LoraImports} from './lora-imports.js';
import type {HttpAccess} from './http-access.js';
import {credential,credentialStatus,credentialValue,saveCredential,recordCredentialCheck,credentialFields,type CredentialField} from './credential-store.js';

export type AdminOptions = {
  access?: HttpAccess;
  fetcher?:typeof fetch;
  beforeCredentialChange?:(field:CredentialField,next:string|null,previous:string)=>Promise<void>;
  changeCredential?:(field:CredentialField,next:string|null,previous:string,commit:()=>void)=>Promise<void>;
  credentialsChanged?:(field:CredentialField)=>void|Promise<void>;
};
const modeQuery={type:'object',additionalProperties:false,properties:{mode:{enum:['sfw','nsfw']}}};
const checkUrls:Record<CredentialField,string>={
  vastApiKey:'https://console.vast.ai/api/v0/users/current/',
  runpodApiKey:'https://api.runpod.io/v2/pods',
  openrouterApiKey:'https://openrouter.ai/api/v1/key',
  civitaiKey:'https://civitai.com/api/v1/me',
  huggingFaceToken:'https://huggingface.co/api/whoami-v2',
};
export function registerAdmin(app:FastifyInstance,paths:StudioPaths,loras:Loras,imports:LoraImports,options:AdminOptions={}) {
  const fetcher=options.fetcher??fetch;
  let changes=Promise.resolve();
  const serialized=<T>(fn:()=>Promise<T>)=>{const next=changes.then(fn);changes=next.then(()=>undefined,()=>undefined);return next;};
  const fieldOf=(value:unknown):CredentialField=>{
    if(typeof value!=='string'||!Object.hasOwn(credentialFields,value))throw Error('Unknown credential.');
    return value as CredentialField;
  };
  const handle=(fn:(r:any)=>unknown,status=200)=>async(r:any,reply:any)=>{
    try{return reply.code(status).send(await fn(r));}
    catch(e){return reply.code(409).send({error:{code:'admin_error',message:(e as Error).message,retryable:false}});}
  };
  app.get('/api/v1/admin',async()=>({credentials:credentialStatus(paths),storage:{config:paths.config,data:paths.data}}));
  if (options.access) {
    app.get('/api/v1/admin/access',async()=>options.access!.snapshot());
    app.patch('/api/v1/admin/access',{schema:{body:{type:'object',additionalProperties:false,required:['publicOrigin'],properties:{publicOrigin:{type:['string','null'],minLength:1,maxLength:2048}}}}},handle(r=>options.access!.update(r.body.publicOrigin)));
  }
  app.patch('/api/v1/admin/credentials/:field',{schema:{body:{type:'object',additionalProperties:false,required:['value'],properties:{value:{anyOf:[{type:'string',minLength:1,maxLength:4096},{type:'null'}]}}}}},handle(r=>serialized(async()=>{
    const field=fieldOf(r.params.field),next=credentialValue(r.body.value),previous=credential(paths,field);
    if(next!==previous){
      const commit=()=>saveCredential(paths,field,next);
      if(options.changeCredential)await options.changeCredential(field,next,previous,commit);
      else{await options.beforeCredentialChange?.(field,next,previous);commit();}
      await options.credentialsChanged?.(field);
    }
    return {credentials:credentialStatus(paths)};
  })));
  app.post('/api/v1/admin/credentials/:field/check',handle(async r=>{
    const field=fieldOf(r.params.field),key=credential(paths,field);
    if(!key)throw Error('Save a key first.');
    let response:Response;
    try{response=await fetcher(checkUrls[field],{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw Error('Could not reach the provider. Check your connection and try again.');}
    await response.body?.cancel();
    if(response.status===401||response.status===403){recordCredentialCheck(paths,field,key,false);throw Error('The provider did not accept this key or its permissions.');}
    if(!response.ok)throw Error('The provider could not validate the key right now. Try again later.');
    recordCredentialCheck(paths,field,key,true);
    return {valid:true,credentials:credentialStatus(paths)};
  }));
  app.get('/api/v1/admin/loras',{schema:{querystring:modeQuery}},handle(r=>({items:loras.groups(r.query.mode??'sfw')})));
  app.patch('/api/v1/admin/loras/:id',handle(r=>imports.edit(r.params.id,r.body),202));
  app.post('/api/v1/admin/loras/inspect',{schema:{body:{type:'object',required:['url'],additionalProperties:false,properties:{url:{type:'string',maxLength:2048}}}}},handle(r=>imports.inspect(r.body.url)));
  app.post('/api/v1/admin/loras/import',handle(r=>imports.add(r.body),202));
  app.get('/api/v1/lora-imports',{schema:{querystring:modeQuery}},handle(r=>({items:imports.list(r.query.mode??'sfw')})));
  app.post('/api/v1/lora-imports/:id/retry',handle(r=>imports.retry(r.params.id),202));
}
