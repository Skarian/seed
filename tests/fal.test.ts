import {it,expect,vi} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,truncateSync} from 'node:fs';
import path from 'node:path';
import {Fal} from '../server/fal.js';
import {Loras} from '../server/loras.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {fakeFal} from './fake-fal.js';
import {convertH3Lora} from '../server/lora-convert.js';
const receipt={request_id:'id',status_url:'https://queue.fal.run/status',response_url:'https://queue.fal.run/result',cancel_url:'https://queue.fal.run/cancel'};
it('does not retry a paid request and never sends the key to arbitrary hosts',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockRejectedValue(Error('timeout')),fal=new Fal('fixture-secret',fetcher);
 await expect(fal.submit('fal-ai/krea-2/turbo',{})).rejects.toThrow('timeout');expect(fetcher).toHaveBeenCalledTimes(1);
 await expect(fal.status({...receipt,status_url:'https://evil.example/status'})).rejects.toThrow('Invalid fal');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('a cancellation arriving after completion still allows output recovery',async()=>{
 const fal=new Fal('key',async()=>new Response('{"status":"ALREADY_COMPLETED"}',{status:400}));expect(await fal.cancel(receipt)).toEqual({status:'ALREADY_COMPLETED'});
});
it.each([false,true])('uploads privately using the supported lifecycle header (multipart=%s)',async multipart=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/fal-storage-')),file=path.join(root,'adapter.safetensors');writeFileSync(file,'test');if(multipart)truncateSync(file,91*1024*1024);
 const url='https://v3b.fal.media/files/b/test/adapter',calls:any[]=[];
 const fetcher=vi.fn<typeof fetch>(async(target,init)=>{
   const u=String(target);calls.push({url:u,init});
   if(u.includes('/storage/upload/initiate'))return Response.json({upload_url:'https://v3b.fal.media/upload/test',file_url:url});
   if(u.includes('/storage/files/acl'))return Response.json({default:'forbid',rules:[]});
   if(u.includes('/upload/test'))return Response.json({partNumber:Number(u.split('/').at(-1))||1,etag:'fixture'});
   throw Error('Unexpected network call');
 });
 expect(await new Fal('fixture-key',fetcher).upload(file,true)).toBe(url);
 const headers=new Headers(calls[0].init.headers),lifecycle=JSON.parse(headers.get('X-Fal-Object-Lifecycle-Preference')!);
 expect(lifecycle).toEqual({expiration_duration_seconds:31536000,initial_acl:{default:'forbid',rules:[]}});expect(headers.has('X-Fal-Object-Lifecycle')).toBe(false);
 expect(calls.filter(c=>c.url.includes('/upload/test')).every(c=>!new Headers(c.init.headers).has('Authorization'))).toBe(true);
});
it('pins adapters by hash, identifies LoKR, refuses wrong routes and reuses uploads',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/loras-')),paths=resolvePaths(root);prepareStorage(paths);
 const file=path.join(root,'adapter.safetensors'),header=Buffer.from(JSON.stringify({'model.lokr_w1':{dtype:'F32',shape:[1],data_offsets:[0,4]}})),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));writeFileSync(file,Buffer.concat([prefix,header,Buffer.alloc(4)]));
 const loras=new Loras(paths),id=await loras.add(file,'image','My adapter'),entry=loras.all()[0]!;
 expect(entry.format).toBe('lokr');expect(entry.compatibility).toBe('untested');expect(entry.file).not.toBe(file);expect(readFileSync(entry.file)).toEqual(readFileSync(file));
 const selected={id,revision:entry.revision,scale:1};expect(()=>loras.resolve([selected],'ref')).toThrow('variant');expect(()=>loras.resolve([{...selected,revision:'changed'}],'image')).toThrow('version');
 const fal=fakeFal();await loras.url(id,entry.revision,fal);await loras.url(id,entry.revision,fal);expect(fal.upload).toHaveBeenCalledTimes(1);expect(fal.sign).toHaveBeenCalledTimes(2);
});
it('converts H3 names without changing tensor values and refuses non-unit alpha scaling',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/h3-conversion-'));
 const stem='lora_unet_blocks_24_attn_out_proj',a=Buffer.alloc(16),b=Buffer.alloc(16),alpha=Buffer.alloc(4);
 [1,2,3,4].forEach((v,i)=>a.writeFloatLE(v,i*4));[5,6,7,8].forEach((v,i)=>b.writeFloatLE(v,i*4));alpha.writeFloatLE(2);
 const tensors={[stem+'.alpha']:{dtype:'F32',shape:[],data_offsets:[0,4]},[stem+'.lora_down.weight']:{dtype:'F32',shape:[2,2],data_offsets:[4,20]},[stem+'.lora_up.weight']:{dtype:'F32',shape:[2,2],data_offsets:[20,36]}};
 const header=Buffer.from(JSON.stringify(tensors)),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));const source=path.join(root,'source.safetensors'),target=path.join(root,'target.safetensors');
 writeFileSync(source,Buffer.concat([prefix,header,alpha,a,b]));await convertH3Lora(source,target);
 const result=readFileSync(target),length=Number(result.readBigUInt64LE()),mapped=JSON.parse(result.subarray(8,8+length).toString());
 expect(Object.keys(mapped)).toEqual(['blocks.24.attn.out_proj.lora_A.weight','blocks.24.attn.out_proj.lora_B.weight']);expect(result.subarray(8+length)).toEqual(Buffer.concat([a,b]));
 const paths=resolvePaths(path.join(root,'studio'));prepareStorage(paths);const catalog=new Loras(paths);
 const id=await catalog.add(source,'fl','Converted adapter'),entry=catalog.all()[0]!;
 expect(readFileSync(entry.file)).toEqual(result);expect(entry.source_sha256).toBeDefined();expect(entry.source_sha256).not.toBe(entry.revision);
 expect(await catalog.add(source,'fl','Same adapter')).toBe(id);expect(catalog.list()).toHaveLength(1);
 catalog.markVerified([{id,revision:entry.revision,scale:1}],'accepted-request','minimax/h3/image-to-video/lora');
 expect(catalog.list()[0]!.compatibility).toBe('verified');expect(catalog.list()[0]!.verification?.request_id).toBe('accepted-request');
 alpha.writeFloatLE(1);writeFileSync(source,Buffer.concat([prefix,header,alpha,a,b]));await expect(convertH3Lora(source,path.join(root,'bad.safetensors'))).rejects.toThrow('alpha equal to rank');
});
