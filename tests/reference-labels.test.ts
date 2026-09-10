import { expect, it } from 'vitest';
import { referenceLabels, referencePromptIssue, remapReferencePrompt, type Reference } from '../web/references.js';
const ref = (id: string, kind: Reference['kind'], extra = {}): Reference => ({ id, kind, role: 'reference', ...extra }) as Reference;

it('remaps all labels simultaneously and marks removed or reclassified references', () => {
  const before = [ref('a', 'image'), ref('b', 'image'), ref('c', 'image')];
  expect(remapReferencePrompt('<Picture 1> and <Picture 2> beside <Picture 3>', before, before.slice(1)))
    .toBe('[removed reference] and <Picture 1> beside <Picture 2>');
  expect(remapReferencePrompt('<Picture 1> beside <Picture 2>', before.slice(1), [ref('b', 'image', { role: 'first_frame' }), before[2]!]))
    .toBe('[removed reference] beside <Picture 1>');
  expect(referencePromptIssue('[removed reference]', before)).not.toBe('');
  expect(referencePromptIssue('<Picture 4>', before)).not.toBe('');
  expect(referencePromptIssue('<Picture 2>', before)).toBe('');
});

it('tracks paired audio by video identity while standalone audio indices shift', () => {
  const before = [ref('v1', 'video', { include_audio: true }), ref('v2', 'video', { include_audio: true }), ref('a', 'audio')];
  expect(referenceLabels(before).get('a')).toBe('<Audio 3>');
  const after = [ref('v1', 'video', { include_audio: false }), before[1]!, before[2]!];
  expect(remapReferencePrompt('<Audio 1> <Audio 2> <Audio 3> <Video 1>', before, after))
    .toBe('[removed reference] <Audio 1> <Audio 2> <Video 1>');
});
