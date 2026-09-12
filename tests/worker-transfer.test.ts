import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {transferFetch} from '../server/worker-transfer.js';

it('aborts a stalled body even though the server remains reachable', async () => {
  const server=createServer((_req,res)=>{res.writeHead(200);res.write('partial');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try {
    const url=`http://127.0.0.1:${(server.address() as any).port}`;
    const response=await transferFetch(url,{},50);
    await expect(response.text()).rejects.toThrow();
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

it('allows a progressing transfer longer than its inactivity deadline', async () => {
  const server=createServer((_req,res)=>{let n=0;const timer=setInterval(()=>{res.write('x');if(++n===8){clearInterval(timer);res.end();}},20);res.on('close',()=>clearInterval(timer));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try {expect(await (await transferFetch(`http://127.0.0.1:${(server.address() as any).port}`,{},100)).text()).toBe('xxxxxxxx');}
  finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
