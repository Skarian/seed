import { it, expect } from 'vitest';
import { unfinishedSteps } from '../web/app/project/turnSteps.js';
import { briefGapList } from '../web/app/project/checks.js';
import { sameCast } from '../shared/cast.js';
import type { TurnTranscript } from '../shared/chat.js';

const at = '2026-01-01T00:00:00.000Z';
const tool = (name: string, state: 'succeeded' | 'failed', input: unknown, error?: string) => ({
  id: Math.random().toString(36),
  kind: 'tool' as const,
  name,
  state,
  input,
  result: error ? { content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }] } : { content: [] },
  started_at: at,
});

it('lists failed steps that a later step did not make good', () => {
  const turn: TurnTranscript = {
    started_at: at,
    state: 'completed',
    steps: [
      tool('approve_reference', 'failed', { name: 'Amara', input: 'input3' }, 'No cast entry is named Amara.'),
      tool('approve_reference', 'failed', { name: 'Amara', input: 'input3' }, 'No cast entry is named Amara.'),
      tool('approve_reference', 'failed', { name: 'Teo', input: 'input4' }, 'Unknown input.'),
      tool('approve_reference', 'succeeded', { name: 'Teo', input: 'input5' }),
      tool('update_brief', 'failed', { brief: 'x' }, 'Too long.'),
      tool('update_brief', 'succeeded', { brief: 'y' }),
    ],
  };
  expect(unfinishedSteps(turn)).toEqual([{ label: 'Approve a reference for Amara', reason: 'No cast entry is named Amara.' }]);
  expect(unfinishedSteps({ ...turn, state: 'running' })).toEqual([]);
});

it('reads titled names and leaves delivery notes out of the brief check', () => {
  const brief =
    '## Characters\n- Dr. Amara Okafor-Lind: 52, silver-rimmed glasses, cheeky\n## Rules\n- Delivery: 2.39:1 widescreen (via Crop)';
  const gaps = briefGapList('Amara at the telescope, wide night sky.', brief);
  expect(gaps).toEqual([{ who: 'Amara', text: 'silver-rimmed glasses' }]);
  expect(sameCast('Dr. Amara Okafor-Lind', 'Amara')).toBe(true);
  expect(sameCast('Dr. Amara Okafor-Lind', 'Dr. Teo')).toBe(false);
});

it('reads a plain-text tool error, not the part type', () => {
  const turn: TurnTranscript = {
    started_at: at,
    state: 'completed',
    steps: [{ ...tool('edit_request', 'failed', { request_id: 'c1' }), result: { content: [{ type: 'text', text: 'This source belongs to multiple existing inputs.' }] } }],
  };
  expect(unfinishedSteps(turn)).toEqual([{ label: 'Change a draft', reason: 'This source belongs to multiple existing inputs.' }]);
});

it('keeps a swapped-out character as a reference and repoints the prompt', async () => {
  const { swapInput } = await import('../web/app/project/swap.js');
  const r = {
    workflow: 'image-to-image',
    prompt: 'Noor from <image1>, Ilse from <image2>, on the pier from <image3>.',
    references: [
      { id: 'input1', asset_id: 'noor', kind: 'image', role: 'source' },
      { id: 'input2', asset_id: 'ilse', kind: 'image', role: 'reference' },
      { id: 'input3', asset_id: 'pier', kind: 'image', role: 'reference' },
    ],
  } as any;
  const next = swapInput(r, 'input1', { id: 'pier', kind: 'image' }, true);
  expect(next.references.map((x: any) => x.role + ':' + x.asset_id)).toEqual(['source:pier', 'reference:ilse', 'reference:noor']);
  expect(next.prompt).toBe('Noor from <image3>, Ilse from <image2>, on the pier from <image1>.');
  const plain = swapInput(r, 'input2', { id: 'other', kind: 'image' }, false);
  expect(plain.prompt).toBe(r.prompt);
  expect(plain.kept).toBe(false);
});

it('reads someone’s portrait as a picture, not a portrait shape', async () => {
  const { askedFor } = await import('../web/app/project/checks.js');
  const m = (text: string) => [{ id: 'm', role: 'user', text, assets: [], created_at: '' }] as any;
  expect(askedFor(m("Use The Pier as the base instead of Noor's portrait.")).aspect).toBeUndefined();
  expect(askedFor(m('Make it portrait, please.')).aspect).toBe('portrait');
});

it('builds a receipt from the tools that succeeded, not from the reply', async () => {
  const { turnReceipt } = await import('../web/app/project/turnSteps.js');
  const ok = (name: string, input: unknown, json?: unknown) => ({
    ...tool(name, 'succeeded', input),
    result: { content: [{ type: 'text', text: JSON.stringify(json ?? { ok: true }) }] },
  });
  const turn: TurnTranscript = {
    started_at: at,
    state: 'completed',
    steps: [
      ok('update_brief', { brief: 'x' }, { ok: true, cast_added: ['Teo'] }),
      ok('create_request', { title: 'Shot 1: The Arrival' }, { ok: true, request: { title: 'Shot 1: The Arrival' } }),
      ok('create_request', { title: 'Shot 2: The Mug' }),
      tool('approve_reference', 'failed', { name: 'Noor' }, 'No such input.'),
      ok('edit_request', { request_id: 'c3' }, { ok: true, request: { title: 'Shot 3: The Rope' } }),
    ],
  };
  expect(turnReceipt(turn)).toEqual([
    'Drafted Shot 1: The Arrival, Shot 2: The Mug',
    'Changed Shot 3: The Rope',
    'Saved the brief (added Teo to the cast)',
  ]);
});

it('hides a draft failure a later try made good, and never shows raw JSON', () => {
  const turn: TurnTranscript = {
    started_at: at,
    state: 'completed',
    steps: [
      { ...tool('create_request', 'failed', { title: 'Shot 1: The Rock' }), result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, saved: false, errors: [{ field: 'inputs[0].role', message: 'Use first_frame for a start frame.' }] }) }] } },
      tool('create_request', 'succeeded', { title: 'Shot 1: The Rock' }),
      { ...tool('create_request', 'failed', { title: 'Watercolor study' }), result: { content: [{ type: 'text', text: 'Validation failed for tool "create_request": - root: must not have additional properties' }] } },
    ],
  };
  expect(unfinishedSteps(turn)).toEqual([{ label: 'Write a draft', reason: 'Seed sent it in the wrong form.' }]);
});

it('adds missing details after the whole name, without labels or unseen clothes', async () => {
  const { briefGapList, addBriefDetails } = await import('../web/app/project/checks.js');
  const brief = '## Characters\n- Marit Halvorsen: 62, cropped silver hair, Wardrobe: mustard-yellow oilskin coat, black rubber boots';
  const prompt = 'Head-and-shoulders portrait of Marit Halvorsen, a 62-year-old woman, on a plain grey background.';
  const gaps = briefGapList(prompt, brief);
  expect(gaps.map(g => g.text)).toContain('mustard-yellow oilskin coat');
  expect(gaps.some(g => /boots|wardrobe/i.test(g.text))).toBe(false);
  const out = addBriefDetails(prompt, gaps);
  expect(out).toMatch(/^Head-and-shoulders portrait of Marit Halvorsen, with [^,]*mustard-yellow oilskin coat/);
  expect(out).not.toMatch(/Marit,/);
});
