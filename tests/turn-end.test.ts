import { it, expect } from 'vitest';
import { turnStop } from '../web/app/project/Message.js';

const turn = (over: object) => ({ started_at: '', state: 'failed' as const, steps: [], ...over });

it('words a stopped turn from its end, with the one action that helps', () => {
  expect(turnStop(turn({ end: 'turn_limit' }))).toEqual({ says: 'Seed ran out of steps before finishing. Anything it saved is above.', action: 'continue' });
  expect(turnStop(turn({ end: 'too_large' }))!.action).toBe('new');
  expect(turnStop(turn({ end: 'provider', error: 'Connection error.' }))!.says).toBe('The model service stopped Seed’s reply. Nothing was made. It said: “Connection error”.');
  // A step of the turn failed: no stop to explain.
  expect(turnStop(turn({}))).toBeUndefined();
});

it('still reads turns saved before their end was stored', () => {
  expect(turnStop(turn({ error: 'Agent turn limit reached.' }))!.action).toBe('continue');
  expect(turnStop(turn({ error: 'Seed’s reply timed out after 10 minutes.' }))).toEqual({ says: 'Seed’s reply timed out after 10 minutes.', action: 'retry' });
});
