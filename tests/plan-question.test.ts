import { it, expect } from 'vitest';
import { planStatus, seedAsks } from '../web/app/project/planStatus.js';

// Synthetic fixtures only.
const request = { workflow: 'text-to-image', prompt: 'A tent', output: { aspect: '16:9', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' };
const revision = (number: number, run_id?: string) => ({ number, request, notes: {}, decision: 'undecided', job_ids: [], ...(run_id ? { run_id } : {}) });
const say = (id: string, role: 'user' | 'assistant', text: string, minute: number) => ({
  id, role, text, assets: [], created_at: `2026-11-04T00:0${minute}:00Z`,
  ...(role === 'assistant' ? { transcript: { started_at: '', state: 'completed', steps: [] } } : {}),
});
const status = (cards: any[]) => {
  const plan = { id: 'plan', workflow: 'text-to-image', state: 'reviewing', cards } as any;
  const messages = [say('u1', 'user', 'Two tents', 1), say('t1', 'assistant', 'Both drafts are ready.', 2), say('u2', 'user', 'Make the second one wider', 3), say('t2', 'assistant', 'Krea can’t make 21:9, so I kept 16:9 instead. Would you prefer a crop guide?', 4)];
  return planStatus({ messages, groups: [plan], jobs: [], asset_manifest: [] } as any, plan, {}, new Set(), () => ({}) as any);
};

it('an old manual edit of another draft does not answer a new question; editing the draft Seed changed does', () => {
  const edited = { id: 'a', workflow: 'text-to-image', revisions: [revision(1, 't1'), revision(2)] };
  const asked = { id: 'b', workflow: 'text-to-image', revisions: [revision(1, 't1'), revision(2, 't2')] };
  expect(status([edited, asked]).question).toBe('Would you prefer a crop guide?');
  expect(status([edited, { ...asked, revisions: [...asked.revisions, revision(3)] }]).question).toBe('');
});

it('reads Seed asking from the reply alone, the same way everywhere', () => {
  expect(seedAsks('Which one do you mean?')).toBe(true);
  expect(seedAsks('Please attach the photo and I will start.')).toBe(true);
  expect(seedAsks('The drafts are ready.')).toBe(false);
});
