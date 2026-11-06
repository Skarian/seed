import { describe, expect, it } from 'vitest';
import { validateCastReferences } from '../server/chat/references.js';
import { castFromBrief } from '../shared/cast.js';

const cast = castFromBrief('## Characters\n- Odile Brann: 62, veil\n- Pim: 9, odd laces\n## Places\n- The Orchard: old apple trees');
const picks = { 'ref:Odile Brann': 'odile', 'ref:Pim': 'pim', 'ref:The Orchard': 'orchard' };
const request = (prompt: string) =>
  ({
    workflow: 'image-to-image',
    prompt,
    references: [
      { id: 'a', asset_id: 'odile', kind: 'image', role: 'source' },
      { id: 'b', asset_id: 'pim', kind: 'image', role: 'reference' },
      { id: 'c', asset_id: 'orchard', kind: 'image', role: 'reference' },
    ],
  }) as any;

describe('who is who in reference drafts', () => {
  it('accepts a prompt that names each character beside their reference', () => {
    const p = 'Odile, the woman from <image1>, waves to Pim, the boy from <image2>, in the orchard from <image3>.';
    expect(validateCastReferences(request(p), cast, picks)).toBe(p);
  });
  it('refuses a mix-up once a turn, then names the picture instead of refusing again', () => {
    const p = 'Pim, the boy from <image1>, and the woman from <image2> named Odile.';
    const warned = new Set<string>();
    expect(() => validateCastReferences(request(p), cast, picks, warned)).toThrow('is Odile Brann’s approved reference, but the prompt describes it as Pim');
    expect(validateCastReferences(request(p), cast, picks, warned)).toContain('<image1> (Odile Brann)');
  });
  it('names a reference that is only described, without refusing', () => {
    expect(validateCastReferences(request('The boy from <image1> runs.'), cast, picks)).toBe('The boy from <image1> (Odile Brann) runs.');
  });
  it('leaves places and unapproved images alone', () => {
    const p = 'Odile from <image1> and Pim from <image2> under trees from <image3>.';
    expect(validateCastReferences(request(p), cast, { 'ref:Odile Brann': 'odile', 'ref:Pim': 'pim' })).toBe(p);
  });
});

describe('looks ride along with references', () => {
  it('adds the parts of a referenced character’s look the prompt does not carry', async () => {
    const { withCastLooks } = await import('../server/chat/references.js');
    const c = castFromBrief('## Characters\n- Ines Varga: 40, apprentice, shaved head, oil-stained blue overalls, brass goggles\n## Props\n- The Bell: tarnished brass ship’s bell');
    const p = { 'ref:Ines Varga': 'ines', 'ref:The Bell': 'bell' };
    const r = (prompt: string, refs = ['ines']) => ({ workflow: 'image-to-image', prompt, references: refs.map((a, i) => ({ id: 'r' + i, asset_id: a, kind: 'image', role: i ? 'reference' : 'source' })) }) as any;
    expect(withCastLooks(r('Ines Varga, the mechanic from <image1>, in blue overalls that are oil-stained.'), c, p)).toBe(
      'Ines Varga, the mechanic from <image1>, in blue overalls that are oil-stained. Ines Varga’s look: shaved head, brass goggles.',
    );
    expect(withCastLooks(r('Ines with her shaved head, oil-stained blue overalls and brass goggles.'), c, p)).toBe('Ines with her shaved head, oil-stained blue overalls and brass goggles.');
    expect(withCastLooks(r('A bell from <image1>.', ['bell']), c, p)).toBe('A bell from <image1>. The Bell’s look: tarnished brass ship’s bell.');
    expect(withCastLooks({ ...r('x'), workflow: 'text-to-image' }, c, p)).toBe('x');
  });
});
