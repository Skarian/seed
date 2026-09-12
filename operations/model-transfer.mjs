import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

export async function transferModels(repo, paths, ssh, {workspace='/workspace',say=console.error,invoke:providedInvoke}={}) {
  const {modelManifest,modelFile,cached,downloadModel}=await import(pathToFileURL(path.join(repo,'dist/server/model-cache.js')));
  const entries=await modelManifest(paths);
  const {settings}=await import(pathToFileURL(path.join(repo,'dist/server/settings.js')));
  const fallback=settings(paths).localModelCache === true;
  let credentials={};
  try { credentials=JSON.parse(await readFile(path.join(paths.config,'credentials.json'),'utf8')); }
  catch(error) { if(error.code !== 'ENOENT') throw Error('Cannot read local source credentials.'); }
  const tokenFor=item=>new URL(item.url).hostname==='huggingface.co'
    ? (process.env.HF_TOKEN || credentials.huggingFaceToken || '')
    : (process.env.CIVITAI_API_TOKEN || credentials.civitaiApiToken || '');
  // Persist only integrity metadata remotely; send each source token over SSH stdin.
  const metadata=entries.map(({url,...item})=>item);
  async function sshInvoke(command,input){
    const child=spawn('ssh',[...ssh,command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const output=[];let size=0;
    child.stdout.on('data',b=>{size+=b.length;if(size<1024*1024)output.push(b);});
    child.stderr.resume();
    const completion=new Promise((resolve,reject)=>{child.on('error',()=>reject(Error('Could not start SSH transfer')));child.on('close',code=>code===0?resolve():reject(Error('Model transfer failed; rerun boot to resume.')));});
    await Promise.all([pipeline(input,child.stdin),completion]);
    return Buffer.concat(output).toString('utf8');
  }
  const invoke=providedInvoke ?? sshInvoke;
  await invoke('umask 077; cat > /root/seed-model-receiver.py',Readable.from([await readFile(new URL('./model_receiver.py',import.meta.url))]));
  const request=async body=>JSON.parse(await invoke('/opt/venv/bin/python /root/seed-model-receiver.py',Readable.from([JSON.stringify({workspace,...body})+'\n'])));
  say('Checking models already on the VM…');
  const remote=await request({action:'probe',entries:metadata});
  for(const item of entries){
    const state=remote.find(x=>x.path===item.path);
    if(!state || !Number.isSafeInteger(state.offset)||state.offset<0||state.offset>item.size)throw Error('Invalid VM transfer response.');
    if(state.ready){say(`Already on VM: ${item.path}`);continue;}
    say(`Downloading directly on GPU: ${item.path}`);
    const started=Date.now();
    const heartbeat=setInterval(()=>say(`GPU is downloading/verifying ${item.path} (${Math.round((Date.now()-started)/1000)}s)`),30000);
    let direct;
    try { direct=await request({action:'download',item,token:tokenFor(item)}); }
    finally { clearInterval(heartbeat); }
    if(direct.ready === true){say(`Verified on GPU: ${item.path} (${direct.seconds}s)`);continue;}
    const errorType=/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(direct.error_type ?? '') ? direct.error_type : 'unknown error';
    const httpStatus=Number.isInteger(direct.http_status) && direct.http_status>=100 && direct.http_status<=599 ? `, HTTP ${direct.http_status}` : '';
    say(`Direct download diagnostic: ${item.path}: ${errorType}${httpStatus} (${direct.seconds}s).`);
    if(!fallback) throw Error(`Direct download failed for ${item.path}. Local fallback is disabled; retry boot or enable it with seed setup --cache-models.`);
    say(`Direct download failed; using PC fallback for ${item.path}.`);
    if(!await cached(paths,item)) {
      say(`Downloading and verifying missing PC copy: ${item.path}`);
      await downloadModel(paths,item,tokenFor(item));
    }
    say(`Sending ${item.path} (${(state.offset/1e9).toFixed(2)}/${(item.size/1e9).toFixed(2)} GB)`);
    const {url,...info}=item;
    async function* content(){
      yield JSON.stringify({workspace,action:'receive',item:info,offset:state.offset})+'\n';
      let sent=state.offset,last=Date.now();
      if(state.offset<item.size) for await(const chunk of createReadStream(modelFile(paths,item),{start:state.offset})) {
        sent+=chunk.length; yield chunk;
        if(Date.now()-last>30000){say(`${item.path}: ${(sent/1e9).toFixed(2)}/${(item.size/1e9).toFixed(2)} GB sent`);last=Date.now();}
      }
    }
    await invoke('/opt/venv/bin/python /root/seed-model-receiver.py',Readable.from(content()));
  }
  // Call during bootstrap, before starting the engine; never while jobs are running.
  const result=await request({action:'activate',entries:metadata});
  say(`Models verified on VM; ${result.presets} presets activated.`);
}

// RunPod or another manually configured SSH worker can use the same transfer path.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {parseArgs}=await import('node:util');
    const {values}=parseArgs({options:{repo:{type:'string'},host:{type:'string'},port:{type:'string'},key:{type:'string'},'known-hosts':{type:'string'},workspace:{type:'string'}}});
    if(!values.repo||!values.host||!values.port||!values.key||!values['known-hosts'])throw Error('Supply --repo, --host, --port, --key and --known-hosts.');
    const repo=path.resolve(values.repo);
    const {resolvePaths}=await import(pathToFileURL(path.join(repo,'dist/server/storage.js')));
    const {sshArgs}=await import('./vast.mjs');
    await transferModels(repo,resolvePaths(process.env.STUDIO_DEV_ROOT),sshArgs({public_ipaddr:values.host,ports:{'22/tcp':[{HostPort:values.port}]}},path.resolve(values.key),path.resolve(values['known-hosts'])),{workspace:values.workspace??'/workspace'});
  } catch(error){console.error(error.message);process.exitCode=1;}
}
