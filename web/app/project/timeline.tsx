import { type ChatGroup, type ChatMessage, type Project } from '../api.js';
import { latest, titleOf } from '../format.js';
import { planOpen } from '../../../shared/plan.js';

export const isOpenPlan = (g: ChatGroup) => planOpen(g) && !g.direct;

export type TimelineItem =
  { type: 'message'; message: ChatMessage; groupsAfter: ChatGroup[] } | { type: 'group'; group: ChatGroup };
export function buildTimeline(project: Project): TimelineItem[] {
  const out: TimelineItem[] = [],
    placed = new Set<string>();
  const after = (id: string | null) => project.groups.filter(g => (g.after_message_id ?? null) === id);
  for (const g of after(null)) {
    out.push({ type: 'group', group: g });
    placed.add(g.id);
  }
  // A plan hangs off the user's message that asked for it; show it after Seed's reply to that message.
  let deferred: ChatGroup[] = [];
  const flush = () => {
    for (const g of deferred) {
      out.push({ type: 'group', group: g });
      placed.add(g.id);
    }
    deferred = [];
  };
  // A reply that failed and was retried with the same message collapses to one line, so the request is not shown twice.
  const retried = new Set<string>();
  project.messages.forEach((m, i) => {
    const reply = project.messages[i + 1],
      again = project.messages[i + 2];
    if (
      m.role === 'user' &&
      reply?.role === 'assistant' &&
      reply.transcript?.state === 'failed' &&
      again?.role === 'user' &&
      again.text === m.text &&
      !after(reply.id).length &&
      !after(m.id).length
    ) {
      retried.add(m.id);
      retried.add(reply.id);
    }
  });
  project.messages.forEach((m, i) => {
    if (retried.has(m.id)) {
      if (m.role === 'assistant')
        out.push({
          type: 'message',
          message: {
            ...m,
            role: 'event',
            text: 'Seed couldn’t finish a reply, so you tried again. Nothing was made.',
          } as ChatMessage,
          groupsAfter: [],
        });
      return;
    }
    if (m.role === 'assistant' && !m.text && !m.transcript) return;
    const groups = after(m.id),
      next = project.messages[i + 1];
    if (m.role === 'user' && next?.role === 'assistant') {
      flush();
      out.push({ type: 'message', message: m, groupsAfter: [] });
      deferred = groups;
      return;
    }
    const shown = [...deferred, ...groups];
    out.push({ type: 'message', message: m, groupsAfter: shown });
    deferred = shown;
    flush();
  });
  flush();
  for (const g of project.groups) if (!placed.has(g.id)) out.push({ type: 'group', group: g });
  // The conversation is a record: a made plan appears when it was made, and the open plan is
  // always the current object at the end, so revising it never rewrites the history above.
  const at = (item: TimelineItem, index: number): number => {
    if (item.type === 'message') return Date.parse(item.message.created_at) || index;
    // The open plan sits after the reply that last changed it, so a later answer to a question appears below it,
    // where the person is reading, instead of above it off screen. The Make bar stays pinned either way.
    if (isOpenPlan(item.group)) {
      const runs = new Set(item.group.cards.flatMap(c => c.revisions.map(r => r.run_id)).filter(Boolean));
      const changedBy = project.messages.filter(m => runs.has(m.id)).at(-1);
      return changedBy ? (Date.parse(changedBy.created_at) || index) + 0.5 : Infinity;
    }
    const made = project.jobs
      .filter(j => item.group.cards.some(c => c.revisions.some(r => r.job_ids.includes(j.id))))
      .map(j => Date.parse(j.created_at))
      .filter(Number.isFinite);
    if (made.length) return Math.min(...made);
    const prev = out
      .slice(0, index)
      .reverse()
      .find(x => x.type === 'message') as { message: ChatMessage } | undefined;
    return prev ? (Date.parse(prev.message.created_at) || index) + 0.5 : -Infinity;
  };
  const keyed = out.map((item, index) => ({ item, index, t: at(item, index) }));
  keyed.sort((a, b) => a.t - b.t || a.index - b.index);
  return keyed.map(k => k.item);
}
/** "Fox" → "Fox · v2", then v3: variants get numbers instead of piling up suffixes. */
export function nextVersion(project: Project, title: string) {
  const base = title.replace(/( · (v\d+|more))+$/g, '');
  const taken = project.groups
    .flatMap(g => g.cards)
    .map(c => titleOf(latest(c).request))
    .filter(t => t === base || t.startsWith(base + ' · v'));
  const n = Math.max(1, ...taken.map(t => Number(t.match(/ · v(\d+)$/)?.[1] ?? 1)));
  return `${base} · v${n + 1}`;
}
/** The user's last message that asked for something, skipping short follow-ups such as "go ahead". */
export function substantialRequest(project: Project | null) {
  const users = project ? [...project.messages].reverse().filter(x => x.role === 'user') : [];
  const m = users.find(x => x.text.trim().split(/\s+/).length >= 8 || x.assets.length) ?? users[0];
  return m ? { text: m.text, assets: m.assets } : null;
}
export function lastUserMessage(project: Project | null) {
  const m = project ? [...project.messages].reverse().find(x => x.role === 'user') : undefined;
  return m ? { text: m.text, assets: m.assets } : null;
}
export function titleFromPrompt(text: string) {
  // The first clause, without a leading article, cut at a word that ends a phrase ("Storybook title card for The Salt
  // Clock", never "A vintage storybook title card for").
  const first = (text.trim().split(/[.,;:\n]| with | while | as /i)[0] ?? '').replace(/^(a|an|the)\s+/i, '');
  const words = first.split(/\s+/).filter(Boolean).slice(0, 8);
  while (
    words.length > 2 &&
    /^(a|an|the|of|for|in|on|at|to|with|and|or|by|from|into|her|his|its|their)$/i.test(words.at(-1)!)
  )
    words.pop();
  const title = words.join(' ').replace(/^./, c => c.toUpperCase());
  return title.length > 60 ? title.slice(0, 58) + '…' : title;
}

/** A request written by one of Seed's own buttons, named as the action it was ("Check · Shot 2 · 1 of 3"). */
export function buttonAction(text: string): string | null {
  const m = (re: RegExp) => text.match(re);
  let x;
  if ((x = m(/^Give me a second opinion on (.+?)\.(?:\s|$)/))) return 'Check · ' + x[1];
  if ((x = m(/^Draft one plan with a (clip|keyframe) for (shots? .+?)(?:, each| from the brief)/i)))
    return `Draft ${x[1]!.toLowerCase()}s for ${x[2]}`;
  if ((x = m(/^Draft one plan with a reference for each of (.+?) from the brief/)))
    return 'Draft references for ' + x[1];
  if ((x = m(/^Draft a (?:character|place|prop) reference for (.+?) from the brief/)))
    return `Draft ${x[1]}’s reference`;
  if ((x = m(/^Draft a reference sheet for (.+?) as an edit/))) return `Draft ${x[1]}’s reference sheet`;
  if (/^I changed the brief\. Update every open draft/.test(text)) return 'Update the drafts to match the brief';
  if (/^Continue where you stopped/.test(text)) return 'Continue';
  return null;
}
