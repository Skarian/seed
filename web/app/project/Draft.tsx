/** One draft in the plan: its prompt, inputs, own settings, version history, checks and readiness. */
import { useState } from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import { kindOf, kindLabels, type ChatCard, type Project } from '../api.js';
import { Icon } from '../icons.js';
import { MenuButton, Thumb } from '../ui.js';
import { chooseFrame, useApp } from '../data.js';
import { latest, titleOf, outputNoun, assetName } from '../format.js';
import type { Readiness, StyleEntry } from './readiness.js';
import { roleLabels } from './requests.js';
import { readablePrompt, type Check } from './checks.js';
import { LibraryPicker } from '../library/LibraryPicker.js';
import { swapInput } from './swap.js';
import { approvedReferences } from '../../../shared/choices.js';
import { departureNote, plainName, revisable } from './plan.js';
import { DraftEditor } from './DraftEditor.js';

/** Whether a draft can be made now, as a coloured dot and a short label. */
export function ReadyBadge({ ready }: { ready: Readiness }) {
  return (
    <span className={'ready ' + (ready.tone === 'ok' ? '' : ready.tone === 'warn' ? 'warn' : 'bad')}>
      <span className={'dot ' + (ready.tone === 'ok' ? '' : ready.tone === 'warn' ? 'amber' : 'red')} />
      {ready.label}
    </span>
  );
}

type Include = { title: string; on: boolean; blocked: boolean; onToggle: () => void };
/** The tick that includes a draft in the make. */
export function IncludeBox({ title, on, blocked, onToggle }: Include) {
  return (
    <Checkbox.Root
      className="check"
      checked={on}
      disabled={blocked}
      onCheckedChange={onToggle}
      aria-label={'Include ' + title}
    >
      <Checkbox.Indicator>
        <Icon.Check />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

export function Draft({
  quietSource,
  label,
  project,
  card,
  on,
  blocked,
  busy,
  onToggle,
  own,
  changed,
  ready,
  styles,
  flash,
  onRevise,
  onAskAbout,
  onCollapse,
  checks,
  onAcknowledge,
  onEditMyself,
}: {
  quietSource: boolean;
  label: string;
  project: Project;
  card: ChatCard;
  on: boolean;
  blocked: boolean;
  busy: boolean;
  onToggle: () => void;
  own: Array<[string, string]>;
  changed: string[];
  ready?: Readiness;
  styles: StyleEntry[];
  flash: boolean;
  onRevise: (r: Record<string, unknown>) => Promise<boolean>;
  onAskAbout: () => void;
  onCollapse?: () => void;
  checks: Check[];
  onAcknowledge: (check: Check) => void;
  onEditMyself: (assets: string[]) => void;
}) {
  // A new revision shows itself; the card stays mounted, so notices about the change (a swap) survive it.
  const [view, setView] = useState(card.revisions.length - 1),
    [seen, setSeen] = useState(card.revisions.length);
  if (seen !== card.revisions.length) {
    setSeen(card.revisions.length);
    setView(card.revisions.length - 1);
  }
  const r = (card.revisions[view] ?? latest(card)).request,
    title = titleOf(r),
    current = view === card.revisions.length - 1;
  const [showSoft, setShowSoft] = useState(false),
    [allChanges, setAllChanges] = useState(false),
    [editing, setEditing] = useState(false),
    [full, setFull] = useState(false),
    [swap, setSwap] = useState<string | null>(null),
    [swapped, setSwapped] = useState<{ was: string; now: string } | null>(null),
    { tasks } = useApp();
  const inputs = r.references ?? [];
  const role = (x: string) => roleLabels[x] ?? x;
  const dismiss = (then?: () => void) => () => {
    setSwapped(null);
    then?.();
  };
  const departure = quietSource ? '' : departureNote(project, r, tasks);
  const edit = () => {
    setView(card.revisions.length - 1);
    setEditing(true);
  };
  return (
    <div className={'draft' + (on ? '' : ' off') + (flash ? ' flash' : '')} id={'draft-' + card.id}>
      <div className="top">
        <IncludeBox title={title} on={on} blocked={blocked} onToggle={onToggle} />
        <span className="name" role="heading" aria-level={3} title={title}>
          {label || title}
        </span>
        {card.revisions.length > 1 && (
          <span className="history" aria-label="Draft history">
            <button
              aria-label={'Earlier version of ' + title}
              disabled={view === 0}
              onClick={() => setView(v => v - 1)}
            >
              <Icon.Back />
            </button>
            {view + 1}/{card.revisions.length}
            <button aria-label={'Later version of ' + title} disabled={current} onClick={() => setView(v => v + 1)}>
              <Icon.Next />
            </button>
          </span>
        )}
        {onCollapse && (
          <button className="icon-btn" aria-label="Collapse" onClick={onCollapse}>
            <Icon.Back style={{ transform: 'rotate(90deg)' }} />
          </button>
        )}
        {/* Stays rendered while its dialog is open, so closing the dialog returns focus here. */}
        <button className="btn small quiet" disabled={busy} onClick={edit} aria-label={'Edit ' + title}>
          <Icon.Pencil />
          Edit
        </button>
        <MenuButton
          label={'Options for ' + title}
          items={[
            { label: 'Edit', hint: 'Change settings here, directly.', onSelect: edit, disabled: busy },
            {
              label: 'Edit with Seed',
              hint: 'Describe a change to just this draft.',
              onSelect: onAskAbout,
              disabled: busy,
            },
            {
              label: on ? 'Not now' : 'Include',
              hint: on ? 'Leave this draft out when you make the plan.' : undefined,
              onSelect: onToggle,
              disabled: blocked,
            },
          ]}
        >
          <Icon.More />
        </MenuButton>
      </div>
      {card.left_out && !on && (
        <p className="faint" style={{ margin: 0, fontSize: '0.875rem' }}>
          Left out of this make. Tick it to include it.
        </p>
      )}
      {!current && (
        <p className="changed">
          Showing version {view + 1}.{' '}
          <button className="link" onClick={() => setView(card.revisions.length - 1)}>
            Back to latest
          </button>
        </p>
      )}
      {editing && current && (
        <DraftEditor
          card={card}
          project={project}
          styles={styles}
          busy={busy}
          onClose={() => setEditing(false)}
          onSave={onRevise}
        />
      )}
      <p className={'excerpt' + (full ? ' full' : '')}>{readablePrompt(r, project, tasks)}</p>
      {r.prompt.length > 200 && (
        <button
          className="link"
          style={{ alignSelf: 'flex-start', fontSize: '0.875rem' }}
          aria-expanded={full}
          aria-label={(full ? 'Show less of ' : 'Show full prompt for ') + title}
          onClick={() => setFull(f => !f)}
        >
          {full ? 'Show less' : 'Show full prompt'}
        </button>
      )}
      {inputs.length > 0 && (
        <div className="inputs-row">
          {inputs.map(ref => {
            const name = assetName(project, ref.asset_id, tasks);
            return (
              <span className="input-chip" key={ref.id}>
                <Thumb id={ref.asset_id} kind={ref.kind} alt={name} />
                <span>
                  <b>{role(ref.role)}</b> · {plainName(name)}
                  {ref.range
                    ? ` · ${ref.range.start_seconds}–${ref.range.start_seconds + ref.range.duration_seconds} s`
                    : ''}
                </span>
                {current && !busy && ref.kind === 'image' && (
                  <button
                    className="link"
                    style={{ fontSize: '0.8125rem', marginLeft: 6 }}
                    onClick={() => setSwap(ref.id)}
                    aria-label={'Change ' + role(ref.role).toLowerCase() + ' of ' + title + ': ' + name}
                  >
                    Change
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {swap && (
        <LibraryPicker
          inProject={project.id}
          onlyKind="image"
          heading={'Choose a new ' + (roleLabels[inputs.find(x => x.id === swap)?.role ?? ''] ?? 'input').toLowerCase()}
          onClose={() => setSwap(null)}
          onPick={items => {
            const a = items[0],
              id = swap;
            setSwap(null);
            if (!a || !id) return;
            const old = inputs.find(x => x.id === id);
            const was = old ? plainName(assetName(project, old.asset_id, tasks)).trim() : '';
            const now = plainName(assetName(project, a.id, tasks)).trim();
            // Someone's approved picture is never dropped by a swap: it stays on as a reference, and the prompt
            // follows it, so their name never ends up on a place's picture.
            const keep = Boolean(
              old && approvedReferences(project.choices).some(([, asset]) => asset === old.asset_id),
            );
            const next = swapInput(r, id, { id: a.id, kind: a.kind }, keep);
            setSwapped(!next.kept && was && now && was.toLowerCase() !== now.toLowerCase() ? { was, now } : null);
            void onRevise({ ...revisable(r), prompt: next.prompt, references: next.references });
          }}
        />
      )}
      {swapped && current && (
        <div className="notice warn" role="note">
          This draft now uses {swapped.now} where it used {swapped.was}. Its prompt still describes {swapped.was}, so
          change the prompt before making it.
          <div className="actions">
            <button className="btn small" onClick={dismiss(() => setEditing(true))}>
              Edit the prompt
            </button>
            <button className="btn small" onClick={dismiss(onAskAbout)}>
              Edit with Seed
            </button>
            <button className="btn small" onClick={dismiss()}>
              It’s right as it is
            </button>
          </div>
        </div>
      )}
      {departure && (
        <p className="faint" style={{ margin: 0, fontSize: '0.875rem' }}>
          {departure}
        </p>
      )}
      {own.length > 0 && (
        <div className="chips">
          {own.map(([k, v]) => (
            <span className="chip" key={k}>
              {v}
            </span>
          ))}
        </div>
      )}
      {current && changed.length > 0 && (
        <p className="changed">
          What changed:{' '}
          {changed.length > 3 && !allChanges ? (
            <>
              {changed.slice(0, 2).join(' · ')} ·{' '}
              <button className="link" onClick={() => setAllChanges(true)}>
                {changed.length - 2} more changes
              </button>
            </>
          ) : (
            changed.join(' · ')
          )}
        </p>
      )}
      {current && checks.some(c => c.soft) && (
        <button
          className="link"
          style={{ alignSelf: 'flex-start', fontSize: '0.8125rem' }}
          aria-expanded={showSoft}
          aria-controls={'checks-' + card.id}
          onClick={() => setShowSoft(v => !v)}
        >
          {showSoft ? 'Hide the wording check' : 'Check the wording against the brief'}
        </button>
      )}
      <div id={'checks-' + card.id} className="check-notes">
        {current &&
          checks
            .filter(c => !c.soft || showSoft)
            .map(c => (
              <div className={'check-note' + (c.soft ? ' soft' : '')} key={c.id}>
                <span>
                  {c.soft ? '' : '⚠ '}
                  {c.text}
                </span>
                {c.fixes.map(f => (
                  <button
                    key={f.id}
                    className="btn small"
                    disabled={busy}
                    onClick={() => {
                      if (f.id === 'edit-myself') return onEditMyself(f.assets ?? []);
                      if (f.cropTo) void chooseFrame(project.id, f.cropTo);
                      const patch = f.patch(r);
                      if (Object.keys(patch).length) void onRevise(patch);
                      else onAcknowledge(c);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ))}
      </div>
      {ready && <ReadyBadge ready={ready} />}
      <span className="sr-only">
        {kindLabels[kindOf[card.workflow]]} · {outputNoun(r, r.count)}
      </span>
    </div>
  );
}
