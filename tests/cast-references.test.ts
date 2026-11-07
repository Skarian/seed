import { describe, expect, it } from 'vitest';
import { validateCastReferences } from '../server/chat/references.js';
import { castFromBrief } from '../shared/cast.js';

const cast = castFromBrief('## Characters\n- Odile Brann: 62, veil\n- Pim: 9, odd laces\n## Places\n- The Orchard: old apple trees');
const picks = { references: { 'Odile Brann': 'odile', 'Pim': 'pim', 'The Orchard': 'orchard' }, takes: {} };
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
    expect(validateCastReferences(request(p), cast, { references: { 'Odile Brann': 'odile', 'Pim': 'pim' }, takes: {} })).toBe(p);
  });
});

describe('looks ride along with references', () => {
  it('adds the parts of a referenced character’s look the prompt does not carry', async () => {
    const { withCastLooks } = await import('../server/chat/references.js');
    const c = castFromBrief('## Characters\n- Ines Varga: 40, apprentice, shaved head, oil-stained blue overalls, brass goggles\n## Props\n- The Bell: tarnished brass ship’s bell');
    const p = { references: { 'Ines Varga': 'ines', 'The Bell': 'bell' }, takes: {} };
    const r = (prompt: string, refs = ['ines']) => ({ workflow: 'image-to-image', prompt, references: refs.map((a, i) => ({ id: 'r' + i, asset_id: a, kind: 'image', role: i ? 'reference' : 'source' })) }) as any;
    expect(withCastLooks(r('Ines Varga, the mechanic from <image1>, in blue overalls that are oil-stained.'), c, p)).toBe(
      'Ines Varga, the mechanic from <image1>, in blue overalls that are oil-stained. Ines Varga’s look: shaved head, brass goggles.',
    );
    expect(withCastLooks(r('Ines with her shaved head, oil-stained blue overalls and brass goggles.'), c, p)).toBe('Ines with her shaved head, oil-stained blue overalls and brass goggles.');
    expect(withCastLooks(r('A bell from <image1>.', ['bell']), c, p)).toBe('A bell from <image1>. The Bell’s look: tarnished brass ship’s bell.');
    expect(withCastLooks({ ...r('x'), workflow: 'text-to-image' }, c, p)).toBe('x');
  });
});

describe('cast names', () => {
  it('keeps titles, accents and hyphens in names', () => {
    const c = castFromBrief('## Characters\n- Dr. Amara Okafor-Lind: 52, astronomer\n- Élodie Marchand: 30, red coat\n- Teo (boy): 8, freckles');
    expect(c.map(e => e.name)).toEqual(['Dr. Amara Okafor-Lind', 'Élodie Marchand', 'Teo']);
  });
});

describe('looks that belong to particular shots', () => {
  it('never carries a per-shot state into every shot, and keeps bracketed lists whole', async () => {
    const { withCastLooks, lookParts } = await import('../server/chat/references.js');
    expect(lookParts('paper lanterns (red, amber, white) on the beams, a brass hook')).toEqual([
      'paper lanterns (red, amber, white) on the beams',
      'a brass hook',
    ]);
    const c = castFromBrief('## Props\n- Carp Lantern: red paper carp lantern, In shots 1-3 it is crushed flat on one side; in shot 4 it is fully mended and glowing');
    const p = { references: { 'Carp Lantern': 'lamp' }, takes: {} };
    const r = { workflow: 'image-to-image', prompt: 'A market stall.', references: [{ id: 'input1', asset_id: 'lamp', kind: 'image', role: 'source' }] } as any;
    const out = withCastLooks(r, c, p);
    expect(out).not.toMatch(/shot 4|shots 1-3/i);
    expect(out).toContain('Carp Lantern’s look: red paper carp lantern.');
  });
});

describe('looks follow the shot record', () => {
  it('adds a look only for people the shot is about, never to close-ups, and never traits', async () => {
    const { withCastLooks } = await import('../server/chat/references.js');
    const { isVisibleDetail } = await import('../shared/cast.js');
    expect(['dry', 'unsentimental', 'calm', 'her granddaughter'].map(isVisibleDetail)).toEqual([false, false, false, false]);
    expect(['freckles', 'long silver hair', 'mustard-yellow oilskin'].map(isVisibleDetail)).toEqual([true, true, true]);
    const c = castFromBrief('## Characters\n- Odile Marchetti: dry, unsentimental, long silver hair, mustard-yellow oilskin\n- Tomás Reyes: 9, curly black hair, navy jumper');
    const p = { references: { 'Odile Marchetti': 'odile', 'Tomás Reyes': 'tomas' }, takes: {} };
    const refs = [
      { id: 'input1', asset_id: 'tomas', kind: 'image', role: 'source' },
      { id: 'input2', asset_id: 'odile', kind: 'image', role: 'reference' },
    ];
    const r = (shot: object) => ({ workflow: 'image-to-image', prompt: 'Tomás in the storm.', references: refs, shot }) as any;
    const onlyTomas = withCastLooks(r({ cast: ['Tomás Reyes'] }), c, p);
    expect(onlyTomas).toContain('Tomás Reyes’s look: curly black hair, navy jumper.');
    expect(onlyTomas).not.toMatch(/Odile|dry|unsentimental/);
    expect(withCastLooks(r({ cast: ['Tomás Reyes', 'Odile Marchetti'], framing: 'close-up on hands' }), c, p)).toBe('Tomás in the storm.');
  });
});
