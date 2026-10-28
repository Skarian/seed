/** Child process used only by the real Windows integration test. */
import path from 'node:path';
import {createApp} from '../dist/server/http.js';
import {resolvePaths} from '../dist/server/storage.js';
import {openDatabase} from '../dist/server/db.js';
import {LocalWorker} from '../dist/server/local-worker.js';
const paths=resolvePaths(process.env.SEED_TEST_ROOT),port=Number(process.env.SEED_TEST_PORT);
const app=await createApp({paths,port,webRoot:path.resolve('dist/web')});
const db=openDatabase(paths.data),pool=app.seedPool;
await pool.local.close();
// This fixture's boundary is isolated from the public qualification manifest.
pool.local=new LocalWorker(db,paths,{boundaries:[
  ...['image-768','2mp'].map(size=>({workflow:'text-to-image',route:'image',size,aspect:'16:9',max_references:0,profile:'krea-turbo-int8-v1'})),
  {workflow:'text-to-video',route:'fl',size:'480p',aspect:'16:9',duration_seconds:5,max_references:0,profile:'h3-official-30-v1'},
]});
const original=pool.executionDriver.bind(pool);let checkpoint=false;
pool.executionDriver=worker=>{
  const driver=original(worker);
  return {...driver,submit:async(...args)=>{await driver.submit(...args);if(!checkpoint&&process.env.SEED_TEST_CHECKPOINT==='engine-interrupted'){checkpoint=true;process.send({checkpoint:true,ownership:pool.local.runtime.ownership});}},
    acknowledge:async(...args)=>{if(!checkpoint&&process.env.SEED_TEST_CHECKPOINT==='saved-before-ack'){checkpoint=true;process.send({checkpoint:true,ownership:pool.local.runtime.ownership});await new Promise(()=>{});}return driver.acknowledge(...args);}};
};
process.on('message',async message=>{if(message==='close'){await app.close();db.close();process.exit(0);}});
await app.listen({host:'127.0.0.1',port});process.send({ready:true});
