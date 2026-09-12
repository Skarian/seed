// Private config supplies the provider CLI's exact SSH argument array.
// Runs the same disposable CPU fixture beside the unopened production engine.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
export async function remoteFixture(config,fixture,secret){
  if(!Array.isArray(config.sshArgs)||!config.sshArgs.every(x=>typeof x==='string'))throw Error('remote config requires sshArgs');
  const directory='/var/lib/seed/ssh-test-'+process.pid;
  const python=code=>new Promise((resolve,reject)=>{
    const child=spawn('ssh',[...config.sshArgs,'cd /opt/seed && /opt/venv/bin/python -'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',error='';
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>error+=b);child.once('error',reject);child.once('close',status=>status?reject(Error('Remote fixture command failed: '+error.slice(-1000))):resolve(out.trim()));child.stdin.end(code);
  });
  const payload=Buffer.from(JSON.stringify({source:await readFile(fixture,'utf8'),secret,directory})).toString('base64');
  const pid=Number(await python(`import os,json,base64,subprocess\nfrom pathlib import Path\nv=json.loads(base64.b64decode('${payload}')); root=Path(v['directory']); root.mkdir(parents=True,exist_ok=True); file=root/'fixture.py'; file.write_text(v['source']); env=dict(os.environ,SEED_PAIRING_SECRET=v['secret'],SEED_TEST_NO_SSH='1',SEED_TEST_WORKSPACE=str(root/'workspace'),SEED_TEST_RUNTIME=str(root),SEED_TEST_WORKER_PORT='8081',SEED_TEST_ENGINE_PORT='8189'); log=open(root/'container.log','ab'); p=subprocess.Popen(['/opt/venv/bin/python',str(file)],cwd='/opt/seed',env=env,stdout=log,stderr=log,start_new_session=True); print(p.pid)`));
  if(!Number.isSafeInteger(pid)||pid<2)throw Error('Invalid test fixture pid');
  return {sshArgs:config.sshArgs,workerPort:8081,
    read:name=>python(`from pathlib import Path\nprint((Path('${directory}') / '${name}').read_text())`),
    stop:()=>python(`import os,signal\ntry: os.killpg(${pid},signal.SIGTERM)\nexcept ProcessLookupError: pass`),
  };
}
