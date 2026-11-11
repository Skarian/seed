import { it, expect } from 'vitest';
import { planMoved } from '../web/app/project/planStatus.js';

const card = (id: string, numbers: number[]) =>
  ({ id, workflow: 'text-to-image', revisions: numbers.map(number => ({ number })) }) as any;
const group = (state: string, cards: any[]) => ({ id: 'g', workflow: 'text-to-image', state, cards }) as any;
const decided = [
  { card: 'a', revision: 2 },
  { card: 'b', revision: 1 },
];

it('makes the plan only when it is still the one the owner decided on', () => {
  expect(planMoved(group('reviewing', [card('a', [1, 2]), card('b', [1])]), decided)).toBe(false);
  // Seed revised a draft while the GPU question was open.
  expect(planMoved(group('reviewing', [card('a', [1, 2, 3]), card('b', [1])]), decided)).toBe(true);
  // Seed added a draft, or is revising the plan right now, or it was set aside.
  expect(planMoved(group('reviewing', [card('a', [1, 2]), card('b', [1]), card('c', [1])]), decided)).toBe(true);
  expect(planMoved(group('revising', [card('a', [1, 2]), card('b', [1])]), decided)).toBe(true);
  expect(planMoved(undefined, decided)).toBe(true);
});
