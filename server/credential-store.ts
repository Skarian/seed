import {readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import path from 'node:path';
import type {StudioPaths} from './storage.js';
import type {CredentialField, CredentialStatuses} from '../shared/credentials.js';
export type {CredentialField} from '../shared/credentials.js';
export const credentialFields = {vastApiKey:'VAST_API_KEY',runpodApiKey:'RUNPOD_API_KEY',openrouterApiKey:'OPENROUTER_API_KEY',civitaiKey:'CIVITAI_API_KEY',huggingFaceToken:'HF_TOKEN'} as const;
const checks = new Map<string, { fingerprint: string; valid: boolean; at: string }>();
function writeCredentials(paths:StudioPaths,saved:Record<string,unknown>) {
  const file=path.join(paths.config,'credentials.json'),temporary=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(saved,null,2),{mode:0o600,flag:'wx'});renameSync(temporary,file);}finally{rmSync(temporary,{force:true});}
}
export function storedCredentials(paths:StudioPaths):Record<string,unknown>{
  let value: Record<string,unknown>;
  try{value=JSON.parse(readFileSync(path.join(paths.config,'credentials.json'),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw Error('Cannot read Seed credentials. Repair credentials.json before continuing.');}
  // Canonical null means explicitly removed, and must never resurrect a legacy key.
  if (!Object.hasOwn(value,'civitaiKey') && Object.hasOwn(value,'civitaiApiToken')) {
    value.civitaiKey=value.civitaiApiToken;
    writeCredentials(paths,value);
  }
  return value;
}
export function credential(paths:StudioPaths,field:CredentialField,env:NodeJS.ProcessEnv=process.env){
  const saved=storedCredentials(paths);
  const fallback=env[credentialFields[field]] ?? (field==='civitaiKey'?env.CIVITAI_API_TOKEN:undefined);
  const value=Object.hasOwn(saved,field)?saved[field]:fallback;
  return typeof value==='string'?value.trim():'';
}
const fingerprint=(value:string)=>createHash('sha256').update(value).digest('hex');
export function credentialStatus(paths:StudioPaths,env:NodeJS.ProcessEnv=process.env):CredentialStatuses {
  return Object.fromEntries(Object.keys(credentialFields).map(raw=>{
    const field=raw as CredentialField,value=credential(paths,field,env),check=checks.get(paths.config+'|'+field);
    return [field,{configured:Boolean(value),validation:check&&check.fingerprint===fingerprint(value)?check.valid?'valid':'invalid':'unchecked',...(check&&check.fingerprint===fingerprint(value)?{checked_at:check.at}:{})}];
  })) as CredentialStatuses;
}
export function recordCredentialCheck(paths:StudioPaths,field:CredentialField,value:string,valid:boolean) {
  checks.set(paths.config+'|'+field,{fingerprint:fingerprint(value),valid,at:new Date().toISOString()});
}
export function credentialValue(value:unknown):string|null {
  if(value!==null&&(typeof value!=='string'||!value.trim()||value.length>4096||/\s/.test(value.trim())))throw Error('Enter a key without whitespace.');
  return typeof value==='string'?value.trim():null;
}
export function saveCredential(paths:StudioPaths,field:CredentialField,value:unknown){
  if(!Object.hasOwn(credentialFields,field))throw Error('Unknown credential.');
  const next=credentialValue(value),saved=storedCredentials(paths);saved[field]=next;
  writeCredentials(paths,saved);
  checks.delete(paths.config+'|'+field);
}
