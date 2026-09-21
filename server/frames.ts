import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {existsSync,realpathSync,renameSync,rmSync,statSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {digest} from './loras.js';
import {probe,transcode} from './media.js';
import type {StudioPaths} from './storage.js';

// Called through the job mutation queue, so deleting the source cannot race extraction.
export async function pickFrame(db: Database.Database, paths: StudioPaths, sourceId: string, seconds: number) {
  const source=db.prepare('SELECT * FROM assets WHERE id=?').get(sourceId) as {kind:string;name:string;relative_path:string;metadata_json:string}|undefined;
  if(!source||source.kind!=='video')throw Error('Choose a saved video.');
  const metadata=JSON.parse(source.metadata_json);
  if(metadata.state&&metadata.state!=='ready')throw Error('Wait for the video to finish saving.');
  const original=path.resolve(paths.data,source.relative_path);
  if(!original.startsWith(path.resolve(paths.data)+path.sep)||!existsSync(original)||!realpathSync(original).startsWith(realpathSync(paths.data)+path.sep))throw Error('The video is no longer available.');
  const info=await probe(original);
  if(!info.has_video||!Number.isFinite(seconds)||seconds<0||seconds>=info.duration)throw Error('Choose a frame within the video.');
  const time=Number(seconds.toFixed(6));
  const id='frame-'+createHash('sha256').update(JSON.stringify([sourceId,metadata.sha256,time])).digest('hex').slice(0,32);
  const url='/api/v1/assets/'+id+'/content';
  const existing=db.prepare('SELECT metadata_json FROM assets WHERE id=?').get(id) as {metadata_json:string}|undefined;
  if(existing)return {id,url,time_seconds:time,...JSON.parse(existing.metadata_json)};
  const file=path.join(paths.data,'media/outputs',id+'.png'),temporary=file+'.tmp';
  try {
    // Accurate decoding from the original keeps its full dimensions and colour conversion.
    await transcode(['-i',original,'-ss',String(time),'-map','0:v:0','-frames:v','1','-f','image2','-c:v','png',temporary]);
    const image=await sharp(temporary).metadata();
    if(!image.width||!image.height||image.format!=='png')throw Error('Could not read the selected frame.');
    renameSync(temporary,file);
    const saved={state:'ready',mode:metadata.mode??'sfw',mime_type:'image/png',width:image.width,height:image.height,size:statSync(file).size,sha256:await digest(file),source_asset_id:sourceId,source_time_seconds:time};
    db.transaction(()=>{
      db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(id,'image',`${source.name} · ${time.toFixed(2)}s`,path.relative(paths.data,file).split(path.sep).join('/'),JSON.stringify(saved),new Date().toISOString());
      const note=db.prepare('SELECT note FROM asset_notes WHERE id=?').get(sourceId) as {note:string}|undefined;
      if(note?.note)db.prepare('INSERT INTO asset_notes VALUES (?,?,0)').run(id,note.note);
    })();
    return {id,url,time_seconds:time,...saved};
  } catch(error) {
    rmSync(temporary,{force:true});
    if(!db.prepare('SELECT 1 FROM assets WHERE id=?').get(id))rmSync(file,{force:true});
    throw error;
  }
}
