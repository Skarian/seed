/** What the make bar says about the open plan: which drafts Make runs, what they make, how long they take, and what
 * the Make button is named for (open checks, a stale plan, or a question Seed asked). Pure: no state, no network. */
import { kindOf, isVideoKind, type ChatCard, type ChatGroup, type JobRecord, type Project } from '../api.js';
import { cleanReply } from '../ui.js';
import { latest, outputNoun, plural, estimateSeconds } from '../format.js';
import type { Selection } from './PlanCard.js';
import type { Readiness } from './readiness.js';
import { ackKey, checkDraft } from './checks.js';

/** GPU time for some drafts, summed per workflow. Null when any of them has no comparable past job. */
export function planSeconds(jobs: JobRecord[], cards: ChatCard[]) {
  let total = 0;
  for (const c of cards) {
    const r = latest(c).request,
      s = estimateSeconds(jobs, r.workflow, r.count);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/** Everything the bar shows about the open plan, worked out from the plan, the ticks and the conversation. */
export function planStatus(
  project: Project,
  plan: ChatGroup,
  selection: Selection,
  acknowledged: Set<string>,
  ready: (card: ChatCard) => Readiness,
) {
  const selectedCards = plan.cards.filter(c => (selection[c.id] ?? !c.left_out) && !ready(c).blocked);
  // What Make makes, by kind: "4 images", "2 clips" or "4 images and 2 clips" for a mixed plan.
  const madeOf = (video: boolean) =>
    selectedCards
      .filter(c => isVideoKind(kindOf[latest(c).request.workflow]) === video)
      .reduce((n, c) => n + latest(c).request.count, 0);
  const images = madeOf(false),
    clips = madeOf(true);
  const makeNoun =
    clips && images
      ? `${plural(images, 'image')} and ${plural(clips, 'clip')}`
      : outputNoun(
          selectedCards[0] ? latest(selectedCards[0]).request : plan.cards[0] && latest(plan.cards[0]).request,
          images + clips,
        );
  const openChecks = selectedCards.flatMap(c =>
    checkDraft(c, project, plan.cards.length).filter(x => x.fixes.length && !x.soft && !acknowledged.has(ackKey(c, x))),
  );
  const unresolved = openChecks.length;
  // The final button names what the person is accepting, not just "anyway".
  const anyway = openChecks.every(c => c.code === 'added-sound')
    ? 'Make with sound'
    : openChecks.every(c => c.code === 'unused-input')
      ? clips
        ? `Make ${makeNoun} without the attached image`
        : 'Make without the attached image'
      : openChecks.every(c => c.code === 'shape')
        ? (() => {
            const shapes = [...new Set(selectedCards.map(c => latest(c).request.output.aspect))];
            return shapes.length === 1 ? 'Make ' + makeNoun + ' at ' + shapes[0] : 'Make ' + makeNoun + ' as drafted';
          })()
        : `Make despite ${unresolved === 1 ? '1 check' : unresolved + ' checks'}`;
  // Seed answered the latest message without changing the plan (often a clarifying question):
  // the plan still shows the earlier version, so running it is a secondary, clearly named choice.
  const lastTurn = [...project.messages].reverse().find(m => m.role === 'assistant' && m.transcript);
  const lastAsk = [...project.messages].reverse().find(m => m.role === 'user');
  const planStale = Boolean(
    lastTurn &&
    lastAsk &&
    Date.parse(lastAsk.created_at) <= Date.parse(lastTurn.created_at) &&
    lastTurn.transcript?.state === 'completed' &&
    plan.cards.every(c => !c.revisions.some(r => r.run_id === lastTurn.id)) &&
    /\?\s*$/.test(cleanReply(lastTurn.text)),
  );
  // Seed changed the plan and also asked something (often about an unsupported setting): quote it next to Make.
  const lastReply = lastTurn?.transcript?.state === 'completed' ? cleanReply(lastTurn.text) : '';
  // Only for a real decision (a substitution or limit), not a polite "anything else?".
  // Answering with a button (a fix, or keeping a setting) settles Seed's question too.
  const answered = plan.cards.some(
    c => (latest(c).number > 1 && !latest(c).run_id) || [...acknowledged].some(k => k.startsWith(c.id + ':')),
  );
  const question =
    !planStale &&
    !unresolved &&
    !answered &&
    /\?\s*$/.test(lastReply) &&
    /support|instead|can.?t|cannot|not available|only (offer|support|do)|unable|which (one|option|format)|would you (prefer|like)/i.test(
      lastReply,
    ) &&
    plan.cards.some(c => c.revisions.some(r => r.run_id === lastTurn!.id))
      ? (
          lastReply
            .split(/(?<=[.!])\s+/)
            .filter(s => s.includes('?'))
            .at(-1) ?? ''
        )
          .replace(/[*_`#]/g, '')
          .trim()
          .slice(0, 220)
      : '';
  const need = selectedCards.map(ready).find(r => r.needs || r.billing);
  return { selectedCards, images, clips, makeNoun, unresolved, anyway, planStale, question, need };
}

/** Seed revised, closed or reshaped the plan since these decisions were taken (for example while a GPU question was
 * open): making them now would run drafts the owner has not seen. */
export function planMoved(now: ChatGroup | undefined, decisions: Array<{ card: string; revision: number }>) {
  return (
    !now ||
    now.state !== 'reviewing' ||
    now.cards.length !== decisions.length ||
    decisions.some(d => {
      const card = now.cards.find(c => c.id === d.card);
      return !card || latest(card).number !== d.revision;
    })
  );
}
