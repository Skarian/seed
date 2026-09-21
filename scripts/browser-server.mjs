import {createApp} from '../dist/server/http.js';
import {resolvePaths} from '../dist/server/storage.js';
import {offlineProviders} from './offline-providers.mjs';
const paths=resolvePaths(process.env.STUDIO_DEV_ROOT);
const host=process.env.SEED_QA_HOST??'127.0.0.1',port=Number(process.env.SEED_QA_PORT??4311);
const app=await createApp({paths,host,port,...await offlineProviders(paths)});
await app.listen({host,port});
process.send?.('ready');
process.once('message',async()=>{await app.close();process.disconnect();});
