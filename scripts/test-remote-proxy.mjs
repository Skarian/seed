import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';

await mkdir('.local',{recursive:true});
const root=await mkdtemp(path.resolve('.local/remote-proxy-'));
const serverRoot=path.resolve(process.env.SEED_QA_SERVER_ROOT??'dist');
const webRoot=path.resolve(process.env.SEED_QA_WEB_ROOT??'dist/web');
const {createApp}=await import(pathToFileURL(path.join(serverRoot,'server/http.js')).href);
const {resolvePaths}=await import(pathToFileURL(path.join(serverRoot,'server/storage.js')).href);
const paths=resolvePaths(root);
const listen=async(server)=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const openssl=process.env.OPENSSL_PATH??(process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',path.join(root,'proxy.key'),'-out',path.join(root,'proxy.pem')],{windowsHide:true,stdio:'ignore'});
const key=await readFile(path.join(root,'proxy.key')),cert=await readFile(path.join(root,'proxy.pem'));
let app,browser,upstreamPort,externalCalls=0;
const upstreamSockets=new Set(),streams=new Set();
const proxy=https.createServer({key,cert},(req,res)=>{
 const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:req.headers},incoming=>{
  res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
 });
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
 req.pipe(upstream);res.on('close',()=>upstream.destroy());
});
proxy.on('connection',socket=>{upstreamSockets.add(socket);socket.on('close',()=>upstreamSockets.delete(socket));});
const remotePort=await listen(proxy),origin=`https://localhost:${remotePort}`;
const blocked=async()=>{externalCalls++;throw Error('External provider calls are forbidden in proxy verification.');};
const checks=[];
function request(route,options={}){
 const {method='GET',body,headers={}}=options;
 const data=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
 return new Promise((resolve,reject)=>{
  const req=https.request(new URL(route,origin),{ca:cert,servername:'localhost',family:4,method,headers:{...(data?{'Content-Length':data.length,'Content-Type':'application/json'}:{}),...(!['GET','HEAD'].includes(method)?{Origin:origin}:{}),...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('end',()=>{const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,bytes,text:bytes.toString(),json:()=>JSON.parse(bytes.toString())});});res.once('error',reject);
  });
  req.setTimeout(10000,()=>req.destroy(Error('Proxy request timed out.')));req.once('error',reject);req.end(data);
 });
}
function eventStream(route){
 let response,text='',failure;
 const req=https.get(new URL(route,origin),{ca:cert,family:4},res=>{
  response=res;if(res.statusCode!==200)failure=Error('Unexpected SSE status '+res.statusCode);
  res.on('data',data=>text+=data.toString());res.on('error',error=>{if(error.code!=='ECONNRESET')failure=error;});
 });
 req.on('error',error=>{failure=error;});
 const close=()=>{response?.destroy();req.destroy();streams.delete(close);};streams.add(close);
 return {close,get headers(){return response?.headers;},async until(value,timeout=8000){const end=Date.now()+timeout;while(!text.includes(value)){if(failure)throw failure;if(Date.now()>end)throw Error('Missing streamed fixture event: '+value);await delay(25);}}};
}
try {
 const probe=http.createServer();upstreamPort=await listen(probe);await new Promise(resolve=>probe.close(resolve));
 app=await createApp({paths,host:'127.0.0.1',port:upstreamPort,webRoot,providerFetch:blocked,chatFetch:blocked});
 await app.listen({host:'127.0.0.1',port:upstreamPort});
 // The HTTP server's configured authority is deliberately distinct from TLS.
 const localHeaders={host:`127.0.0.1:${upstreamPort}`,origin:`http://127.0.0.1:${upstreamPort}`};
 const saved=await app.inject({method:'PATCH',url:'/api/v1/admin/access',headers:localHeaders,payload:{publicOrigin:origin}});
 assert.equal(saved.statusCode,200,saved.body);
 const initial=await request('/admin?section=access');assert.equal(initial.status,200);assert.match(initial.text,/<div id="root"/);
 for(const match of initial.text.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))assert.equal((await request(match[1])).status,200);
 assert.equal((await request('/api/v1/admin/access')).json().publicOrigin,origin);checks.push('TLS termination, preserved Host, HTML, deep link, static assets and API');
 assert.equal((await request('/api/v1/chats',{method:'POST',headers:{Origin:'https://hostile.invalid'},body:{mode:'sfw'}})).status,403);
 assert.equal((await request('/api/v1/health',{headers:{Host:'hostile.invalid','X-Forwarded-Host':new URL(origin).host}})).status,403);checks.push('Host/Origin and forwarded-header rejection through real proxy');

 // Generate public fixture media; never read the actual Seed library.
 const uploadMedia=async(bytes,kind,filename,filetype)=>{
 const metadata=Object.entries({kind,filename,filetype,mode:'sfw'}).map(([name,value])=>name+' '+Buffer.from(value).toString('base64')).join(',');
 const upload=await request('/api/v1/uploads',{method:'POST',headers:{'Tus-Resumable':'1.0.0','Upload-Length':String(bytes.length),'Upload-Metadata':metadata}});
 assert.equal(upload.status,201,upload.text);const location=upload.headers.location;assert.match(location,/^\/api\/v1\/uploads\//);
 const split=Math.floor(bytes.length/2),part=(start,end)=>request(location,{method:'PATCH',headers:{'Tus-Resumable':'1.0.0','Upload-Offset':String(start),'Content-Type':'application/offset+octet-stream'},body:bytes.subarray(start,end)});
 assert.equal((await part(0,split)).status,204);
 assert.equal((await request(location,{method:'HEAD',headers:{'Tus-Resumable':'1.0.0'}})).headers['upload-offset'],String(split));
 assert.equal((await part(split,bytes.length)).status,204);
 const asset=location.split('/').at(-1);let ready=false;
 for(let i=0;i<100;i++){if((await request('/api/v1/assets/'+asset)).json().state==='ready'){ready=true;break;}await delay(100);}assert.equal(ready,true);
 const media='/api/v1/assets/'+asset+'/content';
 assert.deepEqual((await request(media)).bytes,bytes);
 const range=await request(media,{headers:{Range:'bytes=4-15'}});assert.equal(range.status,206);assert.deepEqual(range.bytes,bytes.subarray(4,16));assert.equal(range.headers['cache-control'],'no-store');
 return asset;
 };
 const image=await sharp({create:{width:320,height:240,channels:3,background:'#6c906e'}}).png().toBuffer();
 await uploadMedia(image,'image','Proxy fixture.png','image/png');
 const videoFile=path.join(root,'video.mp4');
 execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=green:s=480x270:r=24','-t','3','-c:v','libx264','-pix_fmt','yuv420p',videoFile],{windowsHide:true});
 const videoId=await uploadMedia(await readFile(videoFile),'video','Proxy video.mp4','video/mp4');
 checks.push('Relative upload Location, chunked PATCH, HEAD/resume, image/video downloads and byte ranges');

 const chat=(await request('/api/v1/chats',{method:'POST',body:{mode:'sfw'}})).json();
 const stream=eventStream('/api/v1/chats/'+chat.id+'/events');await stream.until(': connected');assert.equal(stream.headers['content-type'],'text/event-stream');
 const updated=await request('/api/v1/chats/'+chat.id,{method:'PATCH',body:{version:chat.version,title:'Proxy fixture renamed'}});assert.equal(updated.status,200,updated.text);
 await stream.until('"version":'+updated.json().version);await stream.until(': heartbeat',30000);stream.close();
 const reconnected=eventStream('/api/v1/chats/'+chat.id+'/events');await reconnected.until(': connected');reconnected.close();checks.push('SSE event delivery, real 25-second heartbeat and reconnect');

 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();
 const external=[];
 await context.route('**/*',route=>{const target=new URL(route.request().url());if(target.origin===origin||['data:','blob:'].includes(target.protocol))return route.continue();external.push(target.origin);return route.abort();});
 await page.goto(origin+'/admin?section=access');await page.getByLabel('Remote URL',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Remote URL',{exact:true}).inputValue(),origin);
 await page.goto(origin+'/library');
 await page.getByRole('button',{name:'Proxy fixture.png',exact:true}).click();
 await page.locator('.preview-image img').waitFor();
 await page.waitForFunction(()=>document.querySelector('.preview-image img')?.naturalWidth>0);
 await page.goto(origin+'/api/v1/assets/'+videoId+'/content');
 await page.locator('video').waitFor();
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
 await page.locator('video').evaluate(video=>{video.currentTime=1.5;});
 await page.waitForFunction(()=>{const video=document.querySelector('video');return video&&!video.seeking&&video.currentTime>=1.4;});
 assert.equal(external.length,0);await context.close();checks.push('Chromium HTTPS Admin deep link, image preview and video seeking');
 assert.equal((await request('/api/v1/admin/access',{method:'PATCH',body:{publicOrigin:null}})).status,200);
 assert.equal((await request('/api/v1/health')).status,403);
 assert.equal((await app.inject({url:'/api/v1/health',headers:localHeaders})).statusCode,200);checks.push('Remove remote address live; LAN remains available');
 assert.equal(externalCalls,0);
 const report={at:new Date().toISOString(),passed:true,checks,externalProviderCalls:externalCalls,coverage:'Loopback TLS proxy and disposable fixture data. Real Cloudflare Access authentication is not simulated or claimed.'};
 await writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2));
 if(process.env.SEED_ATLAS_ROOT)await writeFile(path.join(process.env.SEED_ATLAS_ROOT,'proxy-result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{
 await browser?.close();for(const close of streams)close();
 for(const socket of upstreamSockets)socket.destroy();
 await new Promise(resolve=>proxy.close(resolve));await app?.close();
}
