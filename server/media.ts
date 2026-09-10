import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, renameSync, statSync, statfsSync, createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import { createRequire } from 'node:module';
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string | null;
import ffprobe from 'ffprobe-static';
import type { StudioPaths } from './storage.js';
const exec = promisify(execFile);
export async function probe(file: string) {
  const { stdout } = await exec(ffprobe.path, ['-v','error','-show_streams','-show_format','-of','json',file], { maxBuffer: 2*1024*1024, timeout: 60000, windowsHide: true });
  const data = JSON.parse(stdout); const video = data.streams.find((s:any)=>s.codec_type==='video'), audio = data.streams.find((s:any)=>s.codec_type==='audio');
  return { duration: Number(data.format.duration || 0), width: video?.width, height: video?.height, has_audio: Boolean(audio), has_video: Boolean(video), format: String(data.format.format_name || '') };
}
export async function transcode(args: string[]) { if (!ffmpeg) throw new Error('FFmpeg is unavailable.'); await exec(ffmpeg, ['-hide_banner','-loglevel','error','-nostdin','-y',...args], { maxBuffer: 2*1024*1024, timeout: 300000, windowsHide: true }); }
export type InputReference = { id: string; asset_id: string; kind: 'image'|'video'|'audio'; role: 'reference'|'first_frame'|'last_frame'; framing?: 'fit'|'fill'; range?: { start_seconds: number; duration_seconds: number }; include_audio?: boolean };
export type PreparedReference = InputReference & { file: string; filename: string; sha256: string; audio_file?: string; audio_filename?: string; effective_frames?: number };
export class Media {
  directory: string; private chain: Promise<unknown> = Promise.resolve(); private timer?: ReturnType<typeof setInterval>; private activeUploads = new Set<string>(); private store?: FileStore;
  constructor(private db: Database.Database, private paths: StudioPaths) { this.directory=path.join(paths.data,'media/originals'); mkdirSync(this.directory,{recursive:true}); }
  get(id:string) { const row=this.db.prepare('SELECT * FROM assets WHERE id=?').get(id) as any; return row ? {...row,metadata:JSON.parse(row.metadata_json)} : null; }
  async register(app:FastifyInstance) {
    this.store = new FileStore({directory:this.directory});
    const tus=new Server({path:'/api/v1/uploads',relativeLocation:true,datastore:this.store,namingFunction:()=>randomUUID(),disableTerminationForFinishedUploads:true,
      onUploadCreate:async(_req,upload)=>{
        const kind=upload.metadata?.kind; if(!['image','video','audio'].includes(kind??'') || !Number.isSafeInteger(upload.size) || upload.size!<1) throw {status_code:400,body:'Choose a supported media file.'};
        const disk=statfsSync(this.paths.data); const available=Number(disk.bavail)*Number(disk.bsize);
        const reservations=(this.db.prepare("SELECT id,metadata_json FROM assets WHERE json_extract(metadata_json,'$.state')='uploading'").all() as any[]).reduce((n,row)=>{const m=JSON.parse(row.metadata_json);const f=path.join(this.directory,row.id);return n+Math.max(0,m.size-(existsSync(f)?statSync(f).size:0));},0);
        if(upload.size!+reservations>available) throw {status_code:507,body:'Not enough free disk space for this upload.'};
        this.db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(upload.id,kind,String(upload.metadata?.filename??'Upload').slice(0,255),'media/originals/'+upload.id,JSON.stringify({state:'uploading',size:upload.size,mime_type:upload.metadata?.filetype,mode:upload.metadata?.mode==='nsfw'?'nsfw':'sfw'}),new Date().toISOString());return {};
      },onUploadFinish:async(_req,upload)=>{this.mark(upload.id,{state:'verifying'});void this.scan();return {};}});
    app.addContentTypeParser('application/offset+octet-stream',(_request,_payload,done)=>done(null));
    const handle=async(req:any,reply:any)=>{const id=String(req.params?.['*']??'');this.activeUploads.add(id);try{reply.hijack();await tus.handle(req.raw,reply.raw);if(req.method==='DELETE'&&reply.raw.statusCode===204)this.mark(id,{state:'error',error:'Upload cancelled.'});}finally{this.activeUploads.delete(id);}};
    app.all('/api/v1/uploads',handle);app.all('/api/v1/uploads/*',handle);
    app.get('/api/v1/assets/:id',async(req,reply)=>{const item=this.get((req.params as any).id);return item?{id:item.id,kind:item.kind,...item.metadata}:reply.code(404).send({error:{message:'File not found.'}});});
    this.timer=setInterval(()=>void this.scan(),2000);void this.scan();

  }
  async close(){clearInterval(this.timer);await this.chain;}
  mark(id:string,fields:any){const item=this.get(id);if(item)this.db.prepare('UPDATE assets SET metadata_json=? WHERE id=?').run(JSON.stringify({...item.metadata,...fields}),id);}
  scan(){const task=this.chain.then(async()=>{
    for(const row of this.db.prepare("SELECT id FROM assets WHERE json_extract(metadata_json,'$.state') IN ('uploading','verifying')").all() as {id:string}[]){
      const item=this.get(row.id),file=path.join(this.directory,row.id);
      if(this.activeUploads.has(row.id))continue;
      const touched=existsSync(file)?statSync(file).mtimeMs:Date.parse(item.created_at);
      if(item.metadata.state==='uploading'&&Date.now()-touched>24*60*60*1000){await this.store?.remove(row.id).catch(()=>{});this.mark(row.id,{state:'error',error:'Upload expired after 24 hours without progress. Choose the file again.'});continue;}
      if(!existsSync(file)||statSync(file).size!==item.metadata.size)continue;
      try {
        let metadata:any;
        if(item.kind==='image'){const info=await sharp(file,{limitInputPixels:false}).metadata();const mime=({jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',heif:'image/heic',tiff:'image/tiff'} as Record<string,string>)[info.format??''];if(!info.width||!info.height||!mime)throw Error();const rotated=(info.orientation??0)>=5;metadata={width:rotated?info.height:info.width,height:rotated?info.width:info.height,mime_type:mime};}
        else {metadata=await probe(file);if(!metadata.duration || (item.kind==='video'&&!metadata.has_video)||(item.kind==='audio'&&!metadata.has_audio))throw Error();const formats=metadata.format.split(',');metadata.mime_type=formats.includes('mov')?(item.kind==='video'?'video/mp4':'audio/mp4'):formats.includes('webm')?(item.kind==='video'?'video/webm':'audio/webm'):formats.includes('wav')?'audio/wav':formats.includes('mp3')?'audio/mpeg':formats.includes('flac')?'audio/flac':formats.includes('ogg')?'audio/ogg':'application/octet-stream';}
        const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);
        this.mark(item.id,{...metadata,state:'ready',sha256:digest.digest('hex')});
      }catch{this.mark(item.id,{state:'error',error:'This file could not be decoded. Choose another file.'});}
    }
  });this.chain=task.catch(()=>{});return task;}
  async prepare(ref:InputReference,aspect:string,seconds:number):Promise<PreparedReference>{
    const item=this.get(ref.asset_id);if(!item||item.metadata.state!=='ready'||item.kind!==ref.kind)throw new Error('Wait for references to finish uploading.');
    const original=path.resolve(this.paths.data,item.relative_path);if(!original.startsWith(path.resolve(this.paths.data)+path.sep))throw new Error('Invalid input path');
    const key=createHash('sha256').update(JSON.stringify({ref,aspect,seconds,source:item.metadata.sha256,recipe:2})).digest('hex');
    const extension=ref.kind==='image'?'.png':ref.kind==='video'?'.mp4':'.wav';const filename=key+extension,file=path.join(this.paths.data,'media/prepared',filename);
    const [width,height]=aspect==='16:9'?[1344,768]:[768,1344];
    let effective_frames:number|undefined,audio_file:string|undefined,audio_filename:string|undefined;
    if(ref.kind==='image'){
      if(!existsSync(file)){const base=sharp(original,{limitInputPixels:false}).rotate();const m=await base.metadata();
        if(ref.role==='reference'){const [w,h]=(m.orientation??0)>=5?[m.height!,m.width!]:[m.width!,m.height!];const scale=Math.min(1,Math.sqrt(width*height/(w*h)));await base.resize({width:Math.max(32,Math.round(w*scale/32)*32),height:Math.max(32,Math.round(h*scale/32)*32),fit:'fill'}).png().toFile(file+'.tmp');}
        else await base.resize(width,height,{fit:ref.framing==='fill'?'cover':'contain',background:'#000000'}).png().toFile(file+'.tmp');
        renameSync(file+'.tmp',file);}
    }else{
      const range=ref.range!;if(!range||range.start_seconds<0||range.duration_seconds<2||range.duration_seconds>15||range.start_seconds+range.duration_seconds>item.metadata.duration+0.01)throw new Error('Choose a valid 2–15 second reference range.');
      const source=['-ss',String(range.start_seconds),'-i',original];
      if(ref.kind==='video'){
        const generated=17*Math.ceil((seconds*24-5)/17)+5;effective_frames=17*Math.floor((Math.min(Math.floor(range.duration_seconds*24),generated)-5)/17)+5;
        if(!existsSync(file)){await transcode([...source,'-vf',`fps=24,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,'-frames:v',String(effective_frames),'-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-f','mp4',file+'.tmp']);renameSync(file+'.tmp',file);}
        if(ref.include_audio){if(!item.metadata.has_audio)throw new Error('This video has no audio track.');audio_filename=key+'-audio.wav';audio_file=path.join(this.paths.data,'media/prepared',audio_filename);if(!existsSync(audio_file)){await transcode([...source,'-t',String(effective_frames/24),'-vn','-ar','32000','-ac','2','-f','wav',audio_file+'.tmp']);renameSync(audio_file+'.tmp',audio_file);}}
      }else if(!existsSync(file)){await transcode([...source,'-t',String(range.duration_seconds),'-vn','-ar','32000','-ac','2','-f','wav',file+'.tmp']);renameSync(file+'.tmp',file);}
    }
    const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);
    return {...ref,file,filename,sha256:digest.digest('hex'),audio_file,audio_filename,effective_frames};
  }
}
