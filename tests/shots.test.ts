import { describe, expect, it } from 'vitest';
import { shotsFromBrief, placeShot } from '../shared/shots.js';
import { applyChoice, chosenTake, noChoices, shotKey } from '../shared/choices.js';

describe('shotsFromBrief', () => {
  it('reads numbered lines under a Shots heading in story order', () => {
    const brief = [
      '# Salt Lamp',
      '## Characters',
      '- Maren: 12, black bob',
      '## Shots',
      '1. The Walk Out: Maren crosses the causeway, wide',
      '- Shot 3 – Lamp Room — she lights the brass lamp, close-up',
      '2) Knocking: medium shot at the red door',
      'Some note without a number',
      '## Rules',
      '1. No text anywhere',
    ].join('\n');
    expect(shotsFromBrief(brief)).toEqual([
      { n: 1, name: 'The Walk Out', action: 'Maren crosses the causeway, wide' },
      { n: 2, name: 'Knocking', action: 'medium shot at the red door' },
      { n: 3, name: 'Lamp Room', action: 'she lights the brass lamp, close-up' },
    ]);
  });
  it('accepts a Shot list heading and lines with no action', () => {
    expect(shotsFromBrief('### Shot list\n**1. Opening**\n1. Duplicate: ignored')).toEqual([
      { n: 1, name: 'Opening', action: '' },
    ]);
  });
  it('returns nothing without a shot heading', () => {
    expect(shotsFromBrief('## Story\n1. First: x')).toEqual([]);
    expect(shotsFromBrief(null)).toEqual([]);
  });
});

describe('shot identity', () => {
  const list = shotsFromBrief('## Shots\n1. Shop Wide: Ines at work\n4. The Doorway: Kai arrives\n5. The Walk: dusk on the pier');
  it('places a result made under an old number at its shot’s current number', () => {
    expect(placeShot('Shot 4: The Walk', list)).toEqual({ n: 5, name: 'The Walk' });
    expect(placeShot('Shot 4: The Doorway keyframe', list)).toEqual({ n: 4, name: 'The Doorway' });
    expect(placeShot('Shot 9: Unlisted', list)).toEqual({ n: 9, name: 'Unlisted' });
    expect(placeShot('Reference: Ines', list)).toEqual({ n: null, name: 'Reference: Ines' });
  });
  it('keys a chosen take by the shot’s name and still reads choices saved by number', () => {
    expect(shotKey(4, 'The Walk!')).toBe('the walk');
    expect(shotKey(4, '')).toBe('#4');
    const both = { references: {}, takes: { 'the walk': { image: 'a' }, '#5': { image: 'b' } } };
    expect(chosenTake(both, 5, 'The Walk', 'image')).toBe('a');
    expect(chosenTake({ references: {}, takes: { '#5': { image: 'b' } } }, 5, 'The Walk', 'image')).toBe('b');
    const cleared = applyChoice(applyChoice(noChoices(), { shot: 'the walk', kind: 'clip', asset: 'c' }), { shot: 'the walk', kind: 'clip', asset: null });
    expect(cleared.takes).toEqual({});
  });
});
