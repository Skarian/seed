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
      const latest = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
      if ((latest.version ?? 0) > 5) throw new Error('This database requires a newer studio version.');
      if (!latest.version) { db.exec(`
        CREATE TABLE assets (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
          name TEXT NOT NULL,
          relative_path TEXT NOT NULL UNIQUE,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY, workflow TEXT NOT NULL, state TEXT NOT NULL,
          snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE dispatcher_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
          last_engine_session TEXT
        );
        INSERT INTO dispatcher_state (id, paused) VALUES (1, 1);
      `);
      db.prepare('INSERT INTO schema_migrations VALUES (1, ?)').run(new Date().toISOString());
      }
      if ((latest.version ?? 0) < 2) {
        db.exec(`CREATE TABLE submissions (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, body_json TEXT NOT NULL);
          ALTER TABLE jobs ADD COLUMN submission_id TEXT;
          ALTER TABLE jobs ADD COLUMN submission_index INTEGER;
          CREATE UNIQUE INDEX jobs_submission_index ON jobs(submission_id, submission_index);`);
        db.prepare('INSERT INTO schema_migrations VALUES (2, ?)').run(new Date().toISOString());
      }
      if ((latest.version ?? 0) < 3) {
        db.exec(`CREATE TABLE sequences (id TEXT PRIMARY KEY, mode TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, pending_json TEXT);
          CREATE TABLE sequence_frames (sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE, asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE, frame_index INTEGER NOT NULL, PRIMARY KEY(sequence_id,frame_index));`);
        db.prepare('INSERT INTO schema_migrations VALUES (3, ?)').run(new Date().toISOString());
      }
      if ((latest.version ?? 0) < 4) {
        db.exec(`CREATE TABLE asset_notes (id TEXT PRIMARY KEY, note TEXT NOT NULL, revision INTEGER NOT NULL);`);
        db.prepare('INSERT INTO schema_migrations VALUES (4, ?)').run(new Date().toISOString());
      }
      if ((latest.version ?? 0) < 5) {
        db.exec(`CREATE TABLE chats (id TEXT PRIMARY KEY, mode TEXT NOT NULL, body_json TEXT NOT NULL);
          CREATE TABLE job_cancel_intents (id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE);`);
        db.prepare('INSERT INTO schema_migrations VALUES (5, ?)').run(new Date().toISOString());
      }
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function listAssets(db: Database.Database, cursor = '', limit = 50, mode?: 'sfw' | 'nsfw', kind?:string): LibraryAsset[] {
  return db.prepare(`WITH items AS (
    SELECT id, kind, name, created_at,
      COALESCE(json_extract(metadata_json, '$.mode'), (SELECT json_extract(snapshot_json, '$.request.mode') FROM jobs WHERE jobs.id=json_extract(assets.metadata_json, '$.job_id')), CASE WHEN name = 'Image · NSFW' THEN 'nsfw' ELSE 'sfw' END) AS mode,
      NULL AS cover_id, NULL AS frame_count
    FROM assets WHERE COALESCE(json_extract(metadata_json, '$.state'), 'ready')='ready'
      AND NOT EXISTS (SELECT 1 FROM sequence_frames WHERE asset_id=assets.id)
    UNION ALL SELECT s.id, 'sequence', 'Image sequence', s.created_at, s.mode,
      (SELECT asset_id FROM sequence_frames WHERE sequence_id=s.id ORDER BY frame_index LIMIT 1),
      (SELECT COUNT(*) FROM sequence_frames WHERE sequence_id=s.id)
    FROM sequences s WHERE pending_json IS NOT NULL OR EXISTS(SELECT 1 FROM sequence_frames WHERE sequence_id=s.id)
  ) SELECT * FROM items WHERE (? IS NULL OR mode=?) AND (? IS NULL OR kind=?) AND (? = '' OR (created_at,id) < (SELECT created_at,id FROM items WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?`).all(mode??null,mode??null,kind??null,kind??null,cursor,cursor,limit).map((row:any)=> {
    if(row.kind!=='sequence'){ delete row.cover_id; delete row.frame_count; }
    return row;
  }) as LibraryAsset[];
}
