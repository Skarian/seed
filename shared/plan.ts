import type { ChatGroup } from './chat.js';

export type PlanState = ChatGroup['state'];

/**
 * How a plan moves. Seed fills it (assembling), the owner reviews it, a reply revises it and gives it back, and Make
 * releases it, so a released plan was made. Stop, setting every draft aside, or a direct make that could not start
 * stops it. Released and stopped plans never reopen; Bring back starts a new plan.
 */
const moves: Record<PlanState, PlanState[]> = {
  assembling: ['reviewing', 'revising', 'stopped'],
  reviewing: ['revising', 'released', 'stopped'],
  revising: ['reviewing', 'stopped'],
  released: [],
  stopped: [],
};

/** A plan still being drafted or reviewed. */
export const planOpen = (plan: Pick<ChatGroup, 'state'>) => moves[plan.state].length > 0;

export function movePlan(plan: Pick<ChatGroup, 'state'>, to: PlanState) {
  if (plan.state !== to && !moves[plan.state].includes(to))
    throw Error(`A plan cannot go from ${plan.state} to ${to}.`);
  plan.state = to;
}
