import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Loras} from '../server/loras.js';
import {LoraImports,civitaiLocation} from '../server/lora-imports.js';
import {credentialFields} from '../server/credential-store.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/source-import-'));roots.push(root);
  const paths=resolvePaths(root);prepareStorage(paths);
  writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({...Object.fromEntries(Object.keys(credentialFields).map(k=>[k,null])),civitaiKey:'fixture-civitai'}));
  const version={id:10,modelId:5,name:'v1',baseModel:'Krea 2',model:{name:'Watercolor',type:'LORA'},trainedWords:['watercolor'],files:[{id:20,name:'arbitrary.safetensors',sizeKB:1024,hashes:{SHA256:'a'.repeat(64)},downloadUrl:'https://civitai.com/api/download/models/10?format=SafeTensor'}]};
  const fetcher=vi.fn<typeof fetch>(async(url,init)=>{expect(String(url)).toBe('https://civitai.com/api/v1/model-versions/10');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-civitai');return Response.json(version);});
  const loras=new Loras(paths),imports=new LoraImports(paths,loras,fetcher);
  const input={version_id:10,files:[{file_id:20,route:'image'}],mode:'sfw',name:'Watercolor',description:'Gentle color',default_scale:.8,trigger_words:['watercolor']};
  return {root,paths,version,fetcher,loras,imports,input};
}
it('only accepts supported Civitai page URLs',()=>{
  expect(civitaiLocation('https://civitai.com/models/5?modelVersionId=10')).toEqual({modelId:5,versionId:10});
  for(const url of ['http://civitai.com/models/1','https://evil.test/models/1','https://civitai.com@evil.test/models/1','https://civitai.com/api/v1/me'])expect(()=>civitaiLocation(url)).toThrow();
});
it('Apply pins metadata without downloading, uploading, or creating local adapter files',async()=>{
  const f=fixture();const preview=await f.imports.inspect('https://civitai.com/models/5?modelVersionId=10');expect(preview.versions[0]!.family).toBe('krea2');
  const activity=await f.imports.add(f.input);expect(activity.state).toBe('ready');expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(existsSync(path.join(f.paths.data,'loras'))).toBe(false);
  const entry=f.loras.list('sfw')[0]!;expect(entry).toMatchObject({name:'Watercolor',availability:'all',source_status:'ready',compatibility:'untested'});expect(entry).not.toHaveProperty('file');
  expect(f.loras.manifestSources('image')).toMatchObject([{name:'Watercolor',revision:'a'.repeat(64),path:`loras/seed-${'a'.repeat(64)}.safetensors`,source:{model_id:5,version_id:10,file_id:20}}]);
  expect(f.loras.manifestSources('video')).toEqual([]);expect(f.loras.list('nsfw')).toHaveLength(1);
  expect(JSON.stringify(activity)).not.toContain('fixture-civitai');await f.imports.close();
});
it('supports explicit mapping of one file to both video workflows without guessing names',async()=>{
  const f=fixture();f.version.baseModel='MiniMax H3';const input={...f.input,files:[{file_id:20,route:'fl'},{file_id:20,route:'ref'}]};
  await f.imports.add(input);expect(f.loras.groups('sfw')).toHaveLength(1);expect(f.loras.groups('sfw')[0]!.files.map(f=>f.route)).toEqual(['fl','ref']);
  expect(f.loras.manifestSources('video')).toHaveLength(2);
  await expect(f.imports.add({...input,files:[{file_id:20,route:'fl'},{file_id:20,route:'fl'}]})).rejects.toThrow('one file');
  await expect(f.imports.add({...input,files:[{file_id:20,route:'image'}]})).rejects.toThrow('one file');
});
it('rejects unsupported families, missing hashes, invalid source hosts and wrong version responses atomically',async()=>{
  const f=fixture();await f.imports.add(f.input);const original=f.loras.all();
  f.version.baseModel='Other';await expect(f.imports.add(f.input)).rejects.toThrow('not supported');f.version.baseModel='Krea 2';
  f.version.files[0]!.hashes.SHA256='invalid';await expect(f.imports.add(f.input)).rejects.toThrow('checksum');f.version.files[0]!.hashes.SHA256='a'.repeat(64);
  f.version.files[0]!.downloadUrl='https://evil.test/file';await expect(f.imports.add(f.input)).rejects.toThrow('unsupported adapter source');
  f.version.id=11;await expect(f.imports.add(f.input)).rejects.toThrow('different model version');expect(f.loras.all()).toEqual(original);
});
it('strips token query strings and preserves only immutable download selectors',async()=>{
  const f=fixture();f.version.files[0]!.downloadUrl+='&token=private-token&fp=bf16';await f.imports.add(f.input);
  const stored=readFileSync(path.join(f.paths.config,'loras.json'),'utf8');expect(stored).not.toContain('private-token');expect(f.loras.manifestSources('image')[0]!.url).toBe('https://civitai.com/api/download/models/10?fileId=20');
});
it('pins different files from the same Civitai version to distinct worker URLs',async()=>{
  const f=fixture();f.version.baseModel='MiniMax H3';
  f.version.files[0]!.downloadUrl='https://civitai.com/api/download/models/10';
  f.version.files.push({...f.version.files[0]!,id:21,name:'second.safetensors',hashes:{SHA256:'b'.repeat(64)}});
  await f.imports.add({...f.input,files:[{file_id:20,route:'fl'},{file_id:21,route:'ref'}]});
  expect(f.loras.manifestSources('video').map(s=>s.url)).toEqual([
    'https://civitai.com/api/download/models/10?fileId=20',
    'https://civitai.com/api/download/models/10?fileId=21',
  ]);
});
it('edits metadata and mappings for later launches while old launch snapshots stay immutable',async()=>{
  const f=fixture();f.version.baseModel='MiniMax H3';await f.imports.add({...f.input,files:[{file_id:20,route:'fl'}]});
  const before=f.loras.manifestSources('video'),group=f.loras.groups('sfw')[0]!;
  f.imports.edit(group.id,{...f.input,name:'Changed',files:[{id:group.files[0]!.id,route:'ref'}],enabled:true});
  expect(before[0]).toMatchObject({name:'Watercolor',route:'fl'});expect(f.loras.manifestSources('video')[0]).toMatchObject({name:'Changed',route:'ref',revision:'a'.repeat(64)});
  const current=f.loras.groups('sfw')[0]!;f.imports.edit(current.id,{...f.input,files:current.files.map(file=>({id:file.id,route:file.route})),enabled:false});expect(f.loras.manifestSources('video')).toEqual([]);
});
it('preserves old local files and receipts while recovering only trustworthy pinned metadata',async()=>{
  const f=fixture(),binary=path.join(f.paths.data,'original.safetensors');writeFileSync(binary,'untouched-original');
  const entry={id:'legacy',name:'Legacy',revision:'a'.repeat(64),route:'image',file:binary,format:'lora',compatibility:'verified',upload:{url:'https://fal.test/private',expires_at:'2099-01-01'},source_url:'https://civitai.com/models/5?modelVersionId=10'};
  writeFileSync(path.join(f.paths.config,'loras.json'),JSON.stringify([entry,{...entry,id:'converted',revision:'b'.repeat(64),conversion:'h3-kohya-v1'}]));
  writeFileSync(path.join(f.paths.config,'lora-imports.json'),JSON.stringify([{id:'old',state:'ready',mode:'sfw',name:'Legacy',source_url:entry.source_url,version_id:10,files:[{lora_id:'legacy',sha256:entry.revision,file_id:20,download_url:f.version.files[0]!.downloadUrl,total:1024}]}]));
  const entries=f.loras.all();expect(entries[0]).toMatchObject(entry);expect(entries[0]!.source?.file_id).toBe(20);expect(f.loras.list()[1]!.source_status).toBe('needs_source');expect(readFileSync(binary,'utf8')).toBe('untouched-original');expect(f.fetcher).not.toHaveBeenCalled();
});
it('retains interrupted legacy imports as actionable history without resuming binary transfers',async()=>{
  const f=fixture();writeFileSync(path.join(f.paths.config,'lora-imports.json'),JSON.stringify([{id:'old',state:'downloading',mode:'sfw',name:'Old',created_at:'2026-01-01',files:[{name:'file',route:'image',state:'downloading',bytes:1,total:2}]}]));
  const restored=new LoraImports(f.paths,f.loras,f.fetcher);expect(restored.list('sfw')[0]).toMatchObject({state:'failed'});expect(restored.busy()).toBe(false);expect(f.fetcher).not.toHaveBeenCalled();await expect(restored.retry('old')).rejects.toThrow('Add the Civitai version again');await restored.close();
});
it('standard sources are visible in both modes and private catalog entries retain visibility rules',async()=>{
  const f=fixture();await f.imports.add({...f.input,mode:'nsfw'});expect(f.loras.list('sfw')).toEqual([]);expect(f.imports.list('sfw')).toEqual([]);expect(f.loras.list('nsfw')).toHaveLength(1);expect(f.loras.manifestSources('image')).toHaveLength(1);
});
