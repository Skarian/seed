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
