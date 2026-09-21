import {test,expect,vi} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import {ensureCredentials,webServerEnvironment} from '../server/credentials.js';
test('fal setup preserves other saved keys and imports only FAL_KEY',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/fal-credentials-')),paths=resolvePaths(root);prepareStorage(paths);
 const file=path.join(paths.config,'credentials.json');writeFileSync(file,JSON.stringify({openrouterApiKey:'existing'}));writeFileSync(path.join(root,'.env'),'FAL_KEY=fixture-key\nOTHER_SECRET=ignored\n');
 await ensureCredentials(paths,{interactive:false,cwd:root,env:{}});expect(JSON.parse(readFileSync(file,'utf8'))).toEqual({openrouterApiKey:'existing',falKey:'fixture-key'});
 const prompt=vi.fn();await ensureCredentials(paths,{interactive:true,cwd:root,env:{},prompt});expect(prompt).not.toHaveBeenCalled();
 await ensureCredentials(paths,{interactive:false,cwd:root,env:{FAL_KEY:'new-key'}});expect(JSON.parse(readFileSync(file,'utf8')).falKey).toBe('new-key');
 expect(webServerEnvironment({FAL_KEY:'keep',OPENROUTER_API_KEY:'keep',FAL_BILLING_KEY:'remove',UNRELATED_API_KEY:'remove',PATH:'keep'})).toEqual({FAL_KEY:'keep',OPENROUTER_API_KEY:'keep',PATH:'keep'});
});
