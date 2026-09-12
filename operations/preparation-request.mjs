// Preparation owns retries. This client makes one authenticated, bounded attempt.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson} from './common.mjs';

export class PreparationFault extends Error {
  constructor(message, retryable=false) { super(message); this.retryable=retryable; }
}
export function responseFault(status) {
  return new PreparationFault(`Worker preparation returned HTTP ${status}.`,[408,425,429,502,503,504].includes(status));
}
export async function preparationClient(app,{signal,timeout=10000}={}) {
  const file=path.join(app.paths.config,'worker-connection.json');
  const connection=await readJson(file);
  if(!connection?.worker_credential||!connection.workspace_id||!app.state?.paired_worker||connection.worker_instance_id!==app.state.paired_worker)
    throw new PreparationFault('Connect the recorded worker first.');
  if(connection.endpoint!=='http://127.0.0.1:18080')throw new PreparationFault('Reconnect the recorded worker over SSH before preparation.');
  if(connection.reconnect_required)throw new PreparationFault('Reconnect the recorded worker over SSH before preparation.');
  const lifecycle=app.lifecycle??await import(pathToFileURL(path.join(app.repo,'dist/server/lifecycle.js')).href);
  const controlPaths={config:path.join(app.paths.config,'worker-tunnel')};
  const supervisor=await lifecycle.control(controlPaths,'status');
  if(!supervisor)throw new PreparationFault('SSH supervisor is stopped. Reconnect the recorded worker before preparation.');
  let verified=false;
  async function request(route,{method='GET',body}={}) {
    signal?.throwIfAborted();
    let response;
    const bounded=AbortSignal.timeout(timeout);
    try {
      response=await (app.fetcher??fetch)(connection.endpoint+route,{
        method,redirect:'error',signal:signal?AbortSignal.any([signal,bounded]):bounded,
        headers:{Authorization:'Bearer '+connection.worker_credential,...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
      });
      if(!response.ok){await response.body?.cancel();throw responseFault(response.status);}
      const reader=response.body?.getReader();if(!reader)throw new PreparationFault('Worker preparation returned an empty response.');
      let size=0;const chunks=[];
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024)throw new PreparationFault('Worker preparation response is too large.');chunks.push(value);}}
      finally{await reader.cancel();}
      try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PreparationFault('Worker preparation returned invalid JSON.');}
    }catch(error){
      signal?.throwIfAborted();
      if(error instanceof PreparationFault)throw error;
      throw new PreparationFault('Worker connection interrupted during preparation.',true);
    }
  }
  return {
    connection,request,
    invalidate(){verified=false;},
    async checkTunnel(){
      signal?.throwIfAborted();
      const current=await lifecycle.control(controlPaths,'status');
      if(!current)throw new PreparationFault('SSH supervisor stopped. Inspect the tunnel log and reconnect the recorded worker.');
      if(current.token!==supervisor.token||current.pid!==supervisor.pid)
        throw new PreparationFault('SSH supervisor changed during preparation. Reconnect the recorded worker explicitly.');
    },
    async verify(){
      signal?.throwIfAborted();
      const current=await readJson(file);
      if(current?.reconnect_required)throw new PreparationFault('Reconnect the recorded worker over SSH before preparation.');
      if(['endpoint','worker_instance_id','workspace_id','worker_credential'].some(key=>current?.[key]!==connection[key]))
        throw new PreparationFault('Worker connection changed during preparation; reconnect explicitly.');
      if(verified)return;
      const status=await request('/worker/v1/status');
      if(status.protocol_version!==1||status.worker_instance_id!==connection.worker_instance_id||status.workspace_id!==connection.workspace_id)
        throw new PreparationFault('Worker identity changed during preparation.');
      verified=true;
    },
  };
}
