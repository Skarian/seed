import { it, expect } from 'vitest';
import { castFromBrief, castOf, mergeCast, briefWithCast } from '../shared/cast.js';

const brief = '# Story\nA ferry at night.\n\n## Characters\n- Noor Haddad: 34, deckhand, red scarf\n  Wardrobe: oilskin coat\n- Ilse: captain, grey braid\n\n## Places\n- The Pier: long wooden pier\n\n## Look\nTeal and amber.';

it('keeps stored entries when the brief stops listing them, and adds and updates from it', () => {
  const stored = castFromBrief(brief);
  expect(stored.map(e => e.name)).toEqual(['Noor Haddad', 'Ilse', 'The Pier']);
  // A reworded brief that no longer parses Ilse's line does not drop her; Noor's look changes; a new place joins.
  const next = mergeCast(stored, '## Characters\n- Noor: 34, deckhand, blue scarf\n* ILSE — captain\n## Places\n- The Pier: long wooden pier\n- The Wheelhouse: brass and glass');
  expect(next.map(e => e.name)).toEqual(['Noor Haddad', 'Ilse', 'The Pier', 'The Wheelhouse']);
  expect(next[0]!.look).toBe('34, deckhand, blue scarf');
  expect(castOf({ cast: next, brief: '' })).toBe(next);
  expect(castOf({ brief }).length).toBe(3);
});

it('rewrites only the changed cast lines of a brief and adds missing ones under their heading', () => {
  const cast = castFromBrief(brief);
  cast[1] = { ...cast[1]!, look: 'captain, grey braid, brass whistle' };
  cast.push({ kind: 'prop', name: 'The Lantern', look: 'tin storm lantern' });
  const out = briefWithCast(brief, cast);
  expect(out).toContain('- Noor Haddad: 34, deckhand, red scarf\n  Wardrobe: oilskin coat');
  expect(out).toContain('- Ilse: captain, grey braid, brass whistle');
  expect(out).toContain('## Props\n- The Lantern: tin storm lantern');
  expect(out).toContain('## Look\nTeal and amber.');
  // Removing Noor takes her wardrobe line with her; renaming is a removal plus the new name.
  const renamed = briefWithCast(brief, [{ kind: 'character', name: 'Noor H.', look: 'deckhand' }, ...cast.slice(1)], ['Noor Haddad']);
  expect(renamed).not.toContain('Noor Haddad');
  expect(renamed).not.toContain('Wardrobe: oilskin coat');
  expect(castFromBrief(renamed).map(e => e.name)).toContain('Noor H.');
});

it('does not add a full name back when the brief lists the short one', () => {
  const cast = [{ kind: 'character' as const, name: 'Noor Haddad', look: '34' }];
  expect(briefWithCast('## Characters\n- Noor: 34', cast)).toBe('## Characters\n- Noor: 34');
});

it('renames in place and drops an emptied cast heading', () => {
  const cast = castFromBrief(brief).filter(e => e.name !== 'The Pier');
  cast[1] = { ...cast[1]!, name: 'Captain Ilse' };
  const out = briefWithCast(brief, cast, ['The Pier'], { Ilse: 'Captain Ilse' });
  expect(out).toContain('- Noor Haddad: 34, deckhand, red scarf\n  Wardrobe: oilskin coat\n- Captain Ilse: captain, grey braid');
  expect(out).not.toMatch(/## Places/);
  expect(out).toContain('## Look\nTeal and amber.');
});
