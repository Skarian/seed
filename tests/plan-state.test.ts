import { it, expect } from 'vitest';
import { movePlan, planOpen, type PlanState } from '../shared/plan.js';

it('moves a plan only along its allowed edges', () => {
  const plan = { state: 'assembling' as PlanState };
  movePlan(plan, 'reviewing');
  movePlan(plan, 'revising');
  movePlan(plan, 'reviewing');
  movePlan(plan, 'released');
  expect(planOpen(plan)).toBe(false);
  expect(() => movePlan(plan, 'reviewing')).toThrow('A plan cannot go from released to reviewing.');
  const stopped = { state: 'stopped' as PlanState };
  movePlan(stopped, 'stopped');
  expect(() => movePlan(stopped, 'revising')).toThrow();
  expect(() => movePlan({ state: 'revising' }, 'released')).toThrow();
});
