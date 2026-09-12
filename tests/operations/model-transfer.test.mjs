import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transferModels,sshTransfer} from '../../operations/model-transfer.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough,Readable} from 'node:stream';

test('failed input waits for the SSH child to close before returning',{timeout:5000},async()=>{
  const child=new EventEmitter();
  child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const killed=Promise.withResolvers();child.kill=()=>{killed.resolve();return true;};
  const input=Readable.from((async function*(){throw Error('fixture input failed');})());
  let returned=false;
  const checked=assert.rejects(sshTransfer([],'test',input,()=>child),/fixture input failed/).then(()=>{returned=true;});
  await killed.promise;await new Promise(setImmediate);
  assert.equal(returned,false);
  child.emit('close',1);await checked;
});

async function laneFixture(t,{sharedHash=false}={}){
  const root=await mkdtemp(path.join(tmpdir(),'seed-lanes-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const config=path.join(root,'config'),dist=path.join(root,'dist/server');
  await mkdir(config);await mkdir(dist,{recursive:true});
  await writeFile(path.join(root,'package.json'),'{"type":"module"}');
  const items=[
    {path:'vae/base.safetensors',sha256:'a'.repeat(64)},
    {path:'vae/next.safetensors',sha256:'b'.repeat(64)},
    {path:'loras/preset.safetensors',sha256:(sharedHash?'a':'c').repeat(64),route:'image'},
  ].map(item=>({...item,size:5,url:'https://huggingface.co/o/r/resolve/'+'a'.repeat(40)+'/file.safetensors'}));
  await writeFile(path.join(dist,'model-cache.js'),`export const modelManifest=async()=>${JSON.stringify(items)};`);
  await writeFile(path.join(dist,'settings.js'),'export const settings=()=>({localModelCache:false});');
  const actions=[];
  const invoke=download=>async(command,stream)=>{
    let data='';for await(const chunk of stream)data+=chunk.toString();
    if(command.startsWith('umask'))return '';
    const request=JSON.parse(data);actions.push(request.action);
    if(request.action==='probe')return JSON.stringify(items.map(item=>({path:item.path,ready:false,offset:0})));
    if(request.action==='activate')return '{"presets":1}';
    return JSON.stringify(await download(request.item));
  };
  return {root,config,items,actions,invoke};
}

test('base and preset lanes overlap and activation waits for both',{timeout:5000},async t=>{
  const f=await laneFixture(t),base=Promise.withResolvers(),preset=Promise.withResolvers(),bothStarted=Promise.withResolvers();
  const started=[];
  const work=transferModels(f.root,{config:f.config},[],{say:()=>{},invoke:f.invoke(async item=>{
    started.push(item.path);if(started.length===2)bothStarted.resolve();
    await (item.route?preset.promise:base.promise);
    return {ready:true,seconds:1};
  })});
  await bothStarted.promise;
  assert.deepEqual(started,[f.items[0].path,f.items[2].path]);
  assert.ok(!f.actions.includes('activate'));
  base.resolve();await new Promise(setImmediate);
  assert.ok(!f.actions.includes('activate'));
  preset.resolve();await work;
  assert.equal(f.actions.at(-1),'activate');
});

test('failed lane joins in-flight work and skips activation and new transfers',{timeout:5000},async t=>{
  const f=await laneFixture(t),base=Promise.withResolvers(),failed=Promise.withResolvers();
  const started=[];let returned=false;
  const work=transferModels(f.root,{config:f.config},[],{say:()=>{},invoke:f.invoke(async item=>{
    started.push(item.path);
    if(item.route){failed.resolve();throw Error('fixture failure');}
    await base.promise;return {ready:true};
  })});
  const checked=assert.rejects(work,/fixture failure/).then(()=>{returned=true;});
  await failed.promise;await new Promise(setImmediate);
  assert.equal(returned,false);
  base.resolve();await checked;
  assert.deepEqual(started,[f.items[0].path,f.items[2].path]);
  assert.ok(!f.actions.includes('activate'));
});

test('shared hash staging across lanes is serialized',{timeout:5000},async t=>{
  const f=await laneFixture(t,{sharedHash:true});let active=0,maxActive=0;
  await transferModels(f.root,{config:f.config},[],{say:()=>{},invoke:f.invoke(async()=>{
    active++;maxActive=Math.max(maxActive,active);await new Promise(setImmediate);active--;
    return {ready:true};
  })});
  assert.equal(maxActive,1);assert.equal(f.actions.at(-1),'activate');
});

for (const scenario of ['warm','direct','fallback-cached','fallback-missing','disabled']) {
  test(`model preparation: ${scenario}`,async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'seed-download-'));
    const config=path.join(root,'config'); const dist=path.join(root,'dist/server');
    await mkdir(config);await mkdir(dist,{recursive:true});
    await writeFile(path.join(root,'package.json'),'{"type":"module"}');
    const item={path:'vae/test.safetensors',url:'https://huggingface.co/o/r/resolve/'+'a'.repeat(40)+'/test.safetensors',size:5,sha256:'b'.repeat(64)};
    const file=path.join(root,'model');await writeFile(file,'model');
    await writeFile(path.join(config,'credentials.json'),JSON.stringify({huggingFaceToken:'fixture-source-secret',vastApiKey:'never-send-provider'}));
    await writeFile(path.join(dist,'settings.js'),`export const settings=()=>({localModelCache:${scenario!=='disabled'}});`);
    await writeFile(path.join(dist,'model-cache.js'),`export const calls=[];export const modelManifest=async()=>${JSON.stringify([item])};export const modelFile=()=>${JSON.stringify(file)};export const cached=async()=>${scenario!=='fallback-missing'};export const downloadModel=async()=>calls.push('local-download');`);
    const actions=[], output=[];
    const invoke=async(command,stream)=>{
      let data='';for await(const b of stream)data+=b.toString();
      if(command.startsWith('umask')){assert.ok(!data.includes('fixture-source-secret'));return '';}
      assert.ok(!command.includes('fixture-source-secret'));
      const request=JSON.parse(data.split('\n')[0]);actions.push(request.action);
      assert.ok(!data.includes('never-send-provider'));
      if(request.action==='download'){
        assert.equal(request.token,'fixture-source-secret');
        return JSON.stringify({ready:scenario==='direct',seconds:1,error_type:'HTTPError',http_status:403,error:'fixture-source-secret'});
      }
      assert.ok(!data.includes('fixture-source-secret'));
      if(request.action==='probe')return JSON.stringify([{path:item.path,ready:scenario==='warm',offset:0}]);
      if(request.action==='receive'){assert.equal(data.split('\n')[1],'model');return '{}';}
      if(request.action==='activate')return '{"presets":0}';
      throw Error('unexpected action');
    };
    try {
      const promise=transferModels(root,{config},[],{invoke,say:s=>output.push(s)});
      if(scenario==='disabled')await assert.rejects(promise,/fallback is disabled/);else await promise;
      assert.deepEqual(actions,scenario==='warm'?['probe','activate']:scenario==='direct'?['probe','download','activate']:scenario==='disabled'?['probe','download']:['probe','download','receive','activate']);
      const {calls}=await import(pathToFileURL(path.join(dist,'model-cache.js')));
      assert.equal(calls.length,scenario==='fallback-missing'?1:0);
      assert.ok(!output.join('').includes('fixture-source-secret'));
      if(scenario.startsWith('fallback') || scenario==='disabled')assert.match(output.join(' '),/HTTPError, HTTP 403/);
    } finally {await rm(root,{recursive:true,force:true});}
  });
}
