import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transferModels} from '../../operations/model-transfer.mjs';

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
        return JSON.stringify({ready:scenario==='direct',seconds:1});
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
    } finally {await rm(root,{recursive:true,force:true});}
  });
}
