/** The composer's state for one project, kept on this device across navigation and reloads: draft text, mode, Make
 * settings, finished attachments, a Refine or Animate target, and the open plan's ticks and acknowledged checks. */
import { useEffect, useMemo } from 'react';
import type { ChatGroup } from '../api.js';
import { useStoredState } from '../data.js';
import type { ComposerContext } from './Composer.js';
import { pruneTicks, type Selection } from './plan.js';
import { defaultMake, type Attachment, type MakeSettings } from './requests.js';

export function useComposerState(id: string, plan: ChatGroup | undefined) {
  const [text, setText] = useStoredState('seed.draft.' + id, '');
  // The mode is kept with the text it was written for, so a reload never sends a direct-make prompt to the planner.
  const [mode, setMode] = useStoredState<'ask' | 'make'>('seed.mode.' + id, 'ask');
  const [settings, setSettings] = useStoredState<MakeSettings>('seed.make.' + id, defaultMake);
  const [attachments, setAttachments] = useStoredState<Attachment[]>('seed.attach.' + id, []);
  // A Refine or Animate target is kept with the text it was typed for.
  const [context, setContext] = useStoredState<ComposerContext>('seed.target.' + id, { type: 'talk' });
  // Finished attachments and a Refine or Animate target survive a reload, like the text beside them; uploads still in
  // progress and the other contexts do not.
  useEffect(() => {
    setAttachments(list => list.filter(a => a.asset_id && !a.progress && !a.error));
    setContext(c => (c.type === 'using' ? c : { type: 'talk' }));
  }, []);

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
  const [selection, setSelection] = useStoredState<Selection>('seed.plan.sel.' + plan?.id, {});
  const [acks, setAcks] = useStoredState<string[]>('seed.plan.ack.' + plan?.id, []);
  const acknowledged = useMemo(() => new Set(acks), [acks]);
  const setAcknowledged = (change: (now: Set<string>) => Set<string>) => setAcks(a => [...change(new Set(a))]);
  const leftOut = plan?.cards.map(c => Boolean(c.left_out)).join();
  useEffect(() => {
    if (plan) setSelection(s => pruneTicks(s, plan.cards));
  }, [leftOut]);

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
