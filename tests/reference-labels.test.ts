import { expect, it } from 'vitest';
import { referenceLabels, referencePromptIssue, type Reference } from '../web/references.js';
const ref = (id: string, kind: Reference['kind'], extra = {}): Reference => ({ id, kind, role: 'reference', ...extra }) as Reference;
it('reports invalid reference tags without rewriting the prompt', () => {
  const items = [ref('a', 'image'), ref('b', 'image')];
  expect(referencePromptIssue('<Picture 3>', items)).not.toBe('');
  expect(referencePromptIssue('<Picture 2>', items)).toBe('');
});
it('labels standalone audio after paired video soundtracks', () => {
  const items = [ref('v1', 'video', { include_audio: true }), ref('v2', 'video', { include_audio: true }), ref('a', 'audio')];
  expect(referenceLabels(items).get('a')).toBe('<Audio 3>');
  expect(referenceLabels([{ ...items[0]!, include_audio: false }, ...items.slice(1)]).get('a')).toBe('<Audio 2>');
});
