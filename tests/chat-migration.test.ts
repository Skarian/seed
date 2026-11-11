import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../server/db.js';

it('moves string-keyed choices into the typed record and folds each run into its turn, after a backup', () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/migration-'));
  try {
    let db = openDatabase(root);
    const legacy = {
      id: 'c1',
      picks: { 'ref:Noor': 'a', 'skip:The Pier': 'skip', 'shot:the walk:image': 'b', '5:clip': 'c', 'Opening:image': 'd' },
      messages: [{ id: 'r1', role: 'assistant', text: '', assets: [], transcript: { started_at: 'x', state: 'completed', steps: [] } }],
      runs: [
        {
          id: 'r1',
          workflow: 'text-to-image',
          source_assets: ['a'],
          target_request_id: 'card-1',
          accounting: [{ id: 'u1', cost: 0.01 }],
          state: 'completed',
          prompt: { system: 'x' },
          messages: [{ role: 'user' }],
          summary: {},
        },
      ],
    };
    db.prepare("INSERT INTO chats (id, mode, body_json) VALUES ('c1', 'sfw', ?)").run(JSON.stringify(legacy));
    db.prepare('DELETE FROM schema_migrations WHERE version >= 11').run();
    db.close();
    db = openDatabase(root);
    const chat = JSON.parse((db.prepare("SELECT body_json FROM chats WHERE id = 'c1'").get() as { body_json: string }).body_json);
    expect(chat.picks).toBeUndefined();
    expect(chat.choices).toEqual({
      references: { Noor: 'a', 'The Pier': 'skip' },
      takes: { 'the walk': { image: 'b' }, '#5': { clip: 'c' }, opening: { image: 'd' } },
    });
    expect(chat.runs).toBeUndefined();
    expect(chat.accounting).toEqual([{ id: 'u1', cost: 0.01 }]);
    expect(chat.messages[0].transcript.scope).toEqual({
      workflow: 'text-to-image',
      source_assets: ['a'],
      target_request_id: 'card-1',
    });
    expect(existsSync(path.join(root, 'studio-before-chat-v11.sqlite'))).toBe(true);
    expect((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(12);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
