import {expect,it,vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {WorkerConnection} from '../server/worker.js';
import {PoolWorkerDriver} from '../server/pool-worker.js';
import {Diagnostics} from '../server/diagnostics.js';
import {openDatabase} from '../server/db.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import type {RentalRecord} from '../server/pool-contracts.js';

const worker = {id:'worker-fixture',worker_class:'image',session_id:'engine-fixture'} as RentalRecord;
const envelope = {prompt_id:'cbe792a7-8e18-486f-87f4-7c90c9234694',prompt:{private_fixture:'synthetic-private-graph'},route:'image',loras:[]};
async function fixture(run:(f:{
  connection:WorkerConnection; driver:PoolWorkerDriver;
  state:{stall:boolean;identity:Record<string,unknown>;postStatus:number;postBody:string;statusGate?:Promise<void>};
  requests:Array<{method:string;url:string}>;posts:unknown[];
  events:()=>Array<{stage:string;outcome:string;post_invoked:boolean;error_class?:string;status?:number}>;
})=>Promise<void>){
  mkdirSync('.local/tests',{recursive:true});
  const root=mkdtempSync(path.resolve('.local/tests/worker-submission-'));
  const paths=resolvePaths(root);prepareStorage(paths);const db=openDatabase(paths.data);
  const requests:Array<{method:string;url:string}>=[],posts:unknown[]=[];
  const state={stall:false,identity:{} as Record<string,unknown>,postStatus:200,postBody:'{}',statusGate:undefined as Promise<void>|undefined};
  const server=createServer((req,res)=>{
    requests.push({method:req.method!,url:req.url!});
    if(req.url==='/worker/v1/status'){
      if(state.stall)return;
      void (state.statusGate ?? Promise.resolve()).then(()=>{
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({protocol_version:2,runtime_revision:'seed-pool-v1',worker_class:'image',
          worker_instance_id:'instance-fixture',workspace_id:'workspace-fixture',state:'ready',
          engine_session_id:'engine-fixture',active_prompt_id:null,preparation:{phase:'ready'},...state.identity}));
      });
      return;
    }
    if(req.url==='/comfy/prompt'&&req.method==='POST'){
      let raw='';req.setEncoding('utf8');req.on('data',chunk=>{raw+=chunk;});
      req.on('end',()=>{posts.push(JSON.parse(raw));res.writeHead(state.postStatus,{'Content-Type':'application/json'});res.end(state.postBody);});
      return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const savedConnection=JSON.stringify({
    endpoint:origin,worker_credential:'synthetic-worker-credential-'.repeat(3),
    worker_instance_id:'instance-fixture',workspace_id:'workspace-fixture',protocol_version:2,
  });
  writeFileSync(path.join(paths.config,'worker-connection.json'),savedConnection);
  const workerDirectory=path.join(paths.config,'workers',worker.id);mkdirSync(workerDirectory,{recursive:true});
  writeFileSync(path.join(workerDirectory,'worker-connection.json'),savedConnection);
  const connection=new WorkerConnection(paths,origin),driver=new PoolWorkerDriver(paths,new Diagnostics(db,paths));
  vi.spyOn(driver as any,'connection').mockResolvedValue(connection);
  const events=()=>db.prepare("SELECT data_json FROM diagnostic_events WHERE operation='submission.transport' ORDER BY id").all()
    .map(row=>JSON.parse((row as {data_json:string}).data_json));
  try{await run({connection,driver,state,requests,posts,events});}
  finally{
    await driver.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    vi.restoreAllMocks();db.close();rmSync(root,{recursive:true,force:true});
  }
}

it('distinguishes a cached verification timeout from an invoked POST and recovers with a fresh read-only probe',()=>fixture(async f=>{
  const timeout=AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>timeout(ms===7000?30:ms));
  f.state.stall=true;
  expect(await f.connection.status()).toBeNull();
  await expect(f.driver.submit(worker,envelope)).rejects.toMatchObject({name:'TimeoutError'});
  expect(f.requests).toEqual([{method:'GET',url:'/worker/v1/status'}]);
  expect(f.posts).toEqual([]);
  const firstFailure=f.events().find(event=>event.outcome==='failed');
  expect(firstFailure).toMatchObject({stage:'identity_verification',post_invoked:false,error_class:'TimeoutError'});
  f.state.stall=false;
  expect(await f.driver.probe(worker)).toEqual({state:'ready',session_id:'engine-fixture',active_job_id:undefined,
    workspace_id:'workspace-fixture',worker_instance_id:'instance-fixture'});
  await f.driver.submit(worker,envelope);
  expect(f.posts).toEqual([envelope]);
  expect(f.requests).toEqual([{method:'GET',url:'/worker/v1/status'},{method:'GET',url:'/worker/v1/status'},{method:'POST',url:'/comfy/prompt'}]);
  expect(f.events()).toContainEqual(firstFailure);
  expect(f.events()).toContainEqual(expect.objectContaining({stage:'submission_post',outcome:'invoked',post_invoked:true}));
  expect(JSON.stringify(f.events())).not.toContain('synthetic-private-graph');
}));

it.each(['workspace_id','worker_instance_id'])('fresh probing rejects changed %s even after a successful cached status',key=>fixture(async f=>{
  expect(await f.connection.status()).toMatchObject({state:'ready'});
  f.state.identity[key]='different-identity';
  await expect(f.driver.probe(worker)).rejects.toMatchObject({issue:{code:'connection_failed'}});
  await expect(f.driver.submit(worker,envelope)).rejects.toThrow('identity');
  expect(f.requests).toEqual([{method:'GET',url:'/worker/v1/status'},{method:'GET',url:'/worker/v1/status'}]);
  expect(f.posts).toEqual([]);
  expect(f.events().at(-1)).toMatchObject({stage:'identity_verification',post_invoked:false,error_class:'TransferIntegrityError'});
}));

it('records an invoked POST rejection without retaining its private response body',()=>fixture(async f=>{
  const marker='synthetic-private-response';f.state.postStatus=409;f.state.postBody=JSON.stringify({error:marker,prompt:marker,credential:marker});
  await expect(f.driver.submit(worker,envelope)).rejects.toMatchObject({status:409});
  expect(f.posts).toEqual([envelope]);
  expect(f.events().at(-1)).toMatchObject({stage:'submission_post',outcome:'failed',post_invoked:true,error_class:'WorkerHttpError',status:409});
  const saved=JSON.stringify(f.events());
  expect(saved).not.toContain(marker);expect(saved).not.toContain('synthetic-private-graph');
}));

it('runs the final cancellation fence after asynchronous verification and prevents the HTTP POST',()=>fixture(async f=>{
  let release!:()=>void, cancelled=false;
  f.state.statusGate=new Promise<void>(resolve=>{release=resolve;});
  const beforePost=vi.fn(()=>{if(cancelled)throw Error('Request was cancelled before submission.');});
  const submitted=f.driver.submit(worker,envelope,{beforePost});
  try{
    await vi.waitFor(()=>expect(f.requests).toEqual([{method:'GET',url:'/worker/v1/status'}]));
    expect(beforePost).not.toHaveBeenCalled();
    cancelled=true;release();
    await expect(submitted).rejects.toThrow('cancelled before submission');
    expect(beforePost).toHaveBeenCalledOnce();
    expect(f.requests).toEqual([{method:'GET',url:'/worker/v1/status'}]);
    expect(f.posts).toEqual([]);
    expect(f.events().at(-1)).toMatchObject({stage:'submission_gate',outcome:'failed',post_invoked:false});
  }finally{release();await submitted.catch(()=>{});}
}));

it('allowlists error classes instead of retaining arbitrary exception names or details',()=>fixture(async f=>{
  const marker='synthetic-private-error';
  vi.spyOn(f.connection,'json').mockRejectedValue(Object.assign(new Error(marker,{cause:{body:marker}}),{name:marker}));
  await expect(f.driver.submit(worker,envelope)).rejects.toMatchObject({name:marker});
  expect(f.events().at(-1)).toMatchObject({stage:'identity_verification',outcome:'failed',post_invoked:false,error_class:'UnknownError'});
  expect(JSON.stringify(f.events())).not.toContain(marker);
  expect(f.posts).toEqual([]);
}));
