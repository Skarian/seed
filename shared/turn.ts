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
type Drafted = { request: { title?: string; duration_seconds?: number } };
/** What a tool that worked tells the agent, as far as the receipt reads it; `defineTool` holds each tool to its entry. */
export interface ToolResults extends Record<ToolName, object> {
  create_request: Drafted;
  edit_request: Drafted;
  update_brief: { cast_added?: string[] };
}
/** A succeeded step's result, narrowed by its tool's name. Stored turns may lack fields, so every one is optional. */
type Succeeded = { [N in ToolName]: { name: N; result?: Partial<ToolResults[N]> } }[ToolName];
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
const succeeded = (step: TurnStep) =>
  ({ name: step.name, result: (step.result as { details?: unknown } | undefined)?.details }) as Succeeded;

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
      // Made good by a later success of the same tool for the same thing, or for anything when the step named nothing
      // (the brief, the kind, an untitled draft) or a draft that does not exist (a stale id). An earlier success of
      // the same tool never hides a later failure.
      const draft = String(input(s).request_id ?? ''),
        anything = !target(s) || (draft !== '' && !draftTitle(draft));
      const madeGood = tools
        .slice(i + 1)
        .some(t => t.name === name && t.state === 'succeeded' && (anything || target(t) === target(s)));
      const { error, internal } = s.failure ?? legacyFailure(s);
      // Seed's own slip on a step that saves nothing stays quiet once the turn saved something.
      if (madeGood || (internal && progressed && !toolLabel(name)?.saves)) return;
      const label = toolLabel(name)?.failed ?? 'A step',
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
      step = succeeded(s);
    if (step.name === 'create_request' || step.name === 'edit_request') {
      const request = step.result?.request;
      // A clip says so, so a plan of pictures can never quietly become clips.
      const title =
        String(request?.title ?? input.title ?? '').trim() + (request?.duration_seconds !== undefined ? ' (clip)' : '');
      (step.name === 'create_request' ? drafted : changed).push(title || 'a draft');
    } else if (step.name === 'update_brief') {
      const added = step.result?.cast_added ?? [];
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
