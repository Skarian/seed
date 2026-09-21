import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import password from '@inquirer/password';
import type { StudioPaths } from '../storage.js';
import {credential} from '../credential-store.js';

function saved(paths:StudioPaths): Record<string,unknown> {
  try {const value=JSON.parse(readFileSync(path.join(paths.config,'credentials.json'),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw Error('Cannot read Seed credentials. Repair credentials.json before configuring Chat.');}
}
export function chatCredential(paths:StudioPaths, env:NodeJS.ProcessEnv=process.env) {
  return credential(paths,'openrouterApiKey',env);
}
export async function setupChatCredential(paths:StudioPaths, interactive:boolean, prompt = ()=>password({message:'OpenRouter API key for Chat (optional; Enter to skip):',mask:true})) {
  const values=saved(paths);
  const value=chatCredential(paths)||(interactive?(await prompt()).trim():'');
  if(!value)return false;
  if(/\s/.test(value))throw Error('Enter an OpenRouter token without whitespace.');
  values.openrouterApiKey=value;
  const file=path.join(paths.config,'credentials.json'),temporary=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(values,null,2),{mode:0o600,flag:'wx'});renameSync(temporary,file);}
  finally{rmSync(temporary,{force:true});}
  return true;
}
