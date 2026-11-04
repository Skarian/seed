import React, { useEffect, useMemo, useState } from 'react';
import type { ChatCard, ChatGroup, Project, PoolSnapshot } from '../api.js';
import { kindOf, kindLabels, isVideoKind } from '../api.js';
import { Icon } from '../icons.js';
import { MenuButton, Thumb } from '../ui.js';
import { latest, titleOf, settingChips, changesBetween, outputNoun } from '../format.js';
import { readiness, styleName, routeOf, type StyleEntry } from './readiness.js';
import { editableFields, revisedRequest, sizeOptions, roleLabels, type EditableFields } from './requests.js';

export type Selection = Record<string, boolean>;
type Props = {
  project: Project; group: ChatGroup; snapshot: PoolSnapshot | null; styles: StyleEntry[]; busy: boolean;
  selection: Selection; onSelection: (s: Selection) => void;
  onRevise: (card: ChatCard, request: Record<string, unknown>) => Promise<boolean>;
  onAskAbout: (card: ChatCard) => void; onSetAside: () => void; flash?: string;
};

/** The one open plan: drafts waiting for the user's go-ahead. Shared settings show once; drafts show what differs. */
export function PlanCard({ project, group, snapshot, styles, busy, selection, onSelection, onRevise, onAskAbout, onSetAside, flash }: Props) {
  const cards = group.cards;
  const name = (id: string) => styleName(styles, id);
  const chips = cards.map(c => settingChips(latest(c).request, name));
  const shared = chips[0]?.filter(([k, v]) => chips.every(list => list.some(([k2, v2]) => k2 === k && v2 === v))) ?? [];
  const sharedKeys = new Set(shared.map(([k]) => k));
  const ready = cards.map(c => readiness(latest(c).request, snapshot, styles));
  const sharedReady = ready.every(r => r.label === ready[0]?.label) ? ready[0] : undefined;
  const [compact, setCompact] = useState(cards.length > 2 && innerWidth < 700);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (cards.length > 2 && innerWidth < 700) setCompact(true); }, [cards.length]);
  const kind = kindOf[group.workflow];
  const working = group.state === 'revising' || group.state === 'assembling';
  return <section className={'card' + (flash === group.id ? ' flash' : '')} aria-label={`Plan, ${cards.length} ${cards.length === 1 ? 'draft' : 'drafts'}`} id={'group-' + group.id}>
    <div className="card-head">
      <b>Plan</b><span className="meta">{cards.length} {cards.length === 1 ? 'draft' : 'drafts'}{working ? ' · Seed is updating it…' : ''}</span>
      <span className="end">
        {cards.length > 2 && <button className="btn quiet small" onClick={() => setCompact(c => !c)} aria-pressed={compact}>{compact ? 'Show details' : 'Compact'}</button>}
        <MenuButton label="Plan options" items={[{ label: 'Set this plan aside', hint: 'Drafts move to Not now; you can bring them back.', onSelect: onSetAside, disabled: busy }]}><Icon.More /></MenuButton>
      </span>
    </div>
    {(shared.length > 0 || sharedReady) && <div className="shared">
      <span>{cards.length > 1 ? 'All drafts:' : ''}</span>
      <span className="chips">{shared.map(([k, v]) => <span className="chip" key={k}>{v}</span>)}</span>
      {sharedReady && <span className={'ready ' + (sharedReady.tone === 'ok' ? '' : sharedReady.tone === 'warn' ? 'warn' : 'bad')}><span className={'dot ' + (sharedReady.tone === 'ok' ? '' : sharedReady.tone === 'warn' ? 'amber' : 'red')} />{sharedReady.label}</span>}
    </div>}
    <div className="drafts">
      {cards.map((card, i) => {
        const rev = latest(card), r = rev.request, on = selection[card.id] ?? true, blocked = Boolean(ready[i]?.blocked);
        const own = chips[i]!.filter(([k]) => !sharedKeys.has(k));
        const prior = card.revisions.at(-2);
        const changed = rev.number > 1 && prior ? changesBetween(prior, rev, name) : [];
        const toggle = () => !blocked && onSelection({ ...selection, [card.id]: !on });
        if (compact && open !== card.id) return <button key={card.id} className="compact-row" onClick={() => setOpen(card.id)} aria-label={`${titleOf(r)}, ${on && !blocked ? 'selected' : 'not selected'}. Show details`}>
          <span className="check" role="checkbox" aria-checked={on && !blocked} aria-label={'Include ' + titleOf(r)} onClick={e => { e.stopPropagation(); toggle(); }}>{on && !blocked && <Icon.Check />}</span>
          <span className="name">{titleOf(r)}</span>
          <span className="faint">{own.map(([, v]) => v).join(' · ')}</span>
          {changed.length > 0 && <span className="dot amber" aria-label="Changed" />}
        </button>;
        return <Draft key={card.id + ':' + rev.number} project={project} card={card} on={on && !blocked} blocked={blocked} busy={busy || working} onToggle={toggle} own={own} changed={changed}
          ready={sharedReady ? undefined : ready[i]} styles={styles} flash={flash === card.id}
          onRevise={request => onRevise(card, request)} onAskAbout={() => onAskAbout(card)} onCollapse={compact ? () => setOpen(null) : undefined} kindLabel={kindLabels[kind]} />;
      })}
    </div>
  </section>;
}

function Draft({ project, card, on, blocked, busy, onToggle, own, changed, ready, styles, flash, onRevise, onAskAbout, onCollapse, kindLabel }: {
  project: Project; card: ChatCard; on: boolean; blocked: boolean; busy: boolean; onToggle: () => void; own: Array<[string, string]>; changed: string[];
  ready?: ReturnType<typeof readiness>; styles: StyleEntry[]; flash: boolean; onRevise: (r: Record<string, unknown>) => Promise<boolean>; onAskAbout: () => void; onCollapse?: () => void; kindLabel: string;
}) {
  const [view, setView] = useState(card.revisions.length - 1);
  const shown = card.revisions[view] ?? latest(card), r = shown.request, current = view === card.revisions.length - 1;
  const [editing, setEditing] = useState(false), [full, setFull] = useState(false);
  const inputs = r.references ?? [];
  const names = new Map((project.asset_manifest ?? []).map(a => [a.id, a]));
  return <div className={'draft' + (on ? '' : ' off') + (flash ? ' flash' : '')} id={'draft-' + card.id}>
    <div className="top">
      <span className="check" role="checkbox" tabIndex={blocked ? -1 : 0} aria-checked={on} aria-disabled={blocked} aria-label={'Include ' + titleOf(r)} onClick={onToggle} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }}>{on && <Icon.Check />}</span>
      <span className="name">{titleOf(r)}</span>
      {card.revisions.length > 1 && <span className="history" aria-label="Draft history">
        <button aria-label="Earlier version" disabled={view === 0} onClick={() => setView(v => v - 1)}><Icon.Back /></button>
        {view + 1}/{card.revisions.length}
        <button aria-label="Later version" disabled={current} onClick={() => setView(v => v + 1)}><Icon.Next /></button>
      </span>}
      {onCollapse && <button className="icon-btn" aria-label="Collapse" onClick={onCollapse}><Icon.Back style={{ transform: 'rotate(90deg)' }} /></button>}
      <MenuButton label={'Options for ' + titleOf(r)} items={[
        { label: 'Edit', hint: 'Change settings here, directly.', onSelect: () => { setView(card.revisions.length - 1); setEditing(true); }, disabled: busy },
        { label: 'Edit with Seed', hint: 'Describe a change to just this draft.', onSelect: onAskAbout, disabled: busy },
        { label: on ? 'Not now' : 'Include', hint: on ? 'Leave this draft out when you make the plan.' : undefined, onSelect: onToggle, disabled: blocked },
      ]}><Icon.More /></MenuButton>
    </div>
    {!current && <p className="changed">Showing version {view + 1}. <button className="link" onClick={() => setView(card.revisions.length - 1)}>Back to latest</button></p>}
    {editing && current ? <DraftEditor card={card} styles={styles} busy={busy} onCancel={() => setEditing(false)} onSave={async request => { if (await onRevise(request)) setEditing(false); }} />
      : <>
        <p className={'excerpt' + (full ? ' full' : '')} onClick={() => setFull(f => !f)} title={full ? 'Show less' : 'Show the full prompt'}>{r.prompt.replace(/\[\[([^\]]+)\]\]/g, '$1')}</p>
        {inputs.length > 0 && <div className="inputs-row">{inputs.map(ref => { const a = names.get(ref.asset_id); return <span className="input-chip" key={ref.id}><Thumb id={ref.asset_id} kind={ref.kind} alt={a?.name ?? 'Input'} /><span><b>{roleLabels[ref.role] ?? ref.role}</b>{ref.range ? ` · ${ref.range.start_seconds}–${ref.range.start_seconds + ref.range.duration_seconds} s` : ''}</span></span>; })}</div>}
        {own.length > 0 && <div className="chips">{own.map(([k, v]) => <span className="chip" key={k}>{v}</span>)}</div>}
        {current && changed.length > 0 && <p className="changed">What changed: {changed.join(' · ')}</p>}
        {ready && <span className={'ready ' + (ready.tone === 'ok' ? '' : ready.tone === 'warn' ? 'warn' : 'bad')}><span className={'dot ' + (ready.tone === 'ok' ? '' : ready.tone === 'warn' ? 'amber' : 'red')} />{ready.label}</span>}
      </>}
    <span className="sr-only">{kindLabel} · {outputNoun(r, r.count)}</span>
  </div>;
}

/** Inline editor for one draft. Saving keeps the draft selected; it never approves anything. Kind stays fixed. */
function DraftEditor({ card, styles, busy, onCancel, onSave }: { card: ChatCard; styles: StyleEntry[]; busy: boolean; onCancel: () => void; onSave: (r: Record<string, unknown>) => Promise<void> }) {
  const r = latest(card).request, kind = kindOf[r.workflow], video = isVideoKind(kind);
  const [f, setF] = useState<EditableFields>(() => editableFields(r));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<EditableFields>) => setF(v => ({ ...v, ...patch }));
  const route = routeOf(r);
  const available = useMemo(() => styles.filter(s => s.route === route), [styles, route]);
  const style = f.loras[0];
  return <form className="editor" onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onSave(revisedRequest(r, f)); } finally { setSaving(false); } }}>
    <label className="field"><span>Title</span><input className="input" value={f.title} maxLength={80} onChange={e => set({ title: e.target.value })} placeholder={titleOf(r)} /></label>
    <label className="field"><span>Prompt</span><textarea className="textarea" value={f.prompt} onChange={e => set({ prompt: e.target.value })} rows={Math.min(10, Math.max(3, Math.ceil(f.prompt.length / 70)))} /></label>
    <div className="row">
      {r.output.aspect !== 'source' && <label className="field"><span>Shape</span><select className="select" value={f.aspect} onChange={e => set({ aspect: e.target.value as '16:9' | '9:16' })}><option value="16:9">Landscape 16:9</option><option value="9:16">Portrait 9:16</option></select></label>}
      <label className="field"><span>Size</span><select className="select" value={f.size} onChange={e => set({ size: e.target.value as never })}>{sizeOptions(r.workflow, f.aspect).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label className="field"><span>How many</span><select className="select" value={f.count} onChange={e => set({ count: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      {video && <label className="field"><span>Length</span><select className="select" value={f.duration} onChange={e => set({ duration: Number(e.target.value) })}>{[5, 6, 8, 10, 12, 15].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label>}
      {video && <label className="field"><span>Sound</span><select className="select" value={f.sound} onChange={e => set({ sound: e.target.value as 'generated' | 'silent' })}><option value="generated">With sound</option><option value="silent">Silent</option></select></label>}
      {video && <label className="field"><span>Detail</span><select className="select" value={f.detail} onChange={e => set({ detail: e.target.value as 'standard' | 'full' })}><option value="standard">Fast</option><option value="full">Full (slower)</option></select></label>}
      {kind !== 'edit' && <label className="field"><span>Style</span><select className="select" value={style?.id ?? ''} onChange={e => { const s = available.find(x => x.id === e.target.value); set({ loras: s ? [{ id: s.id, revision: s.revision, scale: s.default_scale ?? 1 }] : [] }); }}><option value="">No style</option>{available.map(s => <option key={s.id} value={s.id} disabled={s.source_status === 'needs_source'}>{s.name}{s.source_status === 'needs_source' ? ' (needs source)' : ''}</option>)}</select></label>}
      {style && <label className="field"><span>Style strength</span><input className="input" type="number" min={0} max={4} step={0.1} value={style.scale} onChange={e => set({ loras: [{ ...style, scale: Number(e.target.value) }] })} /></label>}
      <label className="field"><span>Runs on</span><select className="select" value={f.target} onChange={e => set({ target: e.target.value as 'auto' | 'local' | 'cloud' })}><option value="auto">Auto</option><option value="local">Seed PC</option><option value="cloud">Cloud GPU</option></select></label>
    </div>
    <details><summary className="faint">Advanced</summary><label className="field" style={{ marginTop: 8 }}><span>Seed (random, or a number to repeat a result)</span><input className="input" value={f.seed} onChange={e => set({ seed: e.target.value })} /></label></details>
    <div className="buttons"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy || saving || !f.prompt.trim()}>{saving ? 'Saving…' : 'Save edit'}</button></div>
  </form>;
}
