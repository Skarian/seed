// Keep the authenticated local control endpoint alive across SSH disconnects.
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

export function terminalSshError(text) {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(text)) return 'SSH host identity changed. Verify the rental and its host key before reconnecting; Seed will not remove trusted keys automatically.';
  if (/Permission denied \(.*publickey|Load key .*invalid format|no such identity:/i.test(text)) return 'SSH could not authenticate. Check the configured key and the rental public key before reconnecting.';
  if (/Address already in use|cannot listen to port|Could not request local forwarding/i.test(text)) return 'The local tunnel port is occupied. Stop the conflicting tunnel before reconnecting.';
  return null;
}

// Any HTTP response proves the tunnel carried traffic, even a worker error or 401.
export async function tunnelResponds() {
  try { await fetch('http://127.0.0.1:18080/worker/v1/status',{redirect:'manual',signal:AbortSignal.timeout(5000)}); return true; }
  catch { return false; }
}

export async function superviseTunnel(args,{startControl,spawnProcess=spawn,sleep=delay,now=Date.now,say=console.error,probe=tunnelResponds,probeInterval=10000}={}) {
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
      child=spawnProcess('ssh',args,{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
      let diagnostics='',fatal=null,misses=0,probing=false;
      child.stderr?.on('data',chunk=>{
        diagnostics=(diagnostics+chunk.toString()).slice(-8192);
        fatal=terminalSshError(diagnostics);
      });
      child.once('error',()=>say('Could not start SSH. Retrying the same tunnel.'));
      closed=new Promise(resolve=>child.once('close',resolve));
      const monitored=child;
      const timer=setInterval(async()=>{
        if(probing||stopping||monitored.exitCode!==null||monitored.killed)return;
        probing=true;
        try {
          const healthy=await probe();
          if(stopping||child!==monitored||monitored.killed)return;
          misses=healthy?0:misses+1;
          if(misses>=3){say('Worker transport stopped responding. Reopening the same SSH tunnel; remote jobs are unchanged.');monitored.kill();}
        } catch { /* A diagnostic bug must not kill a working connection. */ }
        finally {probing=false;}
      },probeInterval);
      timer.unref?.();
      let code;
      try {code=await closed;} finally {clearInterval(timer);}
      child=undefined;
      if(stopping)break;
      if(fatal){say(fatal);break;}
      if(diagnostics.trim())say(diagnostics.trim());
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
