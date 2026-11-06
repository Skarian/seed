import { useState } from 'react';
import { type ChatMessage, type Project } from '../api.js';
import { useApp, useNow } from '../data.js';
import { Markdown, Thumb, cleanReply } from '../ui.js';
import { duration, assetName } from '../format.js';
import { type Attachment } from './requests.js';
import { unfinishedSteps, turnReceipt } from './turnSteps.js';
import { buttonAction } from './timeline.js';

export function Message({
  message,
  project,
  planAfter,
  onRetry,
  onEdit,
  onContinue,
  onMakeItMyself,
}: {
  message: ChatMessage;
  project: Project;
  planAfter: boolean;
  onRetry: () => void;
  /** Puts the user's last message back in the composer to change and send again. */
  onEdit?: () => void;
  onContinue: () => void;
  onMakeItMyself: () => void;
}) {
  const turn = message.transcript,
    running = turn?.state === 'running';
  const [open, setOpen] = useState(false);
  const now = useNow(1000, running),
    { tasks } = useApp();
  if (message.role === 'event') return <div className="sys">{message.text}</div>;
  if (message.role === 'user') {
    const names = new Map((project.asset_manifest ?? []).map(a => [a.id, a]));
    const intent = message.text.match(
      /^(Edit this image|Make a new take of this clip|Animate this image|Use) \(?“[^”]*”\)?[^:]*: /,
    );
    const label = intent
      ? intent[1] === 'Edit this image'
        ? 'Refine'
        : intent[1] === 'Make a new take of this clip'
          ? 'New take'
          : intent[1] === 'Animate this image'
            ? 'Animate'
            : 'Use as input'
      : '';
    const action = buttonAction(message.text);
    return (
      <div className="msg-you" role="article" aria-label={action ? 'You asked: ' + action : 'You said'}>
        {label && (
          <>
            <span className="kind" style={{ marginRight: 6 }}>
              {label}
            </span>{' '}
          </>
        )}
        {action ? (
          <>
            <span className="kind">{action}</span>
            <details className="action-request">
              <summary className="link">The request Seed was sent</summary>
              <p>{message.text}</p>
            </details>
          </>
        ) : (
          cleanReply(intent ? message.text.slice(intent[0].length) : message.text)
        )}
        {message.assets.length > 0 && (
          <div className="attachments">
            {message.assets.map(a => {
              const m = names.get(a);
              return (
                <span className="input-chip" key={a}>
                  <Thumb id={a} kind={m?.kind ?? 'image'} alt={m?.name ?? 'Attachment'} />
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  // Input tokens belong in generation prompts; in a reply, name the input the user attached.
  const asked = [
    ...project.messages.slice(
      0,
      project.messages.findIndex(m => m.id === message.id),
    ),
  ]
    .reverse()
    .find(m => m.role === 'user');
  const text = cleanReply(message.text).replace(
    /\[\[input(\d+)\]\]|<(?:Picture|Video|Audio) (\d+)>/g,
    (_m, a: string, b: string) => {
      const asset = asked?.assets[Number(a ?? b) - 1];
      return asset ? '“' + assetName(project, asset, tasks) + '”' : 'the attached input';
    },
  );
  const madePlan = project.groups.some(g => g.cards.some(c => c.revisions.some(r => r.run_id === message.id)));
  // A reply that asks something ("Please attach…", ends with a question) is Seed asking, not Seed failing.
  const asking =
    /\?\s*$/.test(text.trim()) ||
    /\b(please (attach|send|share|tell)|could you|which (one|of)|do you want|would you like)\b/i.test(text);
  const toolFailed = turn?.steps.some(s => s.kind === 'tool' && s.state === 'failed') && !madePlan && !asking;
  const unfinished = unfinishedSteps(turn);
  // Filled in as Seed works, so a long turn shows what has landed so far.
  const receipt = turnReceipt(turn);
  const leaked = /<\|?tool_call|call:[a-z_.]+\{/i.test(message.text);
  const askedToMake = !madePlan && !asking && (leaked || toolFailed || (!text && turn?.state === 'completed'));
  const stage = running ? stageOf(turn!) : '';
  const reasoning =
    message.reasoning_text ||
    turn?.steps
      .filter(s => s.kind === 'reasoning')
      .map(s => s.text)
      .join('\n');
  // A reply that states a limit ("only supports…", "can't…") stays fully visible next to the plan it affects.
  const long =
    planAfter &&
    text.length > 1200 &&
    !/(only supports?|not supported|isn.t supported|can.t|cannot|not possible|won.t|doesn.t|does not|unable|limitation|words only|keeps? the source|crop|guarantee)/i.test(
      text,
    );
  return (
    <div
      className={'msg-seed' + (long && !open ? ' clamped' : '')}
      role="article"
      aria-label="Seed said"
      aria-busy={running}
    >
      <div className="who">
        Seed
        {running && (
          <span className="statusline">
            <span className="dot live" />
            {stage} · {duration((now - Date.parse(turn!.started_at)) / 1000)}
          </span>
        )}
      </div>
      {running && !text && now - Date.parse(turn!.started_at) > 20000 && (
        <p className="faint" style={{ margin: '0 0 4px', fontSize: '0.875rem' }}>
          {now - Date.parse(turn!.started_at) > 120_000
            ? 'Seed is still working through a long request. Large plans can take several minutes; you can keep working elsewhere in Seed, and the reply and drafts appear here.'
            : 'Long requests can take a minute or more. You can work elsewhere in Seed; the reply and any drafts appear here.'}
        </p>
      )}

      {!running && toolFailed && text && (
        <p className="faint" style={{ margin: '0 0 4px', fontSize: '0.875rem' }}>
          Seed's reply below wasn't carried out: no drafts were saved.
        </p>
      )}
      {/* A reply that says the brief was saved, when this turn did not save it, is corrected right here. */}
      {!running &&
        turn &&
        // Only Seed's own claim ("I have updated the brief"), not a mention of "the updated brief" in a check.
        /\b(?:I(?:'ve| have)?|I’ve)\s+(?:also\s+)?(?:updated|saved|recorded|added|written|wrote|captured|organi[sz]ed|stored)\b[^.]{0,60}\bbrief\b/i.test(
          text,
        ) &&
        !turn.steps.some(s => s.kind === 'tool' && s.name === 'update_brief' && s.state === 'succeeded') && (
          <p className="faint" role="note" style={{ margin: '0 0 4px', fontSize: '0.875rem' }}>
            The brief was not changed in this reply. Ask Seed to save it, or open Brief to write it.
          </p>
        )}
      {text && <Markdown text={text} streaming={running} />}
      {long && (
        <button className="link" style={{ fontSize: '0.875rem' }} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
      {/* What the tools actually did this turn, so the reply's wording can be checked at a glance. */}
      {receipt.length > 0 && (
        <p className="receipt" aria-label={running ? 'Done so far' : 'What Seed changed'}>
          <span aria-hidden="true">✓</span> {running ? 'So far: ' : ''}
          {receipt.join(' · ')}
        </p>
      )}
      {!running && unfinished.length > 0 && (
        <div className="notice warn" role="note">
          <strong>Not done in this reply</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: '1.2em' }}>
            {unfinished.map((u, i) => (
              <li key={i}>
                {u.label}
                {u.reason && <span className="faint">: {u.reason}</span>}
              </li>
            ))}
          </ul>
          {turn?.state === 'failed' && !turn.error && text && (
            <div className="actions">
              <button className="btn small" onClick={onRetry}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
      {!running && turn?.state === 'failed' && !(unfinished.length && text && !turn.error) && (
        <div className="notice error">
          {friendlyError(turn.error)}
          <div className="actions">
            {/turn limit/i.test(turn.error ?? '') ? (
              <button className="btn small primary" onClick={onContinue}>
                Continue
              </button>
            ) : (
              <button className="btn small" onClick={onRetry}>
                Try again
              </button>
            )}
            <button className="btn small" onClick={onMakeItMyself}>
              Make it myself
            </button>
          </div>
        </div>
      )}
      {!running && turn?.state === 'stopped' && (
        <div className="stopped-row">
          <span className="faint">Stopped.</span>
          {onEdit && (
            <button className="btn small" onClick={onEdit}>
              Edit message
            </button>
          )}
          <button className="btn small" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!running && turn?.state === 'completed' && askedToMake && (
        <div className="notice">
          <b>Seed couldn't prepare that.</b> Your message and attachments are kept.
          <div className="actions">
            <button className="btn small primary" onClick={onRetry}>
              Try again
            </button>
            <button className="btn small" onClick={onMakeItMyself}>
              Make it myself
            </button>
          </div>
        </div>
      )}
      {reasoning && !running && (
        <details className="thinking">
          <summary>Show thinking</summary>
          <pre>{reasoning}</pre>
        </details>
      )}
    </div>
  );
}
/** Errors from the model service, in words that say what happened to the person's work. */
export function friendlyError(error?: string | null) {
  const e = (error ?? '').replace(/\.+$/, '');
  if (/turn limit/i.test(e))
    return 'Seed ran out of steps before finishing. Anything it saved is above. Continue lets it finish the rest.';
  if (/timeout|timed out|ETIMEDOUT|idle/i.test(e))
    return 'Seed couldn’t finish this reply in time. Nothing was made and nothing new was rented. Try again.';
  if (/rate.?limit|429|too many/i.test(e))
    return 'The model service is busy right now. Nothing was made. Try again in a minute.';
  if (/network|fetch failed|ECONN|socket|5\d\d|upstream|unavailable/i.test(e))
    return 'Seed lost its connection to the model service. Nothing was made. Try again.';
  if (/credit|payment|402|insufficient/i.test(e))
    return 'The model service needs more credit on your OpenRouter account. Nothing was made.';
  return e
    ? `Seed stopped: ${e}. Nothing was made.`
    : 'Seed couldn’t finish that. Drafts without a new version are unchanged, and nothing was made.';
}
/** What Seed is doing now, and how many of its steps are done, so a long turn has something to watch. */
export function stageOf(turn: NonNullable<ChatMessage['transcript']>) {
  const tools = turn.steps.filter(s => s.kind === 'tool');
  const done = tools.filter(s => s.state === 'succeeded').length,
    failed = tools.filter(s => s.state === 'failed').length;
  const tally = done || failed ? ` · ${done} ${done === 1 ? 'step' : 'steps'} done${failed ? `, ${failed} retried` : ''}` : '';
  return stageNow(turn) + tally;
}
function stageNow(turn: NonNullable<ChatMessage['transcript']>) {
  const last = [...turn.steps].reverse().find(s => s.kind === 'tool');
  if (last?.state === 'running')
    return (
      {
        choose_kind: 'Choosing what to make',
        read_input: 'Looking at your input',
        update_brief: 'Updating the brief',
        leave_out_request: 'Narrowing the plan',
        edit_request: 'Changing a draft',
        create_request: 'Writing a draft',
        cast_and_places: 'Reading the cast',
        approve_reference: 'Approving a reference',
        choose_take: 'Choosing a take',
        order_requests: 'Ordering the plan',
      }[last.name ?? ''] ?? 'Working'
    );
  const drafts = turn.steps.filter(
    s => s.kind === 'tool' && s.name === 'create_request' && s.state === 'succeeded',
  ).length;
  if (drafts) return `Wrote ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`;
  if (turn.steps.at(-1)?.kind === 'text') return 'Replying';
  return turn.steps.length ? 'Thinking' : 'Reading your request';
}
