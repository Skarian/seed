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
      if ((latest.version ?? 0) > 1) throw new Error('This database requires a newer studio version.');
      if (latest.version === 1) return;
      db.exec(`
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
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function listAssets(db: Database.Database): LibraryAsset[] {
  return db.prepare('SELECT id, kind, name, created_at FROM assets ORDER BY created_at DESC, id DESC LIMIT 50').all() as LibraryAsset[];
}
