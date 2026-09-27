import { expect, it } from 'vitest';
import type { ChatCard, ChatGroup, ChatRevision } from '../shared/chat.js';
import { submissionStatus } from '../web/chat-submission-status.js';

function card(id: string, decision: ChatRevision['decision'] = 'approved'): ChatCard {
  return {
    id,
    workflow: 'text-to-image',
    revisions: [{ number: 1, decision, notes: {}, job_ids: [], request: {
      workflow: 'text-to-image', mode: 'sfw', prompt: 'Synthetic landscape', seed: '42', count: 1,
      output: { aspect: '16:9', size: '1mp' },
    } }],
  };
}
function group(...cards: ChatCard[]): ChatGroup {
  return { id: 'group', workflow: 'text-to-image', state: 'reviewing', cards };
}
const status = (g: ChatGroup, c = g.cards[0]!, activity: 'idle' | 'preparing' = 'idle') => submissionStatus(g, c, c.revisions.at(-1)!, activity);

it('waiting counts current sibling decisions and points at the next real card', () => {
  const first = card('first'), next = card('second', 'undecided'), last = card('third', 'undecided');
  const g = group(first, next, last, card('denied', 'denied'));
  expect(status(g)).toMatchObject({ kind: 'waiting', label: 'Waiting for 2 other decisions', next });
  next.revisions.push({ ...next.revisions[0]!, number: 2, decision: 'denied' });
  expect(status(g)).toMatchObject({ kind: 'waiting', label: 'Waiting for 1 other decision', next: last });
});

it('preparation overrides prior failure while Stop remains authoritative', () => {
  const g = group(card('first'));
  g.submission_error = 'Input could not be prepared.';
  expect(status(g, undefined, 'preparing')).toEqual({ kind: 'preparing', label: 'Preparing…' });
  g.state = 'stopped';
  expect(status(g, undefined, 'preparing')).toEqual({ kind: 'stopped', label: 'Stopped' });
});

it('failed starts explain that Retry applies to the approved group', () => {
  const g = group(card('first'), card('second'), card('denied', 'denied'));
  g.submission_error = 'Input could not be prepared.';
  expect(status(g)).toMatchObject({ kind: 'failed', error: g.submission_error, retryLabel: 'Retry approved requests' });
  g.cards[1]!.revisions[0]!.decision = 'denied';
  expect(status(g)).toMatchObject({ kind: 'failed', retryLabel: 'Retry start' });
});

it('unmarked approved handoffs are actionable without claiming a crash', () => {
  expect(status(group(card('first')))).toEqual({
    kind: 'failed', label: 'Couldn’t start',
    error: 'These approved requests did not start. Retry to continue.', retryLabel: 'Retry start',
  });
});

it('old approvals never inherit retry controls from their latest revision', () => {
  const c = card('first');
  const old = c.revisions[0]!;
  c.revisions.push({ ...old, number: 2 });
  const g = group(c);
  g.submission_error = 'Input could not be prepared.';
  expect(submissionStatus(g, c, old, 'idle')).toEqual({ kind: 'replaced', label: 'Replaced' });
  old.job_ids = ['existing-job'];
  expect(submissionStatus(g, c, old, 'idle')).toEqual({ kind: 'none', label: '' });
});

it('denied cards remain denied and revisions are not treated as failed starts', () => {
  const denied = card('denied', 'denied'), approved = card('first');
  const g = group(approved, denied);
  g.state = 'revising';
  expect(status(g)).toEqual({ kind: 'revising', label: 'Revising…' });
  g.state = 'stopped';
  expect(status(g, denied)).toEqual({ kind: 'denied', label: 'Denied' });
});

it('undecided current proposals remain available for review', () => {
  const g = group(card('first', 'undecided'));
  expect(status(g)).toEqual({ kind: 'review', label: '' });
});
