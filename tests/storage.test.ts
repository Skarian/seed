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
  it('preserves media, metadata and dispatcher state across repeated setup/reopen', () => {
    const paths = fixture();
    const file = path.join(paths.data, 'media/originals/example.txt');
    writeFileSync(file, 'unique original');
    const db = openDatabase(paths.data);
    db.prepare('INSERT INTO assets(id, kind, name, relative_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('asset-1', 'image', 'My original', 'media/originals/example.txt', '2026-09-09T00:00:00Z');
    db.prepare('UPDATE dispatcher_state SET paused = 0 WHERE id = 1').run();
    db.close();
    prepareStorage(paths);
    const reopened = openDatabase(paths.data);
    try {
      expect(readFileSync(file, 'utf8')).toBe('unique original');
      expect(listAssets(reopened)).toEqual([{ id: 'asset-1', kind: 'image', mode: 'sfw', name: 'My original', created_at: '2026-09-09T00:00:00Z' }]);
      expect(reopened.prepare('SELECT paused FROM dispatcher_state').get()).toEqual({ paused: 0 });
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 3 });
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
      expect(standard.data).toBe(path.join(process.env.LOCALAPPDATA!, 'RunpodStudio', 'Data'));
      expect(standard.config).toBe(path.join(process.env.APPDATA!, 'RunpodStudio', 'Config'));
    }
  });
});
