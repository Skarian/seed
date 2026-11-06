import type { TurnTranscript } from '../../../shared/chat.js';

/** What each of Seed's tools does, in words for a step that did not work. */
const toolLabels: Record<string, string> = {
  approve_reference: 'Approve a reference',
  update_brief: 'Save the brief',
  create_request: 'Write a draft',
  edit_request: 'Change a draft',
  leave_out_request: 'Leave a draft out',
  choose_take: 'Choose a take',
  read_input: 'Look at an input',
  choose_kind: 'Choose what to make',
};

/** The error text a failed tool returned, wherever it sits in the result. */
function errorText(result: unknown): string {
  const texts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(result);
  for (const t of texts) {
    try {
      const parsed = JSON.parse(t) as { error?: unknown };
      if (typeof parsed?.error === 'string') return parsed.error;
    } catch {
      /* plain text */
    }
  }
  return texts.find(t => t.trim())?.trim() ?? '';
}

/**
 * The steps of a finished turn that failed and were not made good by a later step of the same kind with the same
 * target, so a reply cannot claim work its tools did not do.
 */
export function unfinishedSteps(turn: TurnTranscript | undefined): { label: string; reason: string }[] {
  if (!turn || turn.state === 'running') return [];
  const tools = turn.steps.filter(s => s.kind === 'tool');
  const target = (input: unknown) => {
    const i = (input ?? {}) as Record<string, unknown>;
    return String(i.name ?? i.request_id ?? i.shot ?? '');
  };
  const out: { label: string; reason: string }[] = [];
  tools.forEach((s, i) => {
    if (s.state !== 'failed') return;
    const later = tools.slice(i + 1).some(t => t.name === s.name && t.state === 'succeeded' && (target(t.input) === target(s.input) || s.name === 'update_brief'));
    if (later) return;
    const label = toolLabels[s.name ?? ''] ?? 'A step';
    const who = target(s.input);
    const reason = errorText(s.result).replace(/\s+/g, ' ').slice(0, 220);
    const step = { label: who && s.name === 'approve_reference' ? `${label} for ${who}` : label, reason };
    if (out.some(o => o.label === step.label && o.reason === step.reason)) return;
    out.push(step);
  });
  return out.slice(0, 6);
}
