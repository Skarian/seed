import { useState } from 'react';
import { projects, type ChatMessage, type Project } from '../api.js';
import type { TurnEnd, TurnTranscript } from '../../../shared/chat.js';
import { useApp, useNow } from '../data.js';
import { Markdown, Thumb, cleanReply } from '../ui.js';
import { duration, assetName, titleOf, latest } from '../format.js';

import { toolLabel, turnOutcome } from '../../../shared/turn.js';
import { buttonAction } from './timeline.js';
import { seedAsks } from './planStatus.js';

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
    { tasks, go, mode, refreshProjects } = useApp();
  const stop = turn?.state === 'failed' ? turnStop(turn) : undefined;
  async function newProject() {
    const p = await projects.create(mode);
    refreshProjects();
    go({ name: 'project', id: p.id, view: 'conversation' });
  }
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
  const asking = seedAsks(text);
  const toolFailed = turn?.steps.some(s => s.kind === 'tool' && s.state === 'failed') && !madePlan && !asking;
  // What the tools did, filled in as Seed works, and the steps that did not work once it is done.
  const { done: receipt, unfinished } = turnOutcome(turn, id => {
    const card = project.groups.flatMap(g => g.cards).find(c => c.id === id);
    return card ? titleOf(latest(card).request) : undefined;
  });
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
          <strong>
            {receipt.length
              ? unfinished.length === 1
                ? 'One step didn’t work'
                : `${unfinished.length} steps didn’t work`
              : 'Not done in this reply'}
          </strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: '1.2em' }}>
            {unfinished.map((u, i) => (
              <li key={i}>
                {u.label}
                {u.reason && <span className="faint">: {u.reason}</span>}
              </li>
            ))}
          </ul>
          {turn?.state === 'failed' && !stop && text && (
            <div className="actions">
              <button className="btn small" onClick={onRetry}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
      {!running && turn?.state === 'failed' && !(unfinished.length && text && !stop) && (
        <div className="notice error">
          {stop?.says ?? 'Seed couldn’t finish that. Drafts without a new version are unchanged, and nothing was made.'}
          <div className="actions">
            {stop?.action === 'continue' ? (
              <button className="btn small primary" onClick={onContinue}>
                Continue
              </button>
            ) : stop?.action === 'new' ? (
              <button className="btn small primary" onClick={() => void newProject()}>
                Start a new project
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
      {/* A reply that leaves part of the work for "my next reply" gets a Continue, so the rest is one tap away. */}
      {!running &&
        turn?.state === 'completed' &&
        /(?:in|with) (?:my|the) next (?:reply|message|turn)|remaining (?:shots|drafts|ones)[^.]{0,40}next/i.test(
          text,
        ) && (
          <div className="actions">
            <button className="btn small primary" onClick={onContinue}>
              Continue: draft the rest
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
/** Why a turn stopped early, in words that say what happened to the owner's work, and the one action that helps. */
const ends: Record<TurnEnd, { says: string; action: 'continue' | 'retry' | 'new' }> = {
  length: { says: 'Seed’s reply reached its length limit. Anything it saved is above.', action: 'continue' },
  turn_limit: { says: 'Seed ran out of steps before finishing. Anything it saved is above.', action: 'continue' },
  restart: { says: 'Seed restarted while replying. Anything it saved is above.', action: 'continue' },
  timeout: { says: 'Seed couldn’t finish this reply in time. Nothing was made.', action: 'retry' },
  summary: {
    says: 'Seed couldn’t summarise the earlier conversation, so it didn’t reply. Nothing was made.',
    action: 'retry',
  },
  provider: { says: 'The model service stopped Seed’s reply. Nothing was made.', action: 'retry' },
  too_large: {
    says: 'This project’s conversation, drafts and inputs are too much for Seed to read at once. Nothing was made.',
    action: 'new',
  },
};
/** A failed turn that stopped early, or nothing when a step of its own failed. */
export function turnStop(turn: TurnTranscript) {
  // Turns saved before `end` was stored say why only in words, written for the owner.
  const end = turn.end ?? (/turn limit/i.test(turn.error ?? '') ? 'turn_limit' : undefined);
  if (!end) return turn.error ? { says: turn.error, action: 'retry' as const } : undefined;
  const detail = end === 'provider' && turn.error ? ` It said: “${turn.error.replace(/\.+$/, '')}”.` : '';
  return { says: ends[end].says + detail, action: ends[end].action };
}
/** What Seed is doing now, and how many of its steps are done, so a long turn has something to watch. */
export function stageOf(turn: NonNullable<ChatMessage['transcript']>) {
  const tools = turn.steps.filter(s => s.kind === 'tool');
  const done = tools.filter(s => s.state === 'succeeded').length,
    failed = tools.filter(s => s.state === 'failed').length;
  const tally =
    done || failed ? ` · ${done} ${done === 1 ? 'step' : 'steps'} done${failed ? `, ${failed} didn’t work` : ''}` : '';
  return stageNow(turn) + tally;
}
function stageNow(turn: NonNullable<ChatMessage['transcript']>) {
  const last = [...turn.steps].reverse().find(s => s.kind === 'tool');
  if (last?.state === 'running') return toolLabel(last.name)?.doing ?? 'Working';
  const drafts = turn.steps.filter(
    s => s.kind === 'tool' && s.name === 'create_request' && s.state === 'succeeded',
  ).length;
  if (drafts) return `Wrote ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`;
  if (turn.steps.at(-1)?.kind === 'text') return 'Replying';
  return turn.steps.length ? 'Thinking' : 'Reading your request';
}
