import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {existsSync,realpathSync,renameSync,rmSync,statSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {digest} from './loras.js';
import type {StudioPaths} from './storage.js';

export type CropBox = {x:number;y:number;width:number;height:number;shape?:string};

/**
 * Saves a crop of a saved image as a new image that remembers where it came from (source_asset_id and the box),
 * so the Library treats it as made in Seed and links it back to its original. The original is not changed.
 * Called through the job mutation queue, so deleting the source cannot race the crop.
 */
export async function cropImage(db: Database.Database, paths: StudioPaths, sourceId: string, box: CropBox) {
  const source=db.prepare('SELECT * FROM assets WHERE id=?').get(sourceId) as {kind:string;name:string;relative_path:string;metadata_json:string}|undefined;
  if(!source||source.kind!=='image')throw Error('Choose a saved image.');
  const metadata=JSON.parse(source.metadata_json);
  if(metadata.state&&metadata.state!=='ready')throw Error('Wait for the image to finish saving.');
  const original=path.resolve(paths.data,source.relative_path);
  if(!original.startsWith(path.resolve(paths.data)+path.sep)||!existsSync(original)||!realpathSync(original).startsWith(realpathSync(paths.data)+path.sep))throw Error('The image is no longer available.');
  const info=await sharp(original).metadata();
  const W=info.width??0,H=info.height??0;
  const x=Math.round(box.x),y=Math.round(box.y),w=Math.round(box.width),h=Math.round(box.height);
  if(![x,y,w,h].every(Number.isFinite)||w<8||h<8||x<0||y<0||x+w>W||y+h>H)throw Error('Choose a crop inside the image.');
  const shape=typeof box.shape==='string'&&/^[\d.]{1,5}:[\d.]{1,5}$/.test(box.shape)?box.shape:undefined;
  const id='crop-'+createHash('sha256').update(JSON.stringify([sourceId,metadata.sha256,x,y,w,h])).digest('hex').slice(0,32);
  const existing=db.prepare('SELECT metadata_json FROM assets WHERE id=?').get(id) as {metadata_json:string}|undefined;
  if(existing)return {id,...JSON.parse(existing.metadata_json)};
  const file=path.join(paths.data,'media/outputs',id+'.png'),temporary=file+'.tmp';
  try {
    await sharp(original).extract({left:x,top:y,width:w,height:h}).png().toFile(temporary);
    renameSync(temporary,file);
    const saved={state:'ready',mode:metadata.mode??'sfw',mime_type:'image/png',width:w,height:h,size:statSync(file).size,sha256:await digest(file),source_asset_id:sourceId,crop:{x,y,width:w,height:h,...(shape?{shape}:{})}};
    db.transaction(()=>{
      db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(id,'image',`${source.name.replace(/\.[a-z0-9]{2,5}$/i,'')} · ${shape??`${w}×${h}`} crop`,path.relative(paths.data,file).split(path.sep).join('/'),JSON.stringify(saved),new Date().toISOString());
      const note=db.prepare('SELECT note FROM asset_notes WHERE id=?').get(sourceId) as {note:string}|undefined;
      if(note?.note)db.prepare('INSERT INTO asset_notes VALUES (?,?,0)').run(id,note.note);
    })();
    return {id,...saved};
  } catch(error) {
    rmSync(temporary,{force:true});
    if(!db.prepare('SELECT 1 FROM assets WHERE id=?').get(id))rmSync(file,{force:true});
    throw error;
  }
}
