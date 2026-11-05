import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { LibraryAsset } from '../shared/studio.js';

export function openDatabase(dataDirectory: string) {
  const db = new Database(path.join(dataDirectory, 'studio.sqlite'));
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.transaction(() => {
      const latest = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {version:number|null};
      if (latest.version === 7 || latest.version === 8 || latest.version === 9 || latest.version === 10) return;
      if (latest.version === 6) {
        // Preserve old held requests instead of unexpectedly submitting them during migration.
        const state=db.prepare('SELECT paused FROM dispatcher_state WHERE id=1').get() as {paused:number};
        if(state.paused)db.exec(`UPDATE jobs SET state='blocked', snapshot_json=json_set(snapshot_json,'$.state','blocked','$.error','Review this request before continuing.') WHERE state='queued'`);
        db.exec('DROP TABLE dispatcher_state');
        db.prepare('INSERT INTO schema_migrations VALUES (7,?)').run(new Date().toISOString());
        return;
      }
      if (latest.version !== null) throw Error('This database belongs to another Seed schema. Use a fresh data directory.');
      db.exec(`
        CREATE TABLE assets (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('image','video','audio')), name TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
        CREATE TABLE jobs (id TEXT PRIMARY KEY, workflow TEXT NOT NULL, state TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submission_id TEXT NOT NULL, submission_index INTEGER NOT NULL);
        CREATE UNIQUE INDEX jobs_submission_index ON jobs(submission_id,submission_index);
        CREATE TABLE submissions (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, body_json TEXT NOT NULL);
        CREATE TABLE sequences (id TEXT PRIMARY KEY, mode TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, pending_json TEXT);
        CREATE TABLE sequence_frames (sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE, asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE, frame_index INTEGER NOT NULL, PRIMARY KEY(sequence_id,frame_index));
        CREATE TABLE asset_notes (id TEXT PRIMARY KEY, note TEXT NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE chats (id TEXT PRIMARY KEY, mode TEXT NOT NULL, body_json TEXT NOT NULL);
        CREATE TABLE job_cancel_intents (id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE);
      `);
      db.prepare('INSERT INTO schema_migrations VALUES (7,?)').run(new Date().toISOString());
    })();
    const version=(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {version:number}).version;
    if(version===7) {
      const backup=path.join(dataDirectory,'studio-before-pool.sqlite');
      if(!existsSync(backup))db.prepare('VACUUM INTO ?').run(backup);
      db.transaction(()=>{
        db.exec(`CREATE TABLE pool_workers (id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);
          CREATE TABLE pool_launches (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, body_json TEXT NOT NULL, worker_ids_json TEXT NOT NULL);
          CREATE TABLE pool_offers (id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);
          CREATE TABLE job_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), worker_id TEXT NOT NULL REFERENCES pool_workers(id), state TEXT NOT NULL, snapshot_json TEXT NOT NULL);
          CREATE UNIQUE INDEX one_worker_attempt ON job_attempts(worker_id) WHERE state='active';
          CREATE UNIQUE INDEX one_job_attempt ON job_attempts(job_id) WHERE state='active';`);
        db.prepare('INSERT INTO schema_migrations VALUES (8,?)').run(new Date().toISOString());
      })();
    }
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS diagnostic_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, category TEXT NOT NULL,
        level TEXT NOT NULL, worker_id TEXT, provider TEXT, request_id TEXT, operation TEXT NOT NULL, data_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS diagnostic_worker ON diagnostic_events(worker_id,id);
        CREATE INDEX IF NOT EXISTS diagnostic_time ON diagnostic_events(at);
        CREATE TABLE IF NOT EXISTS worker_startup_logs (worker_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS acquisition_history (
          worker_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, provider TEXT NOT NULL,
          worker_class TEXT NOT NULL, snapshot_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS acquisition_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id TEXT NOT NULL, at TEXT NOT NULL,
          operation TEXT NOT NULL, data_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS acquisition_worker ON acquisition_events(worker_id,id);
        CREATE TABLE IF NOT EXISTS acquisition_failures (
          worker_id TEXT NOT NULL, signature TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
          occurrences INTEGER NOT NULL, operation TEXT NOT NULL, data_json TEXT NOT NULL,
          PRIMARY KEY(worker_id,signature));`);
      db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (9,?)').run(new Date().toISOString());
    })();
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS asset_favorites (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('sfw','nsfw')), created_at TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS collection_names ON collections(mode,name COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS collection_assets (
          collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY(collection_id,asset_id));
        CREATE INDEX IF NOT EXISTS asset_collections ON collection_assets(asset_id);`);
      db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (10,?)').run(new Date().toISOString());
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export type AssetFilters = {favorites?:boolean;collection_id?:string;q?:string;source?:'made'|'uploaded';chat_id?:string;order?:'newest'|'oldest'};
export function listAssets(db: Database.Database, cursor = '', limit = 50, mode?: 'sfw' | 'nsfw', kind?:string, filters: AssetFilters = {}): LibraryAsset[] {
  const oldest = filters.order === 'oldest';
  // Search matches every word, in any order and anywhere in the prompt, title or note ("Maren brick-red").
  const terms = (filters.q ?? '').toLowerCase().replace(/[%_]/g, '').split(/\s+/).filter(Boolean).map(w => '%' + w + '%');
  const q = terms[0] ?? null, more = terms.slice(1);
  const rows = db.prepare(`WITH items AS (
    SELECT a.id, a.kind, a.name, a.created_at,
      j.id AS job_id,
      json_extract(j.snapshot_json, '$.request.title') AS title,
      json_extract(j.snapshot_json, '$.source.chat_id') AS chat_id,
      json_extract(j.snapshot_json, '$.submission_index') AS submission_index,
      json_extract(j.snapshot_json, '$.request.count') AS batch_count,
      lower(COALESCE(json_extract(j.snapshot_json, '$.request.prompt'), '') || ' ' || COALESCE(json_extract(j.snapshot_json, '$.request.title'), '') || ' ' || COALESCE((SELECT note FROM asset_notes WHERE id=a.id), '') || ' ' || a.name) AS haystack,
      json_extract(a.metadata_json, '$.executor') AS executor,
      json_extract(a.metadata_json, '$.execution_profile') AS execution_profile,
      COALESCE(json_extract(a.metadata_json, '$.mode'), s.mode, 'sfw') AS mode,
      EXISTS(SELECT 1 FROM asset_favorites WHERE asset_id=a.id) AS favorite,
      (SELECT note FROM asset_notes WHERE id=a.id) AS note,
      json_extract(a.metadata_json, '$.width') AS width,
      json_extract(a.metadata_json, '$.height') AS height
    FROM assets a
    LEFT JOIN jobs j ON j.id=json_extract(a.metadata_json, '$.job_id')
    LEFT JOIN sequence_frames f ON f.asset_id=a.id
    LEFT JOIN sequences s ON s.id=f.sequence_id
    WHERE COALESCE(json_extract(a.metadata_json, '$.state'), 'ready')='ready'
      AND s.pending_json IS NULL
  ) SELECT * FROM items WHERE (? IS NULL OR mode=?) AND (? IS NULL OR kind=?)
    AND (?=0 OR favorite=1)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM collection_assets ca JOIN collections c ON c.id=ca.collection_id WHERE ca.asset_id=items.id AND c.id=? AND c.mode=items.mode))
    AND (? IS NULL OR haystack LIKE ?)${more.map(() => ' AND haystack LIKE ?').join('')}
    AND (? IS NULL OR (?='made' AND job_id IS NOT NULL) OR (?='uploaded' AND job_id IS NULL))
    AND (? IS NULL OR chat_id=?)
    AND (? = '' OR (created_at,id) ${oldest ? '>' : '<'} (SELECT created_at,id FROM items WHERE id=?))
    ORDER BY created_at ${oldest ? 'ASC' : 'DESC'},id ${oldest ? 'ASC' : 'DESC'} LIMIT ?`).all(mode??null,mode??null,kind??null,kind??null,filters.favorites?1:0,filters.collection_id??null,filters.collection_id??null,q,q,...more,filters.source??null,filters.source??null,filters.source??null,filters.chat_id??null,filters.chat_id??null,cursor,cursor,limit) as Array<Omit<LibraryAsset,'favorite'> & {favorite:number;haystack?:string;job_id:string|null;title:string|null;chat_id:string|null;submission_index:number|null;batch_count:number|null;note:string|null;width:number|null;height:number|null}>;
  return rows.map(({executor,execution_profile,haystack:_haystack,job_id,title,chat_id,submission_index,batch_count,note,width,height,...row})=>({...row,favorite:Boolean(row.favorite),...(note?{note}:{}),...(width&&height?{width:Number(width),height:Number(height)}:{}),...(Number(batch_count)>1&&submission_index!=null?{variant:Number(submission_index)+1,variants:Number(batch_count)}:{}),...(job_id?{job_id}:{}),...(title?{title}:{}),...(chat_id?{chat_id}:{}),
    ...(executor==='local'||executor==='cloud'?{executor}:{}),...(typeof execution_profile==='string'?{execution_profile}:{})}));
}
