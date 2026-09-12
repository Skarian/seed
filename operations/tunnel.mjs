// Keep the authenticated local control endpoint alive across SSH disconnects.
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

export async function superviseTunnel(args,{startControl,spawnProcess=spawn,sleep=delay,now=Date.now,say=console.error}={}) {
  let child,closed,closeControl,stopping=false;
  const retry=new AbortController();
  async function stop(){
    if(stopping)return;
    stopping=true;retry.abort();
    if(child&&child.exitCode===null&&!child.killed){child.kill();await closed;}
    await closeControl?.();
  }
  const signal=()=>void stop();
  for(const name of ['SIGINT','SIGTERM'])process.once(name,signal);
  try {
    closeControl=await startControl(stop);
    if(stopping){await closeControl();return;}
    let backoff=1000;
    while(!stopping){
      const started=now();
      child=spawnProcess('ssh',args,{shell:false,windowsHide:true,stdio:['ignore','ignore','inherit']});
      child.once('error',()=>say('Could not start SSH. Retrying the same tunnel.'));
      closed=new Promise(resolve=>child.once('close',resolve));
      const code=await closed;
      child=undefined;
      if(stopping)break;
      if(now()-started>=60000)backoff=1000;
      say(`SSH tunnel closed (exit ${code??'signal'}). Reconnecting in ${backoff/1000}s; pairing and jobs are unchanged.`);
      try {await sleep(backoff,undefined,{signal:retry.signal});}
      catch(error){if(!stopping)throw error;}
      backoff=Math.min(backoff*2,30000);
    }
  } finally {
    await stop();
    for(const name of ['SIGINT','SIGTERM'])process.removeListener(name,signal);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [repo,config,...args]=process.argv.slice(2);
  const {startControl}=await import(pathToFileURL(path.join(repo,'dist/server/lifecycle.js')).href);
  try {await superviseTunnel(args,{startControl:stop=>startControl({config},'http://127.0.0.1:18080',stop)});}
  catch {console.error('Tunnel supervisor stopped unexpectedly. Run seed gpu vast reconnect.');process.exitCode=1;}
}
