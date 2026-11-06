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
