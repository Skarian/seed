import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import path from 'node:path';

/** An OS-owned lease: crashes release it without stale-file reclamation. */
export async function localLease(root) {
  const canonical=(await realpath(root)).toLowerCase();
  const key=createHash('sha256').update(canonical).digest('hex');
  const address=process.platform==='win32'?'\\\\.\\pipe\\seed-local-'+key:path.join(root,'.lease.sock');
  const server=createServer(socket=>socket.destroy());
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:address,exclusive:true},resolve);});
  } catch(error) {
    if(error.code==='EADDRINUSE'||error.code==='EACCES')throw Error('This local installation is in use by another setup or worker. Stop it before continuing.');
    throw error;
  }
  server.unref();
  return ()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}
