import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolvePaths, prepareStorage } from '../server/storage.js';
import { listAssets, openDatabase } from '../server/db.js';

const roots: string[] = [];
function fixture() {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/storage-')); roots.push(root);
  const paths = resolvePaths(root); prepareStorage(paths); return paths;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('persistent local storage', () => {
  it('preserves media and metadata across repeated setup/reopen', () => {
    const paths = fixture();
    const file = path.join(paths.data, 'media/originals/example.txt');
    writeFileSync(file, 'unique original');
    const db = openDatabase(paths.data);
    db.prepare('INSERT INTO assets(id, kind, name, relative_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('asset-1', 'image', 'My original', 'media/originals/example.txt', '2026-09-09T00:00:00Z');
    db.close();
    prepareStorage(paths);
    const reopened = openDatabase(paths.data);
    try {
      expect(readFileSync(file, 'utf8')).toBe('unique original');
      expect(listAssets(reopened)).toEqual([{ id: 'asset-1', kind: 'image', mode: 'sfw', name: 'My original', created_at: '2026-09-09T00:00:00Z', favorite:false }]);
      expect(reopened.prepare("SELECT name FROM sqlite_master WHERE name='dispatcher_state'").get()).toBeUndefined();
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 4 });
      expect(reopened.pragma('synchronous', { simple: true })).toBe(2);
    } finally { reopened.close(); }
  });

  it('keeps durable media outside disposable cache and temp', () => {
    const paths = fixture();
    const file = path.join(paths.data, 'media/outputs/saved.txt'); writeFileSync(file, 'saved result');
    for (const directory of [paths.cache, paths.temp]) rmSync(directory, { recursive: true });
    prepareStorage(paths);
    expect(readFileSync(file, 'utf8')).toBe('saved result');
    if (process.platform === 'win32') {
      const standard = resolvePaths();
      expect(standard.data).toBe(path.join(process.env.LOCALAPPDATA!, 'Seed', 'Data'));
      expect(standard.config).toBe(path.join(process.env.APPDATA!, 'Seed', 'Config'));
    }
  });
});

it('migrates the old pause state without submitting held work or removing saved media',()=>{
  const paths=fixture(),db=openDatabase(paths.data);
  db.exec("DROP TABLE job_attempts; DROP TABLE pool_workers; DROP TABLE pool_launches; DROP TABLE pool_offers; DELETE FROM schema_migrations; INSERT INTO schema_migrations VALUES (6, 'before'); CREATE TABLE dispatcher_state (id INTEGER PRIMARY KEY, paused INTEGER); INSERT INTO dispatcher_state VALUES (1,1);");
  const job={id:'held',state:'queued',request:{prompt:'keep this request'},outputs:[]};
  db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)').run('held','text-to-image','queued',JSON.stringify(job),'before','before','submission',0);
  db.prepare('INSERT INTO assets(id,kind,name,relative_path,created_at) VALUES (?,?,?,?,?)').run('saved','image','Saved image','media/output.png','before');db.close();
  const migrated=openDatabase(paths.data);
  try{
    expect(JSON.parse((migrated.prepare('SELECT snapshot_json FROM jobs').get() as any).snapshot_json)).toMatchObject({state:'blocked',request:job.request});
    expect(listAssets(migrated)).toHaveLength(1);
    expect(migrated.prepare("SELECT name FROM sqlite_master WHERE name='dispatcher_state'").get()).toBeUndefined();
    expect(migrated.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({version:10});
  }finally{migrated.close();}
});
