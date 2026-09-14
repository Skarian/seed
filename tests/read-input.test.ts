import {afterEach,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {transcode} from '../server/media.js';
import {createReadInputTool} from '../server/chat/read-input.js';
import {createChatAgent} from '../server/chat/provider.js';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(){
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/read-input-'));roots.push(root);
 await sharp({create:{width:32,height:24,channels:3,background:'red'}}).png().toFile(path.join(root,'photo.png'));
 await transcode(['-f','lavfi','-i','color=c=red:s=64x64:r=10:d=4','-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,'movie.mp4')]);
 const records=[{id:'photo',kind:'image',relative_path:'photo.png'},{id:'movie',kind:'video',relative_path:'movie.mp4',metadata:{duration:6}},{id:'sound',kind:'audio',relative_path:'sound.wav'}];
 const tool=()=>createReadInputTool({data:root,assets:[{handle:'input1',asset_id:'photo',kind:'image'},{handle:'input2',asset_id:'movie',kind:'video',aliases:['clipA']},{handle:'input3',asset_id:'sound',kind:'audio'}],getAsset:id=>records.find(value=>value.id===id)});
 return {root,tool};
}
const execute=(tool:ReturnType<typeof createReadInputTool>,raw:unknown)=>tool.execute('test',raw as any);

it('returns actual frames from a requested later clip through its known alias',async()=>{
 const {tool}=await fixture(),result=await execute(tool(),{asset:'clipA',start_seconds:4,duration_seconds:2});
 const info=result.details as any;
 expect(info.requested_range).toEqual({start_seconds:4,duration_seconds:2});
 expect(info.visual_evidence_in_order.map((item:any)=>item.timestamp_seconds)).toEqual([4,5,5.85]);
 const images=result.content.filter(part=>part.type==='image');expect(images).toHaveLength(3);
 for(const image of images){const pixel=await sharp(Buffer.from(image.data,'base64')).resize(1,1).raw().toBuffer();expect(pixel[2]!).toBeGreaterThan(pixel[0]!+100);}
 expect(info.evidence_note).toContain('Audio has not been supplied');
},30000);

it('limits repeated inspections and rejects invented sources, audio and image clip fields',async()=>{
 const {tool}=await fixture(),bounded=tool();
 for(let i=0;i<3;i++)expect((await execute(bounded,{asset:'photo'})).content.filter(p=>p.type==='image')).toHaveLength(1);
 await expect(execute(bounded,{asset:'photo'})).rejects.toThrow('budget');
 await expect(execute(tool(),{asset:'Picture 1'})).rejects.toThrow('Unknown');
 await expect(execute(tool(),{asset:'sound'})).rejects.toThrow('cannot listen');
 await expect(execute(tool(),{asset:'photo',start_seconds:0})).rejects.toThrow('only to video');
 await expect(execute(tool(),{asset:'movie',start_seconds:5,duration_seconds:2})).rejects.toThrow('exceeds');
 await expect(execute(tool(),{asset:'movie',start_seconds:'4',duration_seconds:2})).rejects.toThrow('numeric');
},30000);

it('reports unreadable files without returning fabricated visual evidence',async()=>{
 const {root,tool}=await fixture();writeFileSync(path.join(root,'photo.png'),'broken');
 let error:unknown;
 try{await execute(tool(),{asset:'input1'});}catch(value){error=value;}
 expect(error).toBeInstanceOf(Error);
 const result=JSON.parse((error as Error).message);
 expect(result).toMatchObject({ok:false,visual_evidence_in_order:[],unavailable_inputs:[{asset_id:'photo',reason:'unreadable'}]});
 expect(result.error).toContain('No readable visual evidence');
},30000);

it('passes read_input image results and timestamp metadata to the next actual provider payload',async()=>{
 const {tool}=await fixture(),requests:any[]=[];
 const agent=createChatAgent({apiKey:'fake',systemPrompt:'Inspect only when needed.',tool:tool(),fetch:async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));
  const delta=requests.length===1?{tool_calls:[{index:0,id:'inspect',type:'function',function:{name:'read_input',arguments:JSON.stringify({asset:'input2',start_seconds:4,duration_seconds:2})}}]}:{content:'The sampled later frames are blue.'};
  return new Response('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:requests.length===1?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 }});
 await agent.prompt('Look at the end of this source.');expect(requests).toHaveLength(2);
 const parts=requests[1].messages.flatMap((message:any)=>Array.isArray(message.content)?message.content:[]);
 expect(parts.filter((part:any)=>part.type==='image_url')).toHaveLength(3);
 const text=JSON.stringify(requests[1].messages);expect(text).toContain('timestamp_seconds');expect(text).toContain('5.85');
 expect(agent.state.messages.at(-1)).toMatchObject({role:'assistant',stopReason:'stop'});
},30000);
