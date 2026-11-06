import { describe, expect, it } from 'vitest';
import { shotsFromBrief } from '../shared/shots.js';

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
