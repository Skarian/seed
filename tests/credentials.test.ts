import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {ensureCredentials,webServerEnvironment} from '../server/credentials.js';
import {credential,credentialFields,saveCredential,credentialStatus,storedCredentials} from '../server/credential-store.js';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/credentials-'));roots.push(root);const paths=resolvePaths(root);prepareStorage(paths);return {root,paths,file:path.join(paths.config,'credentials.json')};}
it('setup needs no key, prompt, or local dotenv and preserves saved unrelated data',async()=>{
  const f=fixture(),prompt=vi.fn();writeFileSync(path.join(f.root,'.env'),'FAL_KEY=must-not-import');
  await ensureCredentials(f.paths,{interactive:true,prompt,env:{},cwd:f.root});expect(prompt).not.toHaveBeenCalled();expect(existsSync(f.file)).toBe(false);
  writeFileSync(f.file,JSON.stringify({openrouterApiKey:'existing',falKey:'legacy'}));await ensureCredentials(f.paths,{env:{FAL_KEY:'ignored'}});expect(JSON.parse(readFileSync(f.file,'utf8'))).toEqual({openrouterApiKey:'existing',falKey:'legacy'});
});
it('canonical saved values and explicit removal override environment and legacy names',()=>{
  const f=fixture();writeFileSync(f.file,JSON.stringify({civitaiApiToken:'old',vastApiKey:'saved'}));
  expect(credential(f.paths,'civitaiKey',{})).toBe('old');expect(storedCredentials(f.paths).civitaiKey).toBe('old');
  saveCredential(f.paths,'civitaiKey',null);expect(credential(f.paths,'civitaiKey',{CIVITAI_API_KEY:'env',CIVITAI_API_TOKEN:'legacy-env'})).toBe('');
  expect(credential(f.paths,'vastApiKey',{VAST_API_KEY:'env'})).toBe('saved');expect(credential(f.paths,'runpodApiKey',{RUNPOD_API_KEY:'env'})).toBe('env');
  expect(credentialStatus(f.paths,{})).not.toHaveProperty('falKey');
});
it('keeps resolver secrets private and rejects unknown or malformed writes',()=>{
  const f=fixture();for(const field of Object.keys(credentialFields))saveCredential(f.paths,field as keyof typeof credentialFields,null);
  saveCredential(f.paths,'runpodApiKey','fixture-private');expect(JSON.stringify(credentialStatus(f.paths,{}))).not.toContain('fixture-private');
  expect(()=>saveCredential(f.paths,'billingKey' as any,'x')).toThrow('Unknown');expect(()=>saveCredential(f.paths,'vastApiKey','space key')).toThrow('whitespace');
});
it('keeps supported environment fallbacks available to the detached server only',()=>{
  expect(webServerEnvironment({RUNPOD_API_KEY:'r',VAST_API_KEY:'v',HF_TOKEN:'h',CIVITAI_API_TOKEN:'c',OPENROUTER_API_KEY:'o',OTHER_SECRET:'drop',TS_AUTHKEY:'drop',PATH:'keep'})).toEqual({RUNPOD_API_KEY:'r',VAST_API_KEY:'v',HF_TOKEN:'h',CIVITAI_API_TOKEN:'c',OPENROUTER_API_KEY:'o',PATH:'keep'});
});
