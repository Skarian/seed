import { expect, it } from 'vitest';
import { generationDraftReducer, restoreGenerationDrafts } from '../web/generation-draft.js';

it('defaults new videos to 20 steps while preserving old 30-step drafts and explicit selections',()=>{
  expect(restoreGenerationDrafts()['text-to-video'].request.steps).toBe(20);
  expect(restoreGenerationDrafts({'text-to-video':{request:{prompt:'Old video'}}})['text-to-video'].request.steps).toBe(30);
  const saved=restoreGenerationDrafts({'reference-to-video':{request:{prompt:'Six inputs',steps:15}}});
  expect(saved['reference-to-video'].request.steps).toBe(15);
  expect(restoreGenerationDrafts(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  expect(saved['text-to-image'].request.steps).toBeUndefined();
});

it('migrates saved prompts, settings, and repeat seeds from the original draft format', () => {
  const restored = restoreGenerationDrafts({
    'text-to-video': {
      prompt: 'A quiet lake',
      count: 2,
      aspect: '9:16',
      duration: '10',
      seed: '42',
      randomSeed: false,
      resolvedSeeds: ['42', '43'],
      audio: 'silent',
      sourceJob: 'prior',
    },
  });
  expect(restored['text-to-video']).toMatchObject({
    sourceJob: 'prior',
    request: {
      prompt: 'A quiet lake',
      count: 2,
      output: { aspect: '9:16', size: '768p', duration_seconds: 10 },
      seed: '42',
      resolved_seeds: ['42', '43'],
      audio: { output: 'silent' },
    },
  });
  expect(restored['text-to-image'].request.prompt).toBe('');
  expect(restoreGenerationDrafts(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
});

it('isolates workflow changes and invalidates repeat seeds only when their sequence changes', () => {
  const initial = restoreGenerationDrafts({
    'text-to-image': {
      request: { prompt: 'Old prompt', count: 2, seed: 'random', resolved_seeds: ['7', '8'] },
      sourceJob: 'prior',
    },
  });
  const changed = generationDraftReducer(initial, {
    type: 'change',
    workflow: 'text-to-image',
    patch: { prompt: 'New prompt' },
  });
  expect(changed['text-to-image'].request.resolved_seeds).toEqual(['7', '8']);
  expect(changed['text-to-video']).toBe(initial['text-to-video']);
  expect(initial['text-to-image'].request.prompt).toBe('Old prompt');
  for (const patch of [{ count: 4 }, { seed: '9' }])
    expect(
      generationDraftReducer(changed, { type: 'change', workflow: 'text-to-image', patch })[
        'text-to-image'
      ].request.resolved_seeds,
    ).toBeUndefined();
  const reset = generationDraftReducer(changed, { type: 'reset', workflow: 'text-to-image' });
  expect(reset['text-to-image'].sourceJob).toBeUndefined();
  expect(reset['text-to-image'].request.prompt).toBe('');
});

it('normalizes invalid saved settings without discarding a valid prompt', () => {
  const restored = restoreGenerationDrafts({
    'reference-to-video': {
      prompt: 'Keep this',
      count: -1,
      duration: 'not a number',
      resolvedSeeds: ['1', '2'],
    },
  });
  expect(restored['reference-to-video'].request).toMatchObject({
    prompt: 'Keep this',
    count: 1,
    seed: 'random',
    output: { duration_seconds: 5 },
  });
  expect(restored['reference-to-video'].request.resolved_seeds).toBeUndefined();
});
