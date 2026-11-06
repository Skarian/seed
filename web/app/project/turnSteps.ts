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
    // A part's type ("text") is not a message.
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => k !== 'type' && k !== 'mimeType' && walk(x));
  };
  walk(result);
  for (const t of texts) {
    try {
      const parsed = JSON.parse(t) as { error?: unknown; errors?: Array<{ message?: unknown }> };
      if (typeof parsed?.error === 'string') return parsed.error;
      // A save that failed field checks: its first reason, in words.
      const first = parsed?.errors?.find(e => typeof e?.message === 'string')?.message;
      if (typeof first === 'string') return first;
    } catch {
      /* plain text */
    }
  }
  const text = texts.find(t => t.trim())?.trim() ?? '';
  // A malformed tool call is Seed's own slip, never something to show as raw JSON.
  if (/^Validation failed for tool|^\s*[{[]/.test(text)) return 'Seed sent it in the wrong form.';
  return text;
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
    return String(i.name ?? i.request_id ?? i.shot ?? i.title ?? '').toLowerCase();
  };
  // A draft written on a later try (same title, or a try whose title could not be read) made the failure good.
  const madeGood = (s: (typeof tools)[number], t: (typeof tools)[number]) =>
    t.name === s.name &&
    t.state === 'succeeded' &&
    (target(t.input) === target(s.input) ||
      s.name === 'update_brief' ||
      (s.name === 'create_request' && !target(s.input)) ||
      s.name === 'choose_kind');
  const out: { label: string; reason: string }[] = [];
  tools.forEach((s, i) => {
    if (s.state !== 'failed') return;
    if (tools.slice(i + 1).some(t => madeGood(s, t))) return;
    const label = toolLabels[s.name ?? ''] ?? 'A step';
    const who = String(((s.input ?? {}) as Record<string, unknown>).name ?? '');
    const reason = errorText(s.result).replace(/\s+/g, ' ').slice(0, 220);
    const step = { label: who && s.name === 'approve_reference' ? `${label} for ${who}` : label, reason };
    if (out.some(o => o.label === step.label && o.reason === step.reason)) return;
    out.push(step);
  });
  return out.slice(0, 6);
}

/** The JSON a tool returned (its text part), when it is JSON. */
function resultJson(result: unknown): Record<string, unknown> | undefined {
  const texts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => k !== 'type' && walk(x));
  };
  walk(result);
  for (const t of texts)
    try {
      const j = JSON.parse(t);
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  return undefined;
}

/**
 * What a finished turn actually changed, read from the tools that succeeded (not from the reply's wording): drafts
 * written or changed, the brief, approvals and choices. Shown under the reply so a claim can be checked at a glance.
 */
export function turnReceipt(turn: TurnTranscript | undefined): string[] {
  if (!turn) return [];
  const out: string[] = [];
  const drafted: string[] = [],
    changed: string[] = [];
  for (const s of turn.steps) {
    if (s.kind !== 'tool' || s.state !== 'succeeded') continue;
    const input = (s.input ?? {}) as Record<string, unknown>;
    const json = resultJson(s.result);
    const title = String(
      ((json?.request as Record<string, unknown> | undefined)?.title as string | undefined) ?? input.title ?? '',
    ).trim();
    if (s.name === 'create_request') drafted.push(title || 'a draft');
    else if (s.name === 'edit_request') changed.push(title || 'a draft');
    else if (s.name === 'update_brief') {
      const added = (json?.cast_added as string[] | undefined) ?? [];
      out.push(added.length ? `Saved the brief (added ${added.join(', ')} to the cast)` : 'Saved the brief');
    } else if (s.name === 'approve_reference') out.push(`Approved ${String(input.name ?? 'a')}’s reference`);
    else if (s.name === 'choose_take') out.push('Chose a take' + (input.shot ? ' for shot ' + String(input.shot) : ''));
    else if (s.name === 'leave_out_request') out.push('Left a draft out of the plan');
  }
  const list = (xs: string[]) => {
    const u = [...new Set(xs)];
    return u.length > 3 ? `${u.slice(0, 3).join(', ')} and ${u.length - 3} more` : u.join(', ');
  };
  if (drafted.length) out.unshift(`Drafted ${list(drafted)}`);
  if (changed.length) out.splice(drafted.length ? 1 : 0, 0, `Changed ${list(changed.filter(c => !drafted.includes(c)))}`);
  return [...new Set(out)].filter(x => !/^Changed $/.test(x));
}
