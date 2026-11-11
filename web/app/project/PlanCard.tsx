import { useEffect, useState } from 'react';
import type { ChatCard, ChatGroup, Project, PoolSnapshot } from '../api.js';
import { Icon } from '../icons.js';
import { MenuButton } from '../ui.js';
import { chooseFrame, useApp } from '../data.js';
import { latest, titleOf, settingChips, changesBetween, assetName } from '../format.js';
import { readiness, styleName, type StyleEntry } from './readiness.js';
import { sizeOptions } from './requests.js';
import { ackKey, askedFor, checkDraft } from './checks.js';
import { commonWords, preflight, revisable, reviseEach, revisionSummary, sharedChips, splitWarnings } from './plan.js';
import { Draft, IncludeBox, ReadyBadge } from './Draft.js';

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
  const shared = sharedChips(chips);
  const sharedKeys = new Set(shared.map(([k]) => k));
  const ready = cards.map(c => readiness(latest(c).request, snapshot, styles));
  const sharedReady = ready.every(r => r.label === ready[0]?.label) ? ready[0] : undefined;
  const [compact, setCompact] = useState(cards.length > 2 && innerWidth < 700);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (cards.length > 2 && innerWidth < 700) setCompact(true);
  }, [cards.length]);
  const working = group.state === 'revising' || group.state === 'assembling';
  // Compact rows lead with what tells drafts apart: words every title starts with are dropped.
  const common = commonWords(cards);
  const short = (r: ChatCard) => titleOf(latest(r).request).split(' ').slice(common).join(' ');
  const { tasks: everywhere } = useApp();
  // One shared source: say it once for the plan instead of on every card.
  const sources = cards.map(c => latest(c).request.references?.[0]?.asset_id ?? '');
  const oneSource = cards.length > 1 && sources[0] && sources.every(x => x === sources[0]) ? sources[0] : '';
  // A warning every draft shares is said once, for the whole plan, and its fix applies to all of them.
  const { planWide, warnings } = splitWarnings(
    cards.map(card => checkDraft(card, project, cards.length).filter(x => !acknowledged.has(ackKey(card, x)))),
  );
  const missing = preflight(cards, warnings, selection);
  const leftOut = cards.filter(c => c.left_out).length;
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
          {working ? ' · Seed is replying…' : revisionSummary(cards)}
          {!working && leftOut ? ` · ${leftOut} left out` : ''}
        </span>
        <span className="end">
          {cards.length > 2 && (
            <button className="btn quiet small" onClick={() => setCompact(c => !c)} aria-pressed={compact}>
              Compact view
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
                  void reviseEach(
                    cards,
                    c => {
                      const req = latest(c).request;
                      return req.output.size === o.id
                        ? null
                        : { ...revisable(req), output: { ...req.output, size: o.id } };
                    },
                    onRevise,
                  );
                },
                disabled: busy || working,
              })),
              'divider' as const,
              // The delivery frame: results show its guides and Crop starts there. Models still make their own shapes.
              ...(['', '2.39:1', '1.85:1', '21:9', '2:3'] as const).map(frame => ({
                label: frame
                  ? `Crop to ${frame} later`
                  : !project.frame && askedFor(project.messages).other
                    ? `No delivery crop chosen yet (you asked for ${askedFor(project.messages).other})`
                    : 'No delivery crop (keep the shape made)',
                hint: frame ? 'Results show its guides' : undefined,
                checked: (project.frame ?? '') === frame,
                onSelect: () => void chooseFrame(project.id, frame),
                disabled: busy || working,
              })),
              'divider' as const,
              { label: 'Put this plan aside', hint: 'You can bring it back', onSelect: onSetAside, disabled: busy },
            ]}
          >
            <Icon.More />
          </MenuButton>
        </span>
      </div>
      {planWide.map(c => (
        <div className="check-note plan-wide" key={c.text}>
          <span>
            ⚠ All drafts:{' '}
            {c.text.replace(
              /\b([Tt])his draft is/g,
              (_m, t: string) => (t === 'T' ? 'These' : 'these') + ' drafts are',
            )}
          </span>
          {c.fixes
            .filter(f => !f.action)
            .map(f => (
              <button
                key={f.label}
                className="btn small"
                disabled={busy || working}
                onClick={() => {
                  if (f.cropTo) void chooseFrame(project.id, f.cropTo);
                  // The fix applies to every draft; a draft it does not change just stops showing the warning.
                  void reviseEach(
                    cards,
                    card => {
                      const patch = f.patch(latest(card).request);
                      if (Object.keys(patch).length) return patch;
                      onAcknowledge(ackKey(card, c));
                      return null;
                    },
                    onRevise,
                  );
                }}
              >
                {f.label}
              </button>
            ))}
        </div>
      ))}
      {missing.length > 0 && (
        <div className="check-note plan-wide preflight">
          <div>
            <b>
              {missing.length === 1 ? 'One draft leaves out' : `${missing.length} drafts leave out`} details from the
              brief
            </b>
            <ul className="preflight-list">
              {missing.map(m => (
                <li key={m.card.id}>
                  <b>{short(m.card) || titleOf(latest(m.card).request)}:</b>{' '}
                  {m.check.text.replace(/^Missing from this prompt:\s*/, '').replace(/\.$/, '')}
                </li>
              ))}
            </ul>
          </div>
          <button
            className="btn small"
            disabled={busy || working}
            onClick={() => {
              void reviseEach(
                missing.map(m => m.card),
                (card, i) => {
                  const patch = missing[i]!.check.fixes[0]!.patch(latest(card).request);
                  return (patch as { prompt?: string }).prompt === latest(card).request.prompt ? null : patch;
                },
                onRevise,
              );
            }}
          >
            Add details to {missing.length === 1 ? 'it' : `${missing.length} drafts`}
          </button>
        </div>
      )}
      {project.frame && (
        <p className="faint" style={{ margin: 0, padding: '8px 14px 0', fontSize: '0.875rem' }}>
          Delivered at {project.frame}: these drafts are made at the shapes shown, then cropped to {project.frame} with
          Crop. The guides on each result show what stays.
        </p>
      )}
      {oneSource && (
        <p className="faint" style={{ margin: 0, padding: '8px 14px 0', fontSize: '0.875rem' }}>
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
          {sharedReady && <ReadyBadge ready={sharedReady} />}
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
                <IncludeBox title={titleOf(r)} on={on && !blocked} blocked={blocked} onToggle={toggle} />
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
              key={card.id}
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
              checks={warnings[i]!}
              onAcknowledge={check => onAcknowledge(ackKey(card, check))}
              onEditMyself={assets => onEditMyself(card, assets)}
            />
          );
        })}
      </div>
    </section>
  );
}
