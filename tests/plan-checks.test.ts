import { it, expect } from 'vitest';
import { askedFor, checkDraft, readablePrompt, editablePrompt } from '../web/app/project/checks.js';

// Synthetic fixtures only.
const message = (role: 'user' | 'assistant', text: string, id = Math.random().toString(36), assets: string[] = []) => ({ id, role, text, assets, created_at: '2026-11-04T00:00:00Z' });
const card = (request: any, run_id = 'run') => ({ id: 'card', workflow: request.workflow, revisions: [{ number: 1, request, notes: {}, decision: 'undecided' as const, job_ids: [], run_id }] });
const project = (messages: any[], extra: any = {}) => ({ messages, jobs: [], groups: [], asset_manifest: [], ...extra }) as any;

it('reads the newest explicit shape, length and sound from what the user wrote', () => {
  expect(askedFor([message('user', 'Make it square please'), message('user', 'Actually portrait 4:5, a 6-second clip, silent')] as any)).toEqual({ aspect: '4:5', seconds: 6, silent: true });
  expect(askedFor([message('user', 'A wide landscape shot with sound')] as any)).toEqual({ aspect: 'landscape', silent: false });
});

it('offers a one-tap fix when a draft ignores a supported shape', () => {
  const p = project([message('user', 'One portrait 4:5 image of a tent'), message('assistant', 'Ready', 'run')]);
  const checks = checkDraft(card({ workflow: 'text-to-image', prompt: 'tent', output: { aspect: '9:16', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' }) as any, p);
  expect(checks[0]!.text).toBe('You asked for portrait 4:5; this draft is portrait 9:16.');
  expect(checks[0]!.fixes[0]!.patch(card({ workflow: 'text-to-image', prompt: 'tent', output: { aspect: '9:16', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' }).revisions[0]!.request as any)).toMatchObject({ output: { aspect: '4:5' } });
});

it('turns an unsupported square video into a visible choice, and flags unused attachments', () => {
  const p = project([message('user', 'A 5-second square clip from this', 'ask', ['asset-a']), message('assistant', 'Prepared', 'run')]);
  const checks = checkDraft(card({ workflow: 'text-to-video', prompt: 'clip', output: { aspect: '16:9', size: '768p', duration_seconds: 5 }, count: 1, seed: 'random', mode: 'sfw', audio: { output: 'generated' } }) as any, p);
  expect(checks[0]!.text).toContain("which video can't make");
  expect(checks[0]!.fixes.map(f => f.label)).toEqual(['Use portrait 9:16', 'Keep landscape 16:9']);
  expect(checks.some(c => c.text.includes('not used by this draft'))).toBe(true);
});

it('shows input names instead of internal tokens', () => {
  const p = project([], { asset_manifest: [{ id: 'asset-a', name: 'Moss fox', kind: 'image', note: '' }] });
  expect(readablePrompt({ workflow: 'reference-to-video', prompt: '<Picture 1> wakes and blinks', references: [{ id: 'input1', asset_id: 'asset-a', kind: 'image', role: 'first_frame' }] } as any, p)).toBe('“Moss fox” wakes and blinks');
});

it('does not apply a request about one draft to its siblings', () => {
  const p = project([message('user', 'Make only the cat one landscape'), message('assistant', 'Updated', 'run')]);
  const draft = card({ workflow: 'text-to-image', prompt: 'teapot', output: { aspect: '4:5', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' });
  expect(checkDraft(draft as any, p, 4)).toEqual([]);
  const all = project([message('user', 'Make them all square'), message('assistant', 'Updated', 'run')]);
  expect(checkDraft(draft as any, all, 4)[0]!.text).toBe('You asked for square; this draft is portrait 4:5.');
});

it('shows structured video prompts as plain sections', () => {
  const text = readablePrompt({ workflow: 'text-to-video', prompt: 'integrated_multimodal_description: A paper wave rolls in.\n[Shot 1] Slow push.\noverall_soundscape: Silence.\nnon_diegetic_music: N/A' } as any, project([]));
  expect(text).toBe('Scene: A paper wave rolls in.\nShot 1: Slow push.\nSound: Silence.');
});

it('turns an unsupported ratio such as 3:2 into a visible choice with a crop path', () => {
  const p = project([message('user', 'Two dawn postcards in landscape 3:2, no words'), message('assistant', 'Prepared', 'run')]);
  const checks = checkDraft(card({ workflow: 'text-to-image', prompt: 'cafe', output: { aspect: '16:9', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' }) as any, p);
  expect(checks[0]!.text).toBe("You asked for 3:2, which Seed can't make directly. This draft is landscape 16:9. After it's made, Crop turns it into 3:2 on this device, no GPU.");
  expect(checks[0]!.fixes.map(f => f.label)).toEqual(['Keep landscape 16:9, crop to 3:2 after']);
});

it('edits a structured video prompt in readable form and converts it back exactly', () => {
  const p = project([], { asset_manifest: [{ id: 'asset-a', name: 'Lantern', kind: 'image', note: '' }] });
  const r = { workflow: 'reference-to-video', prompt: 'integrated_multimodal_description: <Picture 1> sways.\n[Shot 1] Slow push.\nnon_diegetic_music: N/A', references: [{ id: 'input1', asset_id: 'asset-a', kind: 'image', role: 'first_frame' }] } as any;
  const e = editablePrompt(r, p)!;
  expect(e.text).toBe('Scene: “Lantern” sways.\nShot 1: Slow push.');
  expect(e.back(e.text)).toBe(r.prompt);
  expect(e.back('Scene: “Lantern” sways gently.\nShot 1: Slow push.')).toBe('integrated_multimodal_description: <Picture 1> sways gently.\n[Shot 1] Slow push.\nnon_diegetic_music: N/A');
  expect(editablePrompt({ workflow: 'text-to-image', prompt: 'A plain prompt' } as any, p)).toBeNull();
});

it('points out sound nobody asked for, with silence one tap away', () => {
  const request = { workflow: 'text-to-video', prompt: 'steam rising', output: { aspect: '16:9', size: '768p', duration_seconds: 5 }, count: 1, seed: 'random', mode: 'sfw', audio: { output: 'generated' } };
  const quiet = checkDraft(card(request) as any, project([message('user', 'A 5-second clip of steam rising'), message('assistant', 'Prepared', 'run')]));
  const sound = quiet.find(c => c.text.includes('added sound'))!;
  expect(sound.fixes.map(f => f.label)).toEqual(['Make it silent', 'Keep the sound']);
  expect(sound.fixes[0]!.patch(request as any)).toMatchObject({ audio: { output: 'silent' } });
  const asked = checkDraft(card(request) as any, project([message('user', 'A clip of steam rising with soft ambient sound'), message('assistant', 'Prepared', 'run')]));
  expect(asked.some(c => c.text.includes('added sound'))).toBe(false);
});

it('turns a shot tag into a heading only at the start of a line', () => {
  const r = { workflow: 'reference-to-video', prompt: '[Shot 1] Mara climbs the stairs.\nThe lamp glows (as in [Shot 2]).', output: { aspect: '16:9', size: '768p' }, count: 1, seed: 'random', mode: 'sfw', references: [] };
  expect(readablePrompt(r as any, project([]))).toBe('Shot 1: Mara climbs the stairs.\nThe lamp glows (as in Shot 2).');
  expect(editablePrompt(r as any, project([]))).toBeNull();
});
