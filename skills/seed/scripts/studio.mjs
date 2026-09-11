// Uses the existing local-worker seam; no change to public endpoint validation.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=path.resolve(process.argv[2]);
const load=file=>import(pathToFileURL(path.join(repo,'dist/server',file)).href);
const {createApp}=await load('http.js');
const {resolvePaths}=await load('storage.js');
const {settings}=await load('settings.js');
const {startControl}=await load('lifecycle.js');
const paths=resolvePaths(),config=settings(paths);
const app=await createApp({paths,port:config.port,host:config.host,localTestWorkerOrigin:'http://127.0.0.1:18080'});
let closeControl,stopping=false;
async function stop(){if(stopping)return;stopping=true;await app.close();await closeControl?.();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());
await app.listen({host:config.host,port:config.port});
closeControl=await startControl(paths,`http://${config.host}:${config.port}`,stop);
console.log(`Seed: http://${config.host}:${config.port}`);
