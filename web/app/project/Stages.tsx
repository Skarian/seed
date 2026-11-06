import React from 'react';

/** One step of making the film: how far it is, and the plan Seed is asked to draft for what is left. */
export type Stage = {
  key: 'cast' | 'keyframes' | 'clips';
  label: string;
  done: number;
  total: number;
  /** What is left, in words ("Shots 2 and 4 have no keyframe"). */
  /** How the count reads, when "N of M approved" would be wrong ("2 approved · 1 not needed"). */
  count?: string;
  left?: string;
  /** The button that asks Seed for the plan, when one can be drafted. */
  action?: { label: string; ask: string };
};

/** "2, 4 and 5" */
export const listOf = (xs: (string | number)[]) =>
  xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1);

/**
 * The steps from brief to cut, with the next one marked. Each step's button drafts one plan for everything that step
 * still needs (every missing reference, every shot without a keyframe), which the owner reviews and runs as a batch.
 */
export function Stages({
  stages,
  onAsk,
  onPlay,
  finished,
}: {
  stages: Stage[];
  onAsk?: (text: string) => void;
  /** Plays the chosen clips in story order. */
  onPlay?: () => void;
  /** What a finished set of stills says and offers (a film offers Play the cut instead). */
  finished?: { text: string; label: string; onClick: () => void };
}) {
  const title = finished ? 'Steps to the finished set' : 'Steps to the finished film';
  const shown = stages.filter(s => s.total > 0);
  if (shown.length < (finished ? 1 : 2)) return null;
  const next = shown.find(s => s.done < s.total);
  return (
    <section className="stages" aria-label={title}>
      <h2 className="sr-only">{title}</h2>
      <ol className="stage-list">
        {shown.map((s, i) => {
          const state = s.done >= s.total ? 'done' : s === next ? 'next' : 'later';
          return (
            <li key={s.key} className={'stage ' + state} aria-current={s === next ? 'step' : undefined}>
              <span className="stage-n" aria-hidden="true">
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span className="stage-text">
                <b>{s.label}</b>
                <small className="faint">
                  {s.count ?? `${s.done} of ${s.total} ${s.key === 'cast' ? 'approved' : 'chosen'}`}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
      {next && (
        <div className="stage-next">
          <span>
            <b>Next: {next.label.toLowerCase()}.</b> {next.left}
          </span>
          {next.action && onAsk && (
            <button className="btn primary small" onClick={() => onAsk(next.action!.ask)}>
              {next.action.label}
            </button>
          )}
        </div>
      )}
      {!next && finished && (
        <div className="stage-next">
          <span>
            <b>{finished.text}</b> You can keep refining any shot.
          </span>
          <button className="btn primary small" onClick={finished.onClick}>
            {finished.label}
          </button>
        </div>
      )}
      {!next && !finished && onPlay && (
        <div className="stage-next">
          <span>
            <b>Every shot has a chosen clip.</b> Play them in story order, or keep refining any shot.
          </span>
          <button className="btn primary small" onClick={onPlay}>
            Play the cut
          </button>
        </div>
      )}
    </section>
  );
}
