import { it, expect } from 'vitest';
import { pruneTicks, splitWarnings, ticked, type Selection } from '../web/app/project/plan.js';
import type { Check } from '../web/app/project/checks.js';

// Synthetic fixtures only.
const request = (ref: string, asset: string) => ({ references: [{ id: ref, asset_id: asset, role: 'subject' }] }) as any;
// Like the old-reference check: the same words for every draft, but the fix names this draft's own input.
const oldReference = (ref: string): Check => ({
  code: 'old-reference',
  text: 'This draft uses an older picture of Mara, not the approved reference.',
  fixes: [
    {
      label: 'Use Mara’s approved reference',
      patch: x => ({
        references: (x.references ?? []).map(y => (y.id === ref ? { ...y, asset_id: 'approved' } : y)),
      }),
    },
  ],
});

it('applies each draft its own copy of a plan-wide fix', () => {
  const { planWide, warnings } = splitWarnings([[oldReference('in-a')], [oldReference('in-b')]]);
  expect(planWide).toHaveLength(1);
  expect(warnings).toEqual([[], []]);
  const fixed = planWide[0]!.each.map((check, i) =>
    check.fixes[0]!.patch(request(i ? 'in-b' : 'in-a', 'old')),
  ) as Array<{ references: Array<{ asset_id: string }> }>;
  expect(fixed.map(p => p.references[0]!.asset_id)).toEqual(['approved', 'approved']);
});

it('keeps checks with the same words but different codes apart', () => {
  const other: Check = { ...oldReference('in-b'), code: 'unused-input' };
  const { planWide } = splitWarnings([[oldReference('in-a')], [other]]);
  expect(planWide).toEqual([]);
});

it('lets Seed decide again once it changes what it left out', () => {
  const card = (left_out?: boolean) => ({ id: 'a', left_out }) as any;
  const unticked: Selection = { a: { on: false, was: false } };
  expect(ticked(unticked, card(false))).toBe(false);
  // Seed left the draft out, then put it back: the person's choice counts only against the value it overrode.
  expect(ticked(unticked, card(true))).toBe(false);
  expect(ticked({ a: { on: true, was: false } }, card(true))).toBe(false);
  expect(ticked({ a: { on: true, was: true } }, card(true))).toBe(true);
  expect(ticked({}, card(false))).toBe(true);
  // A tick saved by an older release is a plain boolean: Seed's choice decides.
  expect(ticked({ a: false } as unknown as Selection, card(false))).toBe(true);
});

it('retires a tick for good once Seed changes what it overrode, even if Seed changes it back', () => {
  const card = (left_out: boolean) => ({ id: 'a', left_out }) as any;
  let selection: Selection = { a: { on: false, was: false } };
  selection = pruneTicks(selection, [card(false)]);
  expect(ticked(selection, card(false))).toBe(false);
  selection = pruneTicks(selection, [card(true)]);
  selection = pruneTicks(selection, [card(false)]);
  expect(selection).toEqual({});
  expect(ticked(selection, card(false))).toBe(true);
  // The inverse: an override of a left-out draft goes once Seed puts the draft back.
  expect(pruneTicks({ a: { on: true, was: true } }, [card(false)])).toEqual({});
  // A tick for a draft no longer in the plan goes too.
  expect(pruneTicks({ b: { on: true, was: false } }, [card(false)])).toEqual({});
});
