import { it, expect } from 'vitest';
import { turnOutcome } from '../shared/turn.js';
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
  expect(turnOutcome(turn).unfinished).toEqual([{ label: 'Approve a reference for Amara', reason: 'No cast entry is named Amara.' }]);
  expect(turnOutcome({ ...turn, state: 'running' }).unfinished).toEqual([]);
});

it('reads a step’s stored failure, and names every tool, ordering included', () => {
  const failed = (name: string, input: unknown, failure: { error: string; internal: boolean }) => ({
    ...tool(name, 'failed', input),
    result: { content: [] },
    failure,
  });
  const turn: TurnTranscript = {
    started_at: at,
    state: 'completed',
    steps: [
      failed('order_requests', { order: ['a'] }, { error: 'List every draft once.', internal: false }),
      // A stored failure is believed as it is: no wording turns it into Seed's own slip.
      failed('create_request', { title: 'Shot 1' }, { error: 'request_id is stale', internal: false }),
    ],
  };
  expect(turnOutcome(turn).unfinished).toEqual([
    { label: 'Order the plan', reason: 'List every draft once.' },
    { label: 'Write a draft: Shot 1', reason: 'request_id is stale' },
  ]);
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
  expect(turnOutcome(turn).unfinished).toEqual([{ label: 'Change a draft', reason: 'This source belongs to multiple existing inputs.' }]);
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
  const ok = (name: string, input: unknown, details?: unknown) => ({
    ...tool(name, 'succeeded', input),
    result: { content: [{ type: 'text', text: JSON.stringify(details ?? { ok: true }) }], details: details ?? { ok: true } },
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
  expect(turnOutcome(turn).done).toEqual([
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
  expect(turnOutcome(turn).unfinished).toEqual([{ label: 'Write a draft: Watercolor study', reason: 'Seed couldn’t finish this step. Nothing was lost; ask again to retry it.' }]);
});

it('keeps a slip on one real draft listed when only another draft was changed afterwards', () => {
  const slip = { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Bad field.', internal: true }) }] };
  const turn: TurnTranscript = {
    started_at: at,
    state: 'completed',
    steps: [
      { ...tool('edit_request', 'failed', { request_id: 'a' }), result: slip },
      tool('edit_request', 'succeeded', { request_id: 'b' }),
    ],
  };
  const titles: Record<string, string> = { a: 'Shot 1', b: 'Shot 2' };
  expect(turnOutcome(turn, id => titles[id]).unfinished.map(u => u.label)).toEqual(['Change a draft: Shot 1']);
  // The same slip naming a draft that no longer exists (a stale id) is made good by the later change.
  expect(turnOutcome(turn, id => (id === 'b' ? 'Shot 2' : undefined)).unfinished).toEqual([]);
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

it('tells a saved style from a look described in words', async () => {
  const { asksSavedStyle } = await import('../shared/styles-asked.js');
  expect(asksSavedStyle('use the Tonal study style at 0.7')).toBe(true);
  expect(asksSavedStyle('in my Watercolor study style')).toBe(true);
  expect(asksSavedStyle('use the “Tonal study” style')).toBe(true);
  expect(asksSavedStyle('in a hand-painted gouache style')).toBe(false);
  expect(asksSavedStyle('Gouache style throughout, warm light')).toBe(false);
});
