import {vi} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import {WorkerPool} from '../server/pool.js';
import {Loras} from '../server/loras.js';
import type {StudioPaths} from '../server/storage.js';
import type {PoolDependencies,ProviderDriver,WorkerDriver,RentalResource,WorkerReceipt,WorkerOutput} from '../server/pool-contracts.js';
import type {Provider,WorkerClass} from '../shared/pool.js';
export function fakePool(db:Database.Database,paths:StudioPaths){
  let clock=Date.now();const resources=new Map<string,RentalResource>(),receipts=new Map<string,WorkerReceipt>();
  let output:Promise<{bytes:Buffer;entry:WorkerOutput}>|undefined;
  const image=()=>output??=(async()=>{const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#b06e39'}}).png().toBuffer();return {bytes,entry:{id:'0',path:'output.png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime_type:'image/png'}};})();
  const provider=(name:Provider)=>({
    configured:vi.fn(()=>true),
    offers:vi.fn<ProviderDriver['offers']>(async(role,requirements)=>[{offer:{id:`${name}-${role}`,provider:name,worker_class:role,gpu:role==='image'?'Fixture image GPU':'Fixture video GPU',vram_gb:96,region:'fixture',hourly:name==='vast'?1:2,compute_hourly:name==='vast'?1:2,storage_hourly:0,disk_gb:requirements.disk_gb,max_quantity:8,quoted_at:new Date(clock).toISOString(),expires_at:new Date(clock+600000).toISOString(),image:requirements.image,available:true},data:{}}]),
    create:vi.fn<ProviderDriver['create']>(async worker=>{const resource={id:'rental-'+worker.id,status:'RUNNING',created_at:new Date(clock).toISOString(),ssh:{host:'127.0.0.1',port:22,user:'root'},image:worker.offer.image,account_id:'fixture-account'};resources.set(worker.id,resource);return resource;}),
    find:vi.fn<ProviderDriver['find']>(async worker=>resources.get(worker.id)??null),
    destroy:vi.fn<ProviderDriver['destroy']>(async worker=>{resources.delete(worker.id);}),
    validateCredential:vi.fn<NonNullable<ProviderDriver['validateCredential']>>(async()=>{}),
  } satisfies ProviderDriver);
  const providers={vast:provider('vast'),runpod:provider('runpod')};
  const worker={
    preflight:vi.fn<WorkerDriver['preflight']>(async()=>{}),auth:vi.fn<WorkerDriver['auth']>(async()=>({public_key:'fixture-public',pairing_secret:'fixture-pairing'})),
    prepare:vi.fn<WorkerDriver['prepare']>(async record=>({ready:true,session_id:'session-'+record.id,installed_loras:record.requested_loras.map(l=>({filename:l.filename,sha256:l.sha256,routes:[l.route]})),preparation:{phase:'ready',bytes_done:0,bytes_total:0,files:[]},revision:record.preparation_revision})),
    probe:vi.fn<NonNullable<WorkerDriver['probe']>>(async record=>({state:'ready',session_id:record.session_id??'session-'+record.id,workspace_id:'workspace-'+record.id,worker_instance_id:'instance-'+record.id})),
    upload:vi.fn<WorkerDriver['upload']>(async()=>{}),
    submit:vi.fn<WorkerDriver['submit']>(async(record,body,options)=>{options?.beforePost?.();const id=String(body.prompt_id??body.job_id??body.id),{entry}=await image();receipts.set(id,{submission:{graph_digest:'fixture',job_id:id,workspace_id:'workspace-'+record.id,engine_session_id:record.session_id},manifest:{state:'completed',outputs:[entry]},manifest_digest:'fixture-digest'});}),
    receipt:vi.fn<WorkerDriver['receipt']>(async(_record,id)=>receipts.get(id)??null),
    cancel:vi.fn<WorkerDriver['cancel']>(async(_record,id)=>{receipts.set(id,{submission:{},manifest:{state:'cancelled',outputs:[]},manifest_digest:'fixture-digest'});}),
    download:vi.fn<WorkerDriver['download']>(async(_record,_id,_output,target)=>{await writeFile(target,(await image()).bytes);}),
    acknowledge:vi.fn<WorkerDriver['acknowledge']>(async()=>{}),reconnect:vi.fn<WorkerDriver['reconnect']>(async()=>{}),disconnect:vi.fn<WorkerDriver['disconnect']>(async()=>{}),close:vi.fn<WorkerDriver['close']>(async()=>{}),
  } satisfies WorkerDriver;
  const release={image:'fixture/image@sha256:'+'a'.repeat(64),disk_gb:200,manifest:[]};
  const deps:PoolDependencies={providers,worker,now:()=>clock,releases:{image:release,video:{...release,image:'fixture/video@sha256:'+'b'.repeat(64)}}};
  const pool=new WorkerPool(db,paths,new Loras(paths),deps);
  async function ready(role:WorkerClass='image',count=1,name:Provider='vast'){
    await pool.offers(role);await pool.launch({selections:[{offer_id:`${name}-${role}`,quantity:count}],max_hourly:count*(name==='vast'?1:2)},'fixture-launch-'+role+'-'+name+'-'+pool.all().length);await pool.tick();return pool.all().filter(w=>w.worker_class===role);
  }
  return {pool,providers,worker,deps,resources,receipts,ready,advance:(ms:number)=>{clock+=ms;}};
}
