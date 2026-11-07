import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../server/db.js';

it('moves string-keyed choices into the typed record and drops unread agent histories, after a backup', () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/migration-'));
  try {
    let db = openDatabase(root);
    const legacy = {
      id: 'c1',
      picks: { 'ref:Noor': 'a', 'skip:The Pier': 'skip', 'shot:the walk:image': 'b', '5:clip': 'c', 'Opening:image': 'd' },
      runs: [{ id: 'r1', accounting: [], state: 'completed', prompt: { system: 'x' }, messages: [{ role: 'user' }], summary: {} }],
    };
    db.prepare("INSERT INTO chats (id, mode, body_json) VALUES ('c1', 'sfw', ?)").run(JSON.stringify(legacy));
    db.prepare('DELETE FROM schema_migrations WHERE version = 11').run();
    db.close();
    db = openDatabase(root);
    const chat = JSON.parse((db.prepare("SELECT body_json FROM chats WHERE id = 'c1'").get() as { body_json: string }).body_json);
    expect(chat.picks).toBeUndefined();
    expect(chat.choices).toEqual({
      references: { Noor: 'a', 'The Pier': 'skip' },
      takes: { 'the walk': { image: 'b' }, '#5': { clip: 'c' }, opening: { image: 'd' } },
    });
    expect(chat.runs).toEqual([{ id: 'r1', accounting: [], state: 'completed' }]);
    expect(existsSync(path.join(root, 'studio-before-chat-v11.sqlite'))).toBe(true);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
