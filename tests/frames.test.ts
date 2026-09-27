import {it,expect} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/http.js';
import {openDatabase} from '../server/db.js';
import {resolvePaths} from '../server/storage.js';
import {probe,transcode} from '../server/media.js';

it('picks original-resolution frames, preserves Spicy mode and notes, and safely deduplicates saves',async()=>{
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/frames-')),paths=resolvePaths(root);
  const app=await createApp({paths,port:4311,webRoot:path.resolve('dist/web')}),db=openDatabase(paths.data);
  const headers={host:'127.0.0.1:4311',origin:'http://127.0.0.1:4311'},file=path.join(paths.data,'media/originals/source.mp4');
  try{
    await transcode(['-f','lavfi','-i','color=c=red:s=320x180:r=24:d=1','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-pix_fmt','yuv420p',file]);
    expect(await probe(file)).toMatchObject({fps:24,width:320,height:180});
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('source','video','Colour test','media/originals/source.mp4',JSON.stringify({state:'ready',mode:'nsfw',mime_type:'video/mp4'}),new Date().toISOString());
    db.prepare('INSERT INTO asset_notes VALUES (?,?,0)').run('source','Original note');
    const save=(time:number)=>app.inject({method:'POST',url:'/api/v1/assets/source/frames',headers,payload:{time_seconds:time}});
    for(const time of [-1,2,100])expect((await save(time)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({method:'POST',url:'/api/v1/assets/source/frames',headers:{host:headers.host},payload:{time_seconds:0}})).statusCode).toBe(403);
    const red=await save(.5),blue=await save(1.5);expect(red.statusCode).toBe(200);expect(blue.statusCode).toBe(200);
    expect(red.json()).toMatchObject({width:320,height:180,mode:'nsfw',source_asset_id:'source',source_time_seconds:.5});
    for(const [result,channel] of [[red,0],[blue,2]] as const){const bytes=(await app.inject({url:result.json().url,headers:{host:headers.host}})).rawPayload;const stats=await sharp(bytes).stats();expect(stats.channels[channel]!.mean).toBeGreaterThan(240);expect(stats.channels[1]!.mean).toBeLessThan(10);}
    expect((await save(.5)).json().id).toBe(red.json().id);expect(db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({n:3});
    expect((await app.inject({url:'/api/v1/assets?mode=sfw',headers:{host:headers.host}})).json().items).toEqual([]);
    expect(db.prepare('SELECT note FROM asset_notes WHERE id=?').get(red.json().id)).toEqual({note:'Original note'});
    expect(existsSync(file)).toBe(true);expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({n:0});
    writeFileSync(path.join(paths.data,'../outside.txt'),'private');
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('outside','video','Outside','../outside.txt','{}',new Date().toISOString());
    expect((await app.inject({method:'POST',url:'/api/v1/assets/outside/frames',headers,payload:{time_seconds:0}})).statusCode).toBe(409);
  }finally{db.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
