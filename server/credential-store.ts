import {readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {StudioPaths} from './storage.js';
export const credentialFields={falKey:'FAL_KEY',openrouterApiKey:'OPENROUTER_API_KEY',civitaiKey:'CIVITAI_API_KEY'} as const;
export type CredentialField=keyof typeof credentialFields;
export function storedCredentials(paths:StudioPaths):Record<string,unknown>{
  try{const value=JSON.parse(readFileSync(path.join(paths.config,'credentials.json'),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw Error('Cannot read Seed credentials. Repair credentials.json before continuing.');}
}
export function credential(paths:StudioPaths,field:CredentialField,env:NodeJS.ProcessEnv=process.env){
  const saved=storedCredentials(paths);const value=Object.hasOwn(saved,field)?saved[field]:env[credentialFields[field]];
  return typeof value==='string'?value.trim():'';
}
export function credentialStatus(paths:StudioPaths){return Object.fromEntries(Object.keys(credentialFields).map(field=>[field,{configured:Boolean(credential(paths,field as CredentialField))}]));}
export function saveCredential(paths:StudioPaths,field:CredentialField,value:unknown){
  if(!Object.hasOwn(credentialFields,field))throw Error('Unknown credential.');
  if(value!==null&&(typeof value!=='string'||!value.trim()||value.length>4096||/\s/.test(value.trim())))throw Error('Enter a key without whitespace.');
  const saved=storedCredentials(paths);saved[field]=typeof value==='string'?value.trim():null;
  const file=path.join(paths.config,'credentials.json'),temporary=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(saved,null,2),{mode:0o600,flag:'wx'});renameSync(temporary,file);}finally{rmSync(temporary,{force:true});}
}
