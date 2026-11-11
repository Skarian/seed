/** The composer's state for one project, kept on this device across navigation and reloads: draft text, mode, Make
 * settings, finished attachments, a Refine or Animate target, and the open plan's ticks and acknowledged checks. */
import { useEffect, useState } from 'react';
import type { ChatGroup } from '../api.js';
import { useStoredState } from '../data.js';
import type { ComposerContext } from './Composer.js';
import type { Selection } from './plan.js';
import { defaultMake, type Attachment, type MakeSettings } from './requests.js';

/** Reads a stored JSON value; anything missing or unreadable gives the fallback. */
function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
/** Stores a JSON value (undefined removes it); without storage it stays in memory only. */
function save(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* memory only */
  }
}

export function useComposerState(id: string, plan: ChatGroup | undefined) {
  const [text, setText] = useStoredState('seed.draft.' + id, '');
  // The mode is kept with the text it was written for, so a reload never sends a direct-make prompt to the planner.
  const [mode, setMode] = useStoredState<'ask' | 'make'>('seed.mode.' + id, 'ask');
  const [settings, setSettings] = useStoredState<MakeSettings>('seed.make.' + id, defaultMake);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Finished attachments survive a reload, like the text beside them (uploads still in progress do not).
  useEffect(() => setAttachments(load('seed.attach.' + id, [])), [id]);
  useEffect(
    () =>
      save(
        'seed.attach.' + id,
        attachments.filter(a => a.asset_id && !a.progress && !a.error),
      ),
    [attachments],
  );
  // A Refine or Animate target is kept with the text it was typed for.
  const [context, setContext] = useState<ComposerContext>(() => {
    const saved = load<ComposerContext | null>('seed.target.' + id, null);
    return saved?.type === 'using' ? saved : { type: 'talk' };
  });
  useEffect(() => save('seed.target.' + id, context.type === 'using' ? context : undefined), [context, id]);
  const [selection, setSelection] = useState<Selection>({});
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

  // Context follows the plan: an open plan means messages revise it unless the user chose otherwise.
  useEffect(() => {
    setContext(c =>
      plan
        ? c.type === 'talk'
          ? { type: 'plan' }
          : c
        : c.type === 'plan' || c.type === 'keep' || c.type === 'draft'
          ? { type: 'talk' }
          : c,
    );
  }, [Boolean(plan)]);
  // Ticks and acknowledged warnings belong to the plan and survive a reload on this device. A tick keeps the
  // `left_out` it overrode, so when Seed narrows or widens the plan later, Seed's choice wins (see `ticked`).
  useEffect(() => {
    if (!plan) {
      setSelection({});
      return;
    }
    setSelection(load('seed.plan.sel.' + plan.id, {}));
    setAcknowledged(new Set(load<string[]>('seed.plan.ack.' + plan.id, [])));
  }, [plan?.id]);
  useEffect(() => {
    if (!plan) return;
    save('seed.plan.sel.' + plan.id, selection);
    save('seed.plan.ack.' + plan.id, [...acknowledged]);
  }, [selection, acknowledged]);

  return {
    text,
    setText,
    mode,
    setMode,
    settings,
    setSettings,
    attachments,
    setAttachments,
    context,
    setContext,
    selection,
    setSelection,
    acknowledged,
    setAcknowledged,
  };
}
