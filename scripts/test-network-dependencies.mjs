// Local Docker only. No credentials, model downloads or paid resources.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {randomBytes, createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const execute=promisify(execFile);
const pins=JSON.parse(await readFile(new URL('../worker/network-dependencies.json',import.meta.url)));
const name=`seed-network-check-${process.pid}`;
const evidence=new URL('../.local/networking/',import.meta.url);
await mkdir(evidence,{recursive:true});
const docker=async(...args)=>(await execute('docker',args,{windowsHide:true,maxBuffer:4*1024*1024})).stdout.trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let created=false,origin;
async function ready(){
  for(let attempt=0;attempt<30;attempt++){
    try {const r=await fetch(origin+'/files/',{method:'OPTIONS',signal:AbortSignal.timeout(1000)});if(r.ok)return;}
    catch {}
    await delay(250);
  }
  throw Error('Local tusd did not become ready');
}
const results={started_at:new Date().toISOString(),scope:'Official binaries and local tusd persistence; not worker authentication or Tailscale enrollment'};
try {
  results.tailscale_version=await docker('run','--rm','--entrypoint','/usr/local/bin/tailscale',pins.tailscale.image,'version');
  assert.ok(results.tailscale_version.startsWith(pins.tailscale.version));
  await docker('run','--rm','--entrypoint','/bin/sh',pins.tailscale.image,'-c','test -x /usr/local/bin/containerboot && test -x /usr/local/bin/tailscaled');
  results.tusd_version=await docker('run','--rm',pins.tusd.image,'-version');
  assert.ok(results.tusd_version.includes(pins.tusd.version));
  await docker('run','-d','--name',name,'-p','127.0.0.1::8080',pins.tusd.image,'-host','0.0.0.0','-port','8080','-upload-dir','/tmp/seed-test-uploads');
  created=true;
  const mapping=await docker('port',name,'8080/tcp');
  assert.match(mapping,/^127\.0\.0\.1:\d+$/);
  origin='http://'+mapping;await ready();
  const bytes=randomBytes(8*1024*1024), split=3*1024*1024;
  const headers={'Tus-Resumable':'1.0.0'};
  const create=await fetch(origin+'/files/',{method:'POST',headers:{...headers,'Upload-Length':String(bytes.length)}});
  assert.equal(create.status,201);
  let url=new URL(create.headers.get('location'),origin);
  assert.equal(url.origin,origin);
  const patch=(offset,chunk)=>fetch(url,{method:'PATCH',headers:{...headers,'Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:chunk,signal:AbortSignal.timeout(15000)});
  assert.equal((await patch(0,bytes.subarray(0,split))).status,204);
  await docker('restart',name);
  const resumedMapping=await docker('port',name,'8080/tcp');
  assert.match(resumedMapping,/^127\.0\.0\.1:\d+$/);
  origin='http://'+resumedMapping;url=new URL(url.pathname,origin);await ready();
  const head=await fetch(url,{method:'HEAD',headers});
  assert.equal(head.status,200);assert.equal(Number(head.headers.get('upload-offset')),split);
  assert.equal((await patch(0,bytes.subarray(0,10))).status,409);
  assert.equal((await patch(split,bytes.subarray(split))).status,204);
  const complete=await fetch(url,{headers});assert.equal(complete.status,200);
  const received=Buffer.from(await complete.arrayBuffer());assert.equal(hash(received),hash(bytes));
  const range=await fetch(url,{headers:{Range:'bytes=1048576-'}});assert.equal(range.status,206);
  assert.equal(hash(Buffer.from(await range.arrayBuffer())),hash(bytes.subarray(1048576)));
  Object.assign(results,{passed:true,bytes:bytes.length,resumed_offset:split,checks:['binary versions','containerboot present','upload survives restart','stale offset rejected','resumed bytes match hash','download Range']});
} catch(error){results.passed=false;results.error=error.message;throw error;}
finally {
  if(created){
    await writeFile(new URL('tusd-dependency.log',evidence),await docker('logs',name).catch(e=>e.message));
    await docker('rm','-f',name);
  }
  results.finished_at=new Date().toISOString();
  await writeFile(new URL('dependency-check.json',evidence),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}
