import Database from 'better-sqlite3';
import path from 'node:path';
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
      if (latest.version === 7) return;
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
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function listAssets(db: Database.Database, cursor = '', limit = 50, mode?: 'sfw' | 'nsfw', kind?:string): LibraryAsset[] {
  return db.prepare(`WITH items AS (
    SELECT a.id, a.kind, a.name, a.created_at,
      COALESCE(json_extract(a.metadata_json, '$.mode'), s.mode, 'sfw') AS mode
    FROM assets a
    LEFT JOIN sequence_frames f ON f.asset_id=a.id
    LEFT JOIN sequences s ON s.id=f.sequence_id
    WHERE COALESCE(json_extract(a.metadata_json, '$.state'), 'ready')='ready'
      AND s.pending_json IS NULL
  ) SELECT * FROM items WHERE (? IS NULL OR mode=?) AND (? IS NULL OR kind=?) AND (? = '' OR (created_at,id) < (SELECT created_at,id FROM items WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?`).all(mode??null,mode??null,kind??null,kind??null,cursor,cursor,limit) as LibraryAsset[];
}
