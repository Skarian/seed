import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AssetCollection, AssetOrganization } from '../shared/studio.js';

type Mode = AssetOrganization['mode'];
class OrganizationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function assetOrganization(db: Database.Database, id: string, requireReady = true): AssetOrganization {
  const asset = db.prepare(`SELECT COALESCE(json_extract(a.metadata_json,'$.mode'),s.mode,'sfw') AS mode,
    COALESCE(json_extract(a.metadata_json,'$.state'),'ready') AS state, s.pending_json
    FROM assets a LEFT JOIN sequence_frames f ON f.asset_id=a.id LEFT JOIN sequences s ON s.id=f.sequence_id WHERE a.id=?`).get(id) as {mode:Mode;state:string;pending_json:string|null}|undefined;
  if (!asset) throw new OrganizationError(404, 'asset_not_found', 'This file is no longer available.');
  if (requireReady && (asset.state !== 'ready' || asset.pending_json !== null)) throw new OrganizationError(409, 'asset_not_ready', 'Wait for this file to finish saving or being removed.');
  return {
    id, mode: asset.mode,
    favorite: Boolean(db.prepare('SELECT 1 FROM asset_favorites WHERE asset_id=?').get(id)),
    collection_ids: (db.prepare('SELECT c.id FROM collections c JOIN collection_assets ca ON ca.collection_id=c.id WHERE ca.asset_id=? AND c.mode=? ORDER BY c.id').all(id, asset.mode) as {id:string}[]).map(row=>row.id),
  };
}

function collections(db: Database.Database, mode: Mode): AssetCollection[] {
  return db.prepare(`SELECT c.id,c.name,c.mode,(SELECT COUNT(*) FROM collection_assets ca JOIN assets a ON a.id=ca.asset_id
    LEFT JOIN sequence_frames f ON f.asset_id=a.id LEFT JOIN sequences s ON s.id=f.sequence_id
    WHERE ca.collection_id=c.id AND COALESCE(json_extract(a.metadata_json,'$.state'),'ready')='ready' AND s.pending_json IS NULL
    AND COALESCE(json_extract(a.metadata_json,'$.mode'),s.mode,'sfw')=c.mode) AS count
    FROM collections c WHERE c.mode=? ORDER BY c.name COLLATE NOCASE,c.id`).all(mode) as AssetCollection[];
}

function collection(db: Database.Database, id: string): AssetCollection {
  const row = db.prepare('SELECT mode FROM collections WHERE id=?').get(id) as {mode:Mode}|undefined;
  if (!row) throw new OrganizationError(404, 'collection_not_found', 'This collection is no longer available.');
  return collections(db,row.mode).find(item=>item.id===id)!;
}

function collectionName(db: Database.Database, value: string, mode: Mode, id?: string) {
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 80) throw new OrganizationError(400, 'invalid_collection_name', 'Use a collection name between 1 and 80 characters.');
  if (collections(db,mode).some(item=>item.id!==id && item.name.toLowerCase()===name.toLowerCase())) throw new OrganizationError(409, 'collection_name_exists', 'A collection with this name already exists.');
  return name;
}

export function registerAssetOrganization(app: FastifyInstance, db: Database.Database) {
  const handle = (fn: (request: FastifyRequest, reply: FastifyReply)=>unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    try { return fn(request,reply); }
    catch (error) {
      if (!(error instanceof OrganizationError)) throw error;
      return reply.code(error.status).send({error:{code:error.code,message:error.message,retryable:false},request_id:request.id});
    }
  };
  const nameSchema = {type:'string',maxLength:1000};
  const modeSchema = {enum:['sfw','nsfw']};
  app.get('/api/v1/collections',{schema:{querystring:{type:'object',additionalProperties:false,properties:{mode:modeSchema}}}},handle(request=>({items:collections(db,(request.query as {mode?:Mode}).mode??'sfw')})));
  app.post('/api/v1/collections',{schema:{body:{type:'object',additionalProperties:false,required:['name','mode'],properties:{name:nameSchema,mode:modeSchema}}}},handle((request,reply)=>{
    const body=request.body as {name:string;mode:Mode};
    const id=randomUUID(),name=collectionName(db,body.name,body.mode);
    db.prepare('INSERT INTO collections VALUES (?,?,?,?)').run(id,name,body.mode,new Date().toISOString());
    return reply.code(201).send(collection(db,id));
  }));
  app.patch('/api/v1/collections/:id',{schema:{body:{type:'object',additionalProperties:false,required:['name'],properties:{name:nameSchema}}}},handle(request=>{
    const id=(request.params as {id:string}).id, current=collection(db,id),name=collectionName(db,(request.body as {name:string}).name,current.mode,id);
    db.prepare('UPDATE collections SET name=? WHERE id=?').run(name,id);
    return collection(db,id);
  }));
  app.delete('/api/v1/collections/:id',handle((request,reply)=>{
    db.prepare('DELETE FROM collections WHERE id=?').run((request.params as {id:string}).id);
    return reply.code(204).send();
  }));
  app.get('/api/v1/assets/:id/organization',handle(request=>assetOrganization(db,(request.params as {id:string}).id)));
  app.put('/api/v1/assets/:id/favorite',{schema:{body:{type:'object',additionalProperties:false,required:['favorite'],properties:{favorite:{type:'boolean'}}}}},handle(request=>{
    const id=(request.params as {id:string}).id,favorite=(request.body as {favorite:boolean}).favorite;
    assetOrganization(db,id);
    if(favorite)db.prepare('INSERT OR IGNORE INTO asset_favorites VALUES (?)').run(id);
    else db.prepare('DELETE FROM asset_favorites WHERE asset_id=?').run(id);
    return {id,favorite};
  }));
  app.put('/api/v1/assets/:id/collections/:collectionId',{schema:{body:{type:'object',additionalProperties:false,required:['included'],properties:{included:{type:'boolean'}}}}},handle(request=>{
    const {id,collectionId}=request.params as {id:string;collectionId:string},asset=assetOrganization(db,id),target=collection(db,collectionId);
    if(asset.mode!==target.mode)throw new OrganizationError(409,'collection_mode_mismatch','This file cannot be added to this collection.');
    if((request.body as {included:boolean}).included)db.prepare('INSERT OR IGNORE INTO collection_assets VALUES (?,?)').run(collectionId,id);
    else db.prepare('DELETE FROM collection_assets WHERE collection_id=? AND asset_id=?').run(collectionId,id);
    return assetOrganization(db,id);
  }));
}
