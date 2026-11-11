import type { TurnStep, TurnTranscript } from './chat.js';

/** What a turn's tools actually did, read from their results (never from the reply's wording). */
export interface TurnOutcome {
  /** Drafts written or changed, the brief, approvals and choices, in words. Filled in while the turn runs. */
  done: string[];
  /** Steps that did not work and were not made good later in the turn. Empty until the turn ends. */
  unfinished: Array<{ label: string; reason: string }>;
}

/** What each of Seed's tools does, in words for a step that did not work. */
const labels: Record<string, string> = {
  approve_reference: 'Approve a reference',
  update_brief: 'Save the brief',
  create_request: 'Write a draft',
  edit_request: 'Change a draft',
  leave_out_request: 'Leave a draft out',
  choose_take: 'Choose a take',
  read_input: 'Look at an input',
  choose_kind: 'Choose what to make',
};
/** The tools that save work the owner sees. */
const saves = new Set(['create_request', 'edit_request', 'update_brief', 'approve_reference', 'choose_take']);
const internalReason = 'Seed couldn’t finish this step. Nothing was lost; ask again to retry it.';

/**
 * A tool step's result: what it returned on success, or its failure. `internal` is Seed's own slip (a stale id, a
 * malformed call), which the owner need not see when the turn otherwise got its work done.
 */
function read(step: TurnStep): { details: Record<string, unknown>; error: string; internal: boolean } {
  const result = step.result as { details?: unknown; content?: Array<{ type?: string; text?: string }> } | undefined;
  const text = result?.content?.find(p => p.type === 'text')?.text?.trim() ?? '';
  const details = (result?.details ?? {}) as Record<string, unknown>;
  if (step.state !== 'failed') return { details, error: '', internal: false };
  try {
    const failed = JSON.parse(text) as { error?: string; errors?: Array<{ message?: string }>; internal?: boolean };
    const error = failed.error ?? failed.errors?.find(e => e.message)?.message ?? '';
    // Turns saved before the tools marked their own slips name them in words.
    return { details, error, internal: failed.internal ?? /request_id|no longer active|Unknown kind/.test(error) };
  } catch {
    // Plain text: a call the agent library refused (malformed input, an unknown tool), or a tool's own message.
    return { details, error: text, internal: /^Validation failed for tool|^Tool \S+ not found|^\s*[{[]/.test(text) };
  }
}

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
  const progressed = tools.some(t => t.state === 'succeeded' && saves.has(t.name ?? ''));
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
      const { error, internal } = read(s);
      // Made good by the same draft saved anywhere in the turn. A slip that named no draft that exists (a stale id) is
      // made good by any later success of the same tool; a slip on a real draft only by that draft's own save.
      const id = String(input(s).request_id ?? ''),
        stale = !target(s) || (id !== '' && !draftTitle(id));
      const retried = tools.some(
        (t, j) => worked(t) && ((Boolean(target(s)) && target(t) === target(s)) || (j > i && stale)),
      );
      if (internal && progressed && (!saves.has(name) || retried)) return;
      const label = labels[name] ?? 'A step',
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
      { details } = read(s);
    const request = details.request as { title?: string; duration_seconds?: number } | undefined;
    // A clip says so, so a plan of pictures can never quietly become clips.
    const title =
      String(request?.title ?? input.title ?? '').trim() + (request?.duration_seconds !== undefined ? ' (clip)' : '');
    if (s.name === 'create_request') drafted.push(title || 'a draft');
    else if (s.name === 'edit_request') changed.push(title || 'a draft');
    else if (s.name === 'update_brief') {
      const added = (details.cast_added as string[] | undefined) ?? [];
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
