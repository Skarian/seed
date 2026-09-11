// A small authenticated supervisor, using Seed's existing local lifecycle protocol.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const [repo,config,...args]=process.argv.slice(2);
const {startControl}=await import(pathToFileURL(path.join(repo,'dist/server/lifecycle.js')).href);
let child,closeControl,stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  if(child&&child.exitCode===null&&!child.killed){
    const exited=new Promise(resolve=>child.once('close',resolve));child.kill();await exited;
  }
  await closeControl?.();
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());
try{
  child=spawn('ssh',args,{shell:false,windowsHide:true,stdio:['ignore','ignore','inherit']});
  child.once('error',()=>{process.exitCode=1;void stop();});
  child.once('close',code=>{if(code&&!stopping)process.exitCode=1;void stop();});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  closeControl=await startControl({config},'http://127.0.0.1:18080',stop);
  if(stopping)await closeControl();
}catch{process.exitCode=1;await stop();}
