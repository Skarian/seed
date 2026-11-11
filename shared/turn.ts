import type { StepFailure, TurnStep, TurnTranscript } from './chat.js';

/** What a turn's tools actually did, read from their results (never from the reply's wording). */
export interface TurnOutcome {
  /** Drafts written or changed, the brief, approvals and choices, in words. Filled in while the turn runs. */
  done: string[];
  /** Steps that did not work and were not made good later in the turn. Empty until the turn ends. */
  unfinished: Array<{ label: string; reason: string }>;
}

/**
 * Each of Seed's tools in words: what the owner watches while it runs, and the step for one that did not work.
 * `saves` marks the tools that save work the owner sees.
 */
export const toolLabels = {
  choose_kind: { doing: 'Choosing what to make', failed: 'Choose what to make' },
  read_input: { doing: 'Looking at your input', failed: 'Look at an input' },
  update_brief: { doing: 'Updating the brief', failed: 'Save the brief', saves: true },
  create_request: { doing: 'Writing a draft', failed: 'Write a draft', saves: true },
  edit_request: { doing: 'Changing a draft', failed: 'Change a draft', saves: true },
  leave_out_request: { doing: 'Narrowing the plan', failed: 'Leave a draft out' },
  order_requests: { doing: 'Ordering the plan', failed: 'Order the plan' },
  approve_reference: { doing: 'Approving a reference', failed: 'Approve a reference', saves: true },
  choose_take: { doing: 'Choosing a take', failed: 'Choose a take', saves: true },
} satisfies Record<string, { doing: string; failed: string; saves?: true }>;
export type ToolName = keyof typeof toolLabels;
/** The words for a tool by the name a step recorded, if it is one of Seed's tools. */
export const toolLabel = (name: string | undefined): { doing: string; failed: string; saves?: true } | undefined =>
  name && Object.hasOwn(toolLabels, name) ? toolLabels[name as ToolName] : undefined;
const internalReason = 'Seed couldn’t finish this step. Nothing was lost; ask again to retry it.';

/**
 * A failed tool's text result as one failure. Seed's tools send JSON ({error, internal?, fields?}); plain text is a
 * call the agent library refused (malformed input, an unknown tool), which is Seed's own slip, or a tool's own words.
 */
export function toolFailure(text: string): StepFailure {
  try {
    const sent = JSON.parse(text) as Partial<StepFailure> | null;
    if (typeof sent?.error === 'string')
      return { error: sent.error, internal: sent.internal === true, ...(sent.fields ? { fields: sent.fields } : {}) };
  } catch {
    /* Plain text. */
  }
  return { error: text, internal: /^Validation failed for tool|^Tool \S+ not found|^\s*[{[]/.test(text) };
}
const resultText = (step: TurnStep) =>
  (step.result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content
    ?.find(p => p.type === 'text')
    ?.text?.trim() ?? '';
/**
 * A failed step of a turn saved before failures were stored on the step: field problems came as `errors`, and Seed's
 * own slips were named only in words.
 */
function legacyFailure(step: TurnStep): StepFailure {
  const text = resultText(step);
  try {
    const old = JSON.parse(text) as { error?: string; errors?: Array<{ message?: string }>; internal?: boolean };
    const error = old.error ?? old.errors?.find(e => e.message)?.message ?? '';
    return { error, internal: old.internal ?? /request_id|no longer active|Unknown kind/.test(error) };
  } catch {
    return toolFailure(text);
  }
}
const details = (step: TurnStep) =>
  ((step.result as { details?: unknown } | undefined)?.details ?? {}) as Record<string, unknown>;

export function turnOutcome(
  turn: TurnTranscript | undefined,
  /** The title of a draft by its id, so a failed change names the draft it was for. */
  draftTitle: (id: string) => string | undefined = () => undefined,
): TurnOutcome {
  const tools = (turn?.steps ?? []).filter(s => s.kind === 'tool');
  const input = (s: TurnStep) => (s.input ?? {}) as Record<string, unknown>;
  const target = (s: TurnStep) =>
    String(input(s).name ?? input(s).request_id ?? input(s).shot ?? input(s).title ?? '').toLowerCase();
  // Did the turn save anything? Then Seed's own slips along the way stay quiet.
  const progressed = tools.some(t => t.state === 'succeeded' && toolLabel(t.name)?.saves);
  const unfinished: TurnOutcome['unfinished'] = [];
  if (turn && turn.state !== 'running')
    tools.forEach((s, i) => {
      const name = s.name ?? '';
      if (s.state !== 'failed') return;
      const worked = (t: TurnStep) => t.name === name && t.state === 'succeeded';
      // Made good by a later try for the same thing (any later try, for the brief, the kind, or an untitled draft).
      const madeGood = tools
        .slice(i + 1)
        .some(
          t =>
            worked(t) &&
            (target(t) === target(s) ||
              name === 'update_brief' ||
              name === 'choose_kind' ||
              (name === 'create_request' && !target(s))),
        );
      if (madeGood) return;
      const { error, internal } = s.failure ?? legacyFailure(s);
      // Made good only by a later save: of the same draft, or, for a slip that named no draft that exists (a stale id),
      // by any later success of the same tool. An earlier save of the draft never hides a later failure.
      const id = String(input(s).request_id ?? ''),
        stale = !target(s) || (id !== '' && !draftTitle(id));
      const retried = tools.some(
        (t, j) => j > i && worked(t) && (stale || target(t) === target(s)),
      );
      if (internal && progressed && (!toolLabel(name)?.saves || retried)) return;
      const label = toolLabel(name)?.failed ?? 'A step',
        draft = String(input(s).request_id ?? ''),
        named = draft ? draftTitle(draft) : String(input(s).title ?? '') || undefined;
      const step = {
        label:
          name === 'approve_reference' && input(s).name
            ? `${label} for ${input(s).name}`
            : named
              ? `${label}: ${named}`
              : label,
        reason: (internal ? internalReason : error.replace(/\s+/g, ' ')).slice(0, 220),
      };
      if (!unfinished.some(u => u.label === step.label && u.reason === step.reason)) unfinished.push(step);
    });
  return { done: done(tools), unfinished: unfinished.slice(0, 6) };
}

function done(tools: TurnStep[]) {
  const out: string[] = [],
    drafted: string[] = [],
    changed: string[] = [];
  for (const s of tools) {
    if (s.state !== 'succeeded') continue;
    const input = (s.input ?? {}) as Record<string, unknown>,
      result = details(s);
    const request = result.request as { title?: string; duration_seconds?: number } | undefined;
    // A clip says so, so a plan of pictures can never quietly become clips.
    const title =
      String(request?.title ?? input.title ?? '').trim() + (request?.duration_seconds !== undefined ? ' (clip)' : '');
    if (s.name === 'create_request') drafted.push(title || 'a draft');
    else if (s.name === 'edit_request') changed.push(title || 'a draft');
    else if (s.name === 'update_brief') {
      const added = (result.cast_added as string[] | undefined) ?? [];
      out.push(added.length ? `Saved the brief (added ${added.join(', ')} to the cast)` : 'Saved the brief');
    } else if (s.name === 'approve_reference') out.push(`Approved ${String(input.name ?? 'a')}’s reference`);
    else if (s.name === 'choose_take') out.push('Chose a take' + (input.shot ? ' for shot ' + String(input.shot) : ''));
    else if (s.name === 'leave_out_request') out.push('Left a draft out of the plan');
  }
  const list = (xs: string[]) => {
    const u = [...new Set(xs)];
    return u.length > 3 ? `${u.slice(0, 3).join(', ')} and ${u.length - 3} more` : u.join(', ');
  };
  const edits = changed.filter(c => !drafted.includes(c));
  return [
    ...(drafted.length ? [`Drafted ${list(drafted)}`] : []),
    ...(edits.length ? [`Changed ${list(edits)}`] : []),
    ...new Set(out),
  ];
}
