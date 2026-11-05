import React, { useEffect, useMemo, useState } from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import type { ChatCard, ChatGroup, Project, PoolSnapshot } from '../api.js';
import { kindOf, kindLabels, isVideoKind } from '../api.js';
import { Icon } from '../icons.js';
import { MenuButton, Thumb, Dialog } from '../ui.js';
import { useApp } from '../data.js';
import { latest, titleOf, settingChips, changesBetween, outputNoun, assetName } from '../format.js';
import { readiness, styleName, routeOf, type StyleEntry } from './readiness.js';
import { editableFields, revisedRequest, sizeOptions, roleLabels, type EditableFields } from './requests.js';
import { checkDraft, readablePrompt, editablePrompt, cropKey, type Check } from './checks.js';
import { LibraryPicker } from '../library/LibraryPicker.js';

export type Selection = Record<string, boolean>;
type Props = {
  project: Project;
  group: ChatGroup;
  snapshot: PoolSnapshot | null;
  styles: StyleEntry[];
  busy: boolean;
  selection: Selection;
  onSelection: (s: Selection) => void;
  onRevise: (card: ChatCard, request: Record<string, unknown>) => Promise<boolean>;
  onAskAbout: (card: ChatCard) => void;
  onSetAside: () => void;
  flash?: string;
  acknowledged: Set<string>;
  onAcknowledge: (key: string) => void;
  onEditMyself: (card: ChatCard, assets: string[]) => void;
};

/** The one open plan: drafts waiting for the user's go-ahead. Shared settings show once; drafts show what differs. */
export function PlanCard({
  project,
  group,
  snapshot,
  styles,
  busy,
  selection,
  onSelection,
  onRevise,
  onAskAbout,
  onSetAside,
  flash,
  acknowledged,
  onAcknowledge,
  onEditMyself,
}: Props) {
  const cards = group.cards;
  const name = (id: string) => styleName(styles, id);
  const chips = cards.map(c => settingChips(latest(c).request, name));
  const shared = chips[0]?.filter(([k, v]) => chips.every(list => list.some(([k2, v2]) => k2 === k && v2 === v))) ?? [];
  const sharedKeys = new Set(shared.map(([k]) => k));
  const ready = cards.map(c => readiness(latest(c).request, snapshot, styles));
  const sharedReady = ready.every(r => r.label === ready[0]?.label) ? ready[0] : undefined;
  const [compact, setCompact] = useState(cards.length > 2 && innerWidth < 700);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (cards.length > 2 && innerWidth < 700) setCompact(true);
  }, [cards.length]);
  const kind = kindOf[group.workflow];
  const lastRun = cards
    .flatMap(c => c.revisions)
    .filter(r => r.number > 1)
    .map(r => r.run_id)
    .filter(Boolean)
    .at(-1);
  const revisedCount = lastRun ? cards.filter(c => latest(c).run_id === lastRun && latest(c).number > 1).length : 0;
  // Drafts that the same reply added are new, not unchanged.
  const addedCount = lastRun
    ? cards.filter(c => c.revisions.length === 1 && c.revisions[0]!.run_id === lastRun).length
    : 0;
  const working = group.state === 'revising' || group.state === 'assembling';
  // Compact rows lead with what tells drafts apart: words every title starts with are dropped.
  const words = cards.map(c => titleOf(latest(c).request).split(' '));
  let common = 0;
  while (cards.length > 1 && words.every(w => w.length > common + 1 && w[common] === words[0]![common])) common++;
  const { tasks: everywhere } = useApp();
  // One shared source: say it once for the plan instead of on every card.
  const sources = cards.map(c => latest(c).request.references?.[0]?.asset_id ?? '');
  const oneSource = cards.length > 1 && sources[0] && sources.every(x => x === sources[0]) ? sources[0] : '';
  const rawWarnings = cards.map(card =>
    checkDraft(card, project, cards.length).filter(x => !acknowledged.has(card.id + ':' + x.text)),
  );
  // A warning every draft shares is said once, for the whole plan, and its fix applies to all of them.
  const planWide =
    cards.length > 1
      ? (rawWarnings[0] ?? []).filter(w => !w.soft && rawWarnings.every(ws => ws.some(x => x.text === w.text)))
      : [];
  const warnings = rawWarnings.map(ws => ws.filter(w => !planWide.some(p => p.text === w.text)));
  const short = (r: ChatCard) => titleOf(latest(r).request).split(' ').slice(common).join(' ');
  return (
    <section
      className={'card' + (flash === group.id ? ' flash' : '')}
      aria-label={`Plan, ${cards.length} ${cards.length === 1 ? 'draft' : 'drafts'}`}
      id={'group-' + group.id}
    >
      <div className="card-head">
        <b role="heading" aria-level={2}>
          Plan
        </b>
        <span className="meta">
          {cards.length} {cards.length === 1 ? 'draft' : 'drafts'}
          {working
            ? ' · Seed is replying…'
            : revisedCount
              ? ` · last revision: ${[`${revisedCount} changed`, addedCount ? `${addedCount} added` : '', cards.length - revisedCount - addedCount ? `${cards.length - revisedCount - addedCount} unchanged` : ''].filter(Boolean).join(', ')}`
              : ''}
          {!working && cards.some(c => c.left_out) ? ` · Seed left ${cards.filter(c => c.left_out).length} out` : ''}
        </span>
        <span className="end">
          {cards.length > 2 && (
            <button className="btn quiet small" onClick={() => setCompact(c => !c)} aria-pressed={compact}>
              {compact ? 'Show details' : 'Compact'}
            </button>
          )}
          <MenuButton
            label="Plan options"
            items={[
              // One size for every draft at once, so a batch change is one step, not one editor per draft.
              ...sizeOptions(
                cards[0] ? latest(cards[0]).request.workflow : 'text-to-image',
                cards[0] ? latest(cards[0]).request.output.aspect : '16:9',
              ).map(o => ({
                label: 'Make every draft ' + o.label,
                onSelect: () => {
                  void (async () => {
                    for (const c of cards) {
                      const req = latest(c).request;
                      if (req.output.size === o.id) continue;
                      const {
                        workflow: _w,
                        mode: _m,
                        resolved_seeds: _s,
                        ...rest
                      } = req as typeof req & { resolved_seeds?: unknown };
                      if (!(await onRevise(c, { ...rest, output: { ...req.output, size: o.id } }))) break;
                    }
                  })();
                },
                disabled: busy || working,
              })),
              'divider' as const,
              {
                label: 'Set this plan aside',
                hint: 'Drafts are kept under Not made yet; Bring back returns them.',
                onSelect: onSetAside,
                disabled: busy,
              },
            ]}
          >
            <Icon.More />
          </MenuButton>
        </span>
      </div>
      {planWide.map(c => (
        <div className="check-note plan-wide" role="status" key={c.text}>
          <span>⚠ All drafts: {c.text}</span>
          {c.fixes
            .filter(f => !f.action)
            .map(f => (
              <button
                key={f.label}
                className="btn small"
                disabled={busy || working}
                onClick={() => {
                  if (f.cropTo) localStorage.setItem(cropKey(project.id), f.cropTo);
                  void (async () => {
                    for (const card of cards) {
                      const patch = f.patch(latest(card).request);
                      if (Object.keys(patch).length) {
                        if (!(await onRevise(card, patch))) return;
                      } else onAcknowledge(card.id + ':' + c.text);
                    }
                  })();
                }}
              >
                {f.label}
              </button>
            ))}
        </div>
      ))}
      {oneSource && (
        <p className="faint" style={{ margin: 0, padding: '8px 14px 0', fontSize: 13 }}>
          All {cards.length} drafts use “{assetName(project, oneSource, everywhere)}” as their source. Its framing and
          look guide each result; check every take.
        </p>
      )}
      {(shared.length > 0 || sharedReady) && (
        <div className="shared">
          <span>{cards.length > 1 ? 'All drafts:' : ''}</span>
          <span className="chips">
            {shared.map(([k, v]) => (
              <span className="chip" key={k}>
                {v}
              </span>
            ))}
          </span>
          {sharedReady && (
            <span
              className={'ready ' + (sharedReady.tone === 'ok' ? '' : sharedReady.tone === 'warn' ? 'warn' : 'bad')}
            >
              <span
                className={'dot ' + (sharedReady.tone === 'ok' ? '' : sharedReady.tone === 'warn' ? 'amber' : 'red')}
              />
              {sharedReady.label}
            </span>
          )}
        </div>
      )}
      <div className="drafts">
        {cards.map((card, i) => {
          const rev = latest(card),
            r = rev.request,
            on = selection[card.id] ?? !card.left_out,
            blocked = Boolean(ready[i]?.blocked);
          const own = chips[i]!.filter(([k]) => !sharedKeys.has(k));
          const prior = card.revisions.at(-2);
          const changed =
            rev.number > 1 && prior ? changesBetween(prior, rev, name, a => assetName(project, a, everywhere)) : [];
          const toggle = () => !blocked && onSelection({ ...selection, [card.id]: !on });
          // The checkbox and the row's open button are siblings: one control inside another is not allowed.
          if (compact && open !== card.id)
            return (
              <div key={card.id} className="compact-row">
                <Checkbox.Root
                  className="check"
                  checked={on && !blocked}
                  disabled={blocked}
                  onCheckedChange={toggle}
                  aria-label={'Include ' + titleOf(r)}
                >
                  <Checkbox.Indicator>
                    <Icon.Check />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <button
                  className="compact-open"
                  onClick={() => setOpen(card.id)}
                  aria-label={`${titleOf(r)}. Show details`}
                >
                  <span className="lines">
                    <span className="name">{short(card)}</span>
                    {own.length > 0 && <span className="faint">{own.map(([, v]) => v).join(' · ')}</span>}
                    {warnings[i]!.filter(c => !c.soft).map(c => (
                      <span className="warn-line" key={c.text}>
                        ⚠ {c.text}
                      </span>
                    ))}
                  </span>
                  {changed.length > 0 && <span className="dot amber" aria-label="Changed" />}
                </button>
              </div>
            );
          return (
            <Draft
              key={card.id + ':' + rev.number}
              quietSource={Boolean(oneSource)}
              label={short(card)}
              project={project}
              card={card}
              on={on && !blocked}
              blocked={blocked}
              busy={busy || working}
              onToggle={toggle}
              own={own}
              changed={changed}
              ready={sharedReady ? undefined : ready[i]}
              styles={styles}
              flash={flash === card.id}
              onRevise={request => onRevise(card, request)}
              onAskAbout={() => onAskAbout(card)}
              onCollapse={compact ? () => setOpen(null) : undefined}
              kindLabel={kindLabels[kind]}
              checks={warnings[i]!}
              onAcknowledge={text => onAcknowledge(card.id + ':' + text)}
              onEditMyself={assets => onEditMyself(card, assets)}
            />
          );
        })}
      </div>
    </section>
  );
}

function Draft({
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
  kindLabel,
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
  ready?: ReturnType<typeof readiness>;
  styles: StyleEntry[];
  flash: boolean;
  onRevise: (r: Record<string, unknown>) => Promise<boolean>;
  onAskAbout: () => void;
  onCollapse?: () => void;
  kindLabel: string;
  checks: Check[];
  onAcknowledge: (text: string) => void;
  onEditMyself: (assets: string[]) => void;
}) {
  const [view, setView] = useState(card.revisions.length - 1);
  const shown = card.revisions[view] ?? latest(card),
    r = shown.request,
    current = view === card.revisions.length - 1;
  const [swap, setSwap] = useState<string | null>(null),
    [showSoft, setShowSoft] = useState(false),
    [allChanges, setAllChanges] = useState(false);
  const [editing, setEditing] = useState(false),
    [full, setFull] = useState(false),
    { split, tasks, narrow } = useApp();
  const inputs = r.references ?? [];
  // An edit or animation runs on its own engine and size; say so next to the source it came from.
  const sourceJob = inputs.length ? project.jobs.find(j => j.outputs.includes(inputs[0]!.asset_id)) : undefined;
  const departure =
    sourceJob && sourceJob.request.workflow !== r.workflow
      ? (() => {
          const chip = (x: typeof r, k: string) => settingChips(x, id => id).find(([key]) => key === k)?.[1];
          const parts = (['engine', 'size'] as const).filter(k => chip(sourceJob.request, k) !== chip(r, k));
          return parts.length
            ? `“${titleOf(sourceJob.request)}” was made with ${parts.map(k => chip(sourceJob.request, k)).join(' at ')}; this draft uses ${parts.map(k => chip(r, k)).join(' at ')}. Its framing and look come from the source.`
            : '';
        })()
      : '';
  return (
    <div className={'draft' + (on ? '' : ' off') + (flash ? ' flash' : '')} id={'draft-' + card.id}>
      <div className="top">
        <Checkbox.Root
          className="check"
          checked={on}
          disabled={blocked}
          onCheckedChange={onToggle}
          aria-label={'Include ' + titleOf(r)}
        >
          <Checkbox.Indicator>
            <Icon.Check />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <span className="name" role="heading" aria-level={3} title={titleOf(r)}>
          {label || titleOf(r)}
        </span>
        {card.revisions.length > 1 && (
          <span className="history" aria-label="Draft history">
            <button aria-label="Earlier version" disabled={view === 0} onClick={() => setView(v => v - 1)}>
              <Icon.Back />
            </button>
            {view + 1}/{card.revisions.length}
            <button aria-label="Later version" disabled={current} onClick={() => setView(v => v + 1)}>
              <Icon.Next />
            </button>
          </span>
        )}
        {onCollapse && (
          <button className="icon-btn" aria-label="Collapse" onClick={onCollapse}>
            <Icon.Back style={{ transform: 'rotate(90deg)' }} />
          </button>
        )}
        {!editing && (
          <button
            className="btn small quiet"
            disabled={busy}
            onClick={() => {
              setView(card.revisions.length - 1);
              setEditing(true);
            }}
            aria-label={'Edit ' + titleOf(r)}
          >
            <Icon.Pencil />
            Edit
          </button>
        )}
        <MenuButton
          label={'Options for ' + titleOf(r)}
          items={[
            {
              label: 'Edit',
              hint: 'Change settings here, directly.',
              onSelect: () => {
                setView(card.revisions.length - 1);
                setEditing(true);
              },
              disabled: busy,
            },
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
        <p className="faint" style={{ margin: 0, fontSize: 13 }}>
          Seed left this out of the plan. Tick it to make it anyway.
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
      {editing && current && (split || narrow) && (
        <Dialog title={'Edit ' + titleOf(r)} wide onClose={() => setEditing(false)}>
          <DraftEditor
            card={card}
            project={project}
            styles={styles}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={async request => {
              if (await onRevise(request)) setEditing(false);
            }}
          />
        </Dialog>
      )}
      {editing && current && !split && !narrow ? (
        <DraftEditor
          card={card}
          project={project}
          styles={styles}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async request => {
            if (await onRevise(request)) setEditing(false);
          }}
        />
      ) : (
        <>
          <p className={'excerpt' + (full ? ' full' : '')}>{readablePrompt(r, project, tasks)}</p>
          {r.prompt.length > 200 && (
            <button
              className="link"
              style={{ alignSelf: 'flex-start', fontSize: 13 }}
              aria-expanded={full}
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
                      <b>{roleLabels[ref.role] ?? ref.role}</b> · {name}
                      {ref.range
                        ? ` · ${ref.range.start_seconds}–${ref.range.start_seconds + ref.range.duration_seconds} s`
                        : ''}
                    </span>
                    {current && !busy && ref.kind === 'image' && (
                      <button
                        className="link"
                        style={{ fontSize: 12.5, marginLeft: 6 }}
                        onClick={() => setSwap(ref.id)}
                        aria-label={'Change ' + (roleLabels[ref.role] ?? ref.role).toLowerCase() + ': ' + name}
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
              heading={
                'Choose a new ' + (roleLabels[inputs.find(x => x.id === swap)?.role ?? ''] ?? 'input').toLowerCase()
              }
              onClose={() => setSwap(null)}
              onPick={items => {
                const a = items[0],
                  id = swap;
                setSwap(null);
                if (!a || !id) return;
                const {
                  workflow: _w,
                  mode: _m,
                  resolved_seeds: _s,
                  ...rest
                } = r as typeof r & { resolved_seeds?: unknown };
                void onRevise({
                  ...rest,
                  references: inputs.map(x => (x.id === id ? { ...x, asset_id: a.id, kind: a.kind } : x)),
                });
              }}
            />
          )}
          {departure && !quietSource && (
            <p className="faint" style={{ margin: 0, fontSize: 13 }}>
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
          {current && checks.some(c => c.soft) && !showSoft && (
            <button
              className="link"
              style={{ alignSelf: 'flex-start', fontSize: 12.5 }}
              onClick={() => setShowSoft(true)}
            >
              Continuity check
            </button>
          )}
          {current &&
            checks
              .filter(c => !c.soft || showSoft)
              .map(c => (
                <div className={'check-note' + (c.soft ? ' soft' : '')} role="status" key={c.text}>
                  <span>
                    {c.soft ? '' : '⚠ '}
                    {c.text}
                  </span>
                  {c.fixes.map(f => (
                    <button
                      key={f.label}
                      className="btn small"
                      disabled={busy}
                      onClick={() => {
                        if (f.action === 'edit-myself') {
                          onEditMyself(f.assets ?? []);
                          return;
                        }
                        if (f.cropTo) localStorage.setItem(cropKey(project.id), f.cropTo);
                        const patch = f.patch(r);
                        if (Object.keys(patch).length) void onRevise(patch);
                        else onAcknowledge(c.text);
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              ))}
          {ready && (
            <span className={'ready ' + (ready.tone === 'ok' ? '' : ready.tone === 'warn' ? 'warn' : 'bad')}>
              <span className={'dot ' + (ready.tone === 'ok' ? '' : ready.tone === 'warn' ? 'amber' : 'red')} />
              {ready.label}
            </span>
          )}
        </>
      )}
      <span className="sr-only">
        {kindLabel} · {outputNoun(r, r.count)}
      </span>
    </div>
  );
}

/** Inline editor for one draft. Saving keeps the draft selected; it never approves anything. Kind stays fixed. */
function DraftEditor({
  card,
  project,
  styles,
  busy,
  onCancel,
  onSave,
}: {
  card: ChatCard;
  project: Project;
  styles: StyleEntry[];
  busy: boolean;
  onCancel: () => void;
  onSave: (r: Record<string, unknown>) => Promise<void>;
}) {
  const r = latest(card).request,
    kind = kindOf[r.workflow],
    video = isVideoKind(kind),
    { tasks } = useApp();
  // Structured video prompts are edited as readable sections and converted back on save.
  const [readable] = useState(() => editablePrompt(r, project, tasks));
  const [f, setF] = useState<EditableFields>(() => ({ ...editableFields(r), prompt: readable?.text ?? r.prompt }));
  const engine = settingChips(r, id => id).find(([k]) => k === 'engine')?.[1];
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<EditableFields>) => setF(v => ({ ...v, ...patch }));
  const route = routeOf(r);
  const available = useMemo(() => styles.filter(s => s.route === route), [styles, route]);
  const style = f.loras[0];
  // A style added in another tab is not in this tab's list yet: ask for the current list once.
  useEffect(() => {
    if (style && !available.some(s => s.id === style.id)) dispatchEvent(new Event('seed:styles-changed'));
  }, [style?.id]);
  const form = React.useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    form.current?.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true });
  }, []);
  return (
    <form
      ref={form}
      className="editor"
      onSubmit={async e => {
        e.preventDefault();
        setSaving(true);
        try {
          await onSave(revisedRequest(r, { ...f, prompt: readable ? readable.back(f.prompt) : f.prompt }));
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className="field">
        <span>Title</span>
        <input
          className="input"
          value={f.title}
          maxLength={80}
          onChange={e => set({ title: e.target.value })}
          placeholder={titleOf(r)}
        />
      </label>
      <label className="field">
        <span>Prompt</span>
        <textarea
          className="textarea"
          value={f.prompt}
          onChange={e => set({ prompt: e.target.value })}
          rows={Math.min(10, Math.max(3, Math.ceil(f.prompt.length / 70)))}
        />
      </label>
      <div className="row">
        {r.output.aspect !== 'source' && (
          <label className="field">
            <span>Shape</span>
            <select
              aria-label="Shape"
              className="select"
              value={f.aspect}
              onChange={e => set({ aspect: e.target.value as never })}
            >
              {r.workflow === 'text-to-image' ? (
                <>
                  <option value="16:9">Landscape 16:9</option>
                  <option value="1:1">Square 1:1</option>
                  <option value="4:5">Portrait 4:5</option>
                  <option value="9:16">Tall portrait 9:16</option>
                </>
              ) : (
                <>
                  <option value="16:9">Landscape 16:9</option>
                  <option value="9:16">Portrait 9:16</option>
                </>
              )}
            </select>
          </label>
        )}
        <label className="field">
          <span>Size</span>
          <select
            aria-label="Size"
            className="select"
            value={f.size}
            onChange={e => set({ size: e.target.value as never })}
          >
            {sizeOptions(r.workflow, f.aspect).map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>How many</span>
          <select
            aria-label="How many"
            className="select"
            value={f.count}
            onChange={e => set({ count: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 6, 8].map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {video && (
          <label className="field">
            <span>Length</span>
            <select
              aria-label="Length"
              className="select"
              value={f.duration}
              onChange={e => set({ duration: Number(e.target.value) })}
            >
              {[5, 6, 8, 10, 12, 15].map(n => (
                <option key={n} value={n}>
                  {n} seconds
                </option>
              ))}
            </select>
          </label>
        )}
        {video && (
          <label className="field">
            <span>Sound</span>
            <select
              aria-label="Sound"
              className="select"
              value={f.sound}
              onChange={e => set({ sound: e.target.value as 'generated' | 'silent' })}
            >
              <option value="generated">With sound</option>
              <option value="silent">Silent</option>
            </select>
          </label>
        )}
        {video && (
          <label className="field">
            <span>Detail</span>
            <select
              aria-label="Detail"
              className="select"
              value={f.detail}
              onChange={e => set({ detail: e.target.value as 'standard' | 'full' })}
            >
              <option value="standard">Fast</option>
              <option value="full">Full (slower)</option>
            </select>
          </label>
        )}
        {kind !== 'edit' && (
          <label className="field">
            <span>Style</span>
            <select
              aria-label="Style"
              className="select"
              value={style?.id ?? ''}
              onChange={e => {
                const s = available.find(x => x.id === e.target.value);
                set({ loras: s ? [{ id: s.id, revision: s.revision, scale: s.default_scale ?? 1 }] : [] });
              }}
            >
              <option value="">No style</option>
              {style && !available.some(s => s.id === style.id) && (
                <option value={style.id}>
                  {styleName(styles, style.id) === 'Style' ? 'The chosen style' : styleName(styles, style.id)}
                </option>
              )}
              {available.map(s => (
                <option key={s.id} value={s.id} disabled={s.source_status === 'needs_source'}>
                  {s.name}
                  {s.source_status === 'needs_source' ? ' (needs source)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {style && (
          <label className="field">
            <span>Style strength</span>
            <input
              className="input"
              type="number"
              min={0}
              max={4}
              step={0.05}
              value={style.scale}
              onChange={e => set({ loras: [{ ...style, scale: Number(e.target.value) }] })}
            />
          </label>
        )}
        <label className="field">
          <span>Runs on</span>
          <select
            aria-label="Runs on"
            className="select"
            value={f.target}
            onChange={e => set({ target: e.target.value as 'auto' | 'local' | 'cloud' })}
          >
            <option value="auto">Auto</option>
            <option value="local">Seed PC</option>
            <option value="cloud">Cloud GPU</option>
          </select>
        </label>
      </div>
      {engine && (
        <p className="faint" style={{ margin: 0, fontSize: 13 }}>
          {video ? 'Video' : 'Image'} model: {engine}
        </p>
      )}
      <details>
        <summary className="faint">Advanced</summary>
        {readable && (
          <div className="field" style={{ marginTop: 8 }}>
            <span>Prompt as the model receives it</span>
            <div className="prompt" style={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>
              {readable.back(f.prompt)}
            </div>
          </div>
        )}
        <label className="field" style={{ marginTop: 8 }}>
          <span>Seed (random, or a number to repeat a result)</span>
          <input className="input" value={f.seed} onChange={e => set({ seed: e.target.value })} />
        </label>
      </details>
      <div className="buttons">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || saving || !f.prompt.trim()}>
          {saving ? 'Saving…' : 'Save edit'}
        </button>
      </div>
    </form>
  );
}
