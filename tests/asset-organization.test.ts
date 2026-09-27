import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/http.js';
import {openDatabase} from '../server/db.js';
import {resolvePaths} from '../server/storage.js';

let app:Awaited<ReturnType<typeof createApp>>, db:ReturnType<typeof openDatabase>, root:string;
const host='127.0.0.1:4311', headers={host,origin:`http://${host}`};
beforeEach(async()=>{
  mkdirSync('.local/tests',{recursive:true});root=mkdtempSync(path.resolve('.local/tests/asset-organization-'));
  app=await createApp({paths:resolvePaths(root),port:4311});db=openDatabase(resolvePaths(root).data);
});
afterEach(async()=>{db.close();await app.close();await new Promise(resolve=>setTimeout(resolve,30));rmSync(root,{recursive:true,force:true});});
function asset(id:string,kind='image',metadata:Record<string,unknown>={},createdAt='2026-09-26T00:00:00Z'){
  const relative=`media/outputs/${id}.png`,file=path.join(resolvePaths(root).data,relative);writeFileSync(file,'saved media');
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(id,kind,id,relative,JSON.stringify(metadata),createdAt);return file;
}
async function createCollection(name='Ideas',mode='sfw'){
  const result=await app.inject({method:'POST',url:'/api/v1/collections',headers,payload:{name,mode}});
  expect(result.statusCode,result.body).toBe(201);return result.json();
}
const favorite=(id:string,value=true)=>app.inject({method:'PUT',url:`/api/v1/assets/${id}/favorite`,headers,payload:{favorite:value}});
const include=(id:string,collectionId:string,included=true)=>app.inject({method:'PUT',url:`/api/v1/assets/${id}/collections/${collectionId}`,headers,payload:{included}});
const organization=(id:string)=>app.inject({url:`/api/v1/assets/${id}/organization`,headers:{host}});
const listing=(query='')=>app.inject({url:'/api/v1/assets'+query,headers:{host}});

describe('asset favorites and collections',()=>{
  it('persists explicit favorite and membership setters without changing saved files or metadata',async()=>{
    const file=asset('one'),collection=await createCollection('  Ideas  ');
    expect(collection).toMatchObject({name:'Ideas',mode:'sfw',count:0});
    expect((await organization('one')).json()).toEqual({id:'one',mode:'sfw',favorite:false,collection_ids:[]});
    for(let i=0;i<2;i++){
      expect((await favorite('one')).json()).toEqual({id:'one',favorite:true});
      expect((await include('one',collection.id)).json()).toEqual({id:'one',mode:'sfw',favorite:true,collection_ids:[collection.id]});
    }
    expect((await app.inject({url:'/api/v1/assets/one',headers:{host}})).json()).toMatchObject({favorite:true,collection_ids:[collection.id],mode:'sfw'});
    expect((await listing()).json().items[0].favorite).toBe(true);
    expect((await app.inject({url:'/api/v1/collections',headers:{host}})).json().items[0].count).toBe(1);
    expect(db.prepare('SELECT metadata_json FROM assets WHERE id=?').get('one')).toEqual({metadata_json:'{}'});
    db.close();await app.close();app=await createApp({paths:resolvePaths(root),port:4311});db=openDatabase(resolvePaths(root).data);
    expect((await organization('one')).json()).toMatchObject({favorite:true,collection_ids:[collection.id]});
    expect(readFileSync(file,'utf8')).toBe('saved media');
    for(let i=0;i<2;i++){expect((await favorite('one',false)).statusCode).toBe(200);expect((await include('one',collection.id,false)).statusCode).toBe(200);}
    expect((await organization('one')).json()).toMatchObject({favorite:false,collection_ids:[]});
  });

  it('migrates version 9 and safely reopens version 10 with existing media intact',async()=>{
    const file=asset('old');
    db.exec('DROP TABLE collection_assets; DROP TABLE collections; DROP TABLE asset_favorites; DELETE FROM schema_migrations WHERE version=10');
    db.close();await app.close();app=await createApp({paths:resolvePaths(root),port:4311});db=openDatabase(resolvePaths(root).data);
    expect(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({version:10});
    expect((await organization('old')).json()).toMatchObject({favorite:false,collection_ids:[]});
    expect(readFileSync(file,'utf8')).toBe('saved media');
  });

  it('filters favorites, collection, type and mode before pagination, retaining an unfavorited cursor',async()=>{
    const collection=await createCollection();
    for(let i=0;i<54;i++){
      const id='image-'+String(i).padStart(2,'0');asset(id);await favorite(id);await include(id,collection.id);
    }
    asset('newer-not-favorite','image',{},'2026-09-27T00:00:00Z');await include('newer-not-favorite',collection.id);
    asset('video','video');await favorite('video');await include('video',collection.id);
    asset('other-mode','image',{mode:'nsfw'});await favorite('other-mode');
    const query=`?mode=sfw&kind=image&favorites=true&collection_id=${collection.id}`;
    const first=(await listing(query)).json();expect(first.items).toHaveLength(50);expect(first.items[0].id).toBe('image-53');
    expect(first.items.every((item:any)=>item.favorite&&item.kind==='image'&&item.mode==='sfw')).toBe(true);
    await favorite(first.next_cursor,false);await include(first.next_cursor,collection.id,false);
    const next=(await listing(query+'&cursor='+first.next_cursor)).json();
    expect(next.items.map((item:any)=>item.id)).toEqual(['image-03','image-02','image-01','image-00']);expect(next.next_cursor).toBeNull();
    expect((await listing('?mode=sfw&kind=video&favorites=true')).json().items.map((item:any)=>item.id)).toEqual(['video']);
    expect((await listing('?mode=nsfw&favorites=true')).json().items.map((item:any)=>item.id)).toEqual(['other-mode']);
    expect((await listing('?favorites=false')).json().items.some((item:any)=>item.id==='newer-not-favorite')).toBe(true);
  });

  it('enforces collection names and mode boundaries including sequence fallback',async()=>{
    const standard=await createCollection('Ideas'),spicy=await createCollection('ideas','nsfw');
    expect((await app.inject({method:'POST',url:'/api/v1/collections',headers,payload:{name:' IDEAS ',mode:'sfw'}})).statusCode).toBe(409);
    for(const name of ['  ','x'.repeat(81)])expect((await app.inject({method:'POST',url:'/api/v1/collections',headers,payload:{name,mode:'sfw'}})).statusCode).toBe(400);
    const unicode=await createCollection('ÉTUDES');
    expect((await app.inject({method:'POST',url:'/api/v1/collections',headers,payload:{name:'études',mode:'sfw'}})).statusCode).toBe(409);
    expect((await app.inject({method:'PATCH',url:'/api/v1/collections/'+unicode.id,headers,payload:{name:'ideas'}})).statusCode).toBe(409);
    expect((await app.inject({method:'PATCH',url:'/api/v1/collections/'+standard.id,headers,payload:{name:'  Favorites to print  '}})).json().name).toBe('Favorites to print');
    asset('frame');db.prepare('INSERT INTO sequences(id,mode,created_at) VALUES (?,?,?)').run('frames','nsfw',new Date().toISOString());db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('frames','frame',0);
    expect((await include('frame',standard.id)).statusCode).toBe(409);
    expect((await include('frame',spicy.id)).json()).toMatchObject({mode:'nsfw',collection_ids:[spicy.id]});
    expect((await app.inject({url:'/api/v1/assets/frame',headers:{host}})).json().mode).toBe('nsfw');
    expect((await listing('?mode=sfw&collection_id='+spicy.id)).json().items).toEqual([]);
    expect((await app.inject({url:'/api/v1/collections?mode=sfw',headers:{host}})).json().items.map((item:any)=>item.id)).not.toContain(spicy.id);
    expect((await app.inject({url:'/api/v1/collections?mode=nsfw',headers:{host}})).json().items).toEqual([{...spicy,count:1}]);
  });

  it('deletes collection associations only, and cascades ordinary asset and frame deletion',async()=>{
    const file=asset('one'),collection=await createCollection();await favorite('one');await include('one',collection.id);
    for(let i=0;i<2;i++)expect((await app.inject({method:'DELETE',url:'/api/v1/collections/'+collection.id,headers})).statusCode).toBe(204);
    expect(existsSync(file)).toBe(true);expect((await organization('one')).json()).toMatchObject({favorite:true,collection_ids:[]});
    const remaining=await createCollection();await include('one',remaining.id);
    expect((await app.inject({method:'DELETE',url:'/api/v1/assets/one',headers})).statusCode).toBe(204);
    expect(existsSync(file)).toBe(false);
    const frameFile=asset('frame');db.prepare('INSERT INTO sequences(id,mode,created_at) VALUES (?,?,?)').run('frames','sfw',new Date().toISOString());db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('frames','frame',0);
    await favorite('frame');await include('frame',remaining.id);
    expect((await app.inject({method:'DELETE',url:'/api/v1/assets/frame',headers})).statusCode).toBe(204);
    expect(existsSync(frameFile)).toBe(false);
    expect(db.prepare('SELECT * FROM asset_favorites').all()).toEqual([]);expect(db.prepare('SELECT * FROM collection_assets').all()).toEqual([]);
    expect((await app.inject({url:'/api/v1/collections',headers:{host}})).json().items).toEqual([{...remaining,count:0}]);
  });

  it('rejects missing and unready assets and malformed or cross-origin mutations',async()=>{
    const collection=await createCollection();asset('ready');asset('upload','image',{state:'uploading'});
    expect((await favorite('missing')).statusCode).toBe(404);expect((await organization('missing')).statusCode).toBe(404);expect((await include('ready','missing')).statusCode).toBe(404);
    expect((await favorite('upload')).statusCode).toBe(409);expect((await include('upload',collection.id)).statusCode).toBe(409);expect((await organization('upload')).statusCode).toBe(409);
    expect((await app.inject({url:'/api/v1/assets/upload',headers:{host}})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:'/api/v1/assets/ready/favorite',headers:{host},payload:{favorite:true}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/collections',headers:{host,origin:'https://evil.test'},payload:{name:'Bad',mode:'sfw'}})).statusCode).toBe(403);
    for(const payload of [{},{favorite:'not-a-boolean'},{favorite:true,extra:'x'}])expect((await app.inject({method:'PUT',url:'/api/v1/assets/ready/favorite',headers,payload})).statusCode).toBe(400);
    expect((await app.inject({method:'PUT',url:`/api/v1/assets/ready/collections/${collection.id}`,headers,payload:{included:'wrong'}})).statusCode).toBe(400);
    expect((await app.inject({method:'PATCH',url:'/api/v1/collections/missing',headers,payload:{name:'Name'}})).statusCode).toBe(404);
    expect((await listing('?favorites=wrong')).statusCode).toBe(400);
    asset('pending');db.prepare('INSERT INTO sequences(id,mode,created_at,pending_json) VALUES (?,?,?,?)').run('pending-sequence','sfw',new Date().toISOString(),'{}');db.prepare('INSERT INTO sequence_frames VALUES (?,?,?)').run('pending-sequence','pending',0);
    expect((await favorite('pending')).statusCode).toBe(409);
  });
});
