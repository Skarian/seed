import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {uploadModel} from '../../operations/preparation-upload.mjs';

async function fixture(run){
 const root=await mkdtemp(path.join(os.tmpdir(),'seed-tus-attempt-'));
 const data=randomBytes(2*1024*1024),file=path.join(root,'model.bin');await writeFile(file,data);
 const state={bytes:Buffer.alloc(0),patches:0,stall:true,heads:[],disconnects:0};
 const server=createServer((req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-secret');
  res.setHeader('Tus-Resumable','1.0.0');
  if(req.method==='HEAD'){state.heads.push(state.bytes.length);res.writeHead(200,{'Upload-Offset':String(state.bytes.length),'Upload-Length':String(data.length)});res.end();return;}
  assert.equal(req.method,'PATCH');state.patches++;
  assert.equal(Number(req.headers['upload-offset']),state.bytes.length);
  req.on('data',chunk=>{state.bytes=Buffer.concat([state.bytes,chunk]);if(state.stall)req.pause();});
  req.on('end',()=>{res.writeHead(204,{'Upload-Offset':String(state.bytes.length)});res.end();});
  req.on('error',()=>{});req.on('close',()=>state.disconnects++);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const connection={endpoint:'http://127.0.0.1:'+server.address().port,worker_credential:'test-secret'};
 try{await run({data,file,state,connection});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
}

test('real tus attempt aborts a stalled body; next attempt HEAD-resumes saved bytes',()=>fixture(async({data,file,state,connection})=>{
 await assert.rejects(uploadModel(connection,'/upload',file,data.length,{idleMs:100}),error=>error.retryable&&/progress/.test(error.message));
 const partial=state.bytes.length;assert.ok(partial>0&&partial<data.length);
 state.stall=false;
 await uploadModel(connection,'/upload',file,data.length,{idleMs:1000});
 assert.equal(state.patches,2);assert.deepEqual(state.heads,[0,partial]);assert.deepEqual(state.bytes,data);
}));

test('aborting a stalled tus attempt rejects with cancellation, retaining remote bytes',()=>fixture(async({data,file,state,connection})=>{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100);
 try{await assert.rejects(uploadModel(connection,'/upload',file,data.length,{signal:controller.signal,idleMs:2000}),{name:'AbortError'});}
 finally{clearTimeout(timer);}
 assert.ok(state.bytes.length>0);assert.equal(state.patches,1);
}));

test('a missing local model is a terminal failure, not an endless network retry',()=>fixture(async({data,file,state,connection})=>{
 await rm(file);
 await assert.rejects(uploadModel(connection,'/upload',file,data.length,{idleMs:1000}),error=>error.retryable===false&&/local|file/i.test(error.message));
}));
