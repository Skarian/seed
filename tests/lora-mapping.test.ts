import { it, expect } from 'vitest';
import { suggestLoraMapping } from '../shared/loras.js';

const file = (id: number, name: string, supported = true) => ({ id, name, size_bytes: 1, supported });

it('suggests a use for each style file so a normal import needs no routing', () => {
  expect(suggestLoraMapping('krea2', [file(1, 'look.safetensors'), file(2, 'readme.txt', false)])).toEqual({ 1: 'image' });
  expect(suggestLoraMapping('h3', [file(1, 'tone-a.safetensors'), file(2, 'tone-b.safetensors'), file(3, 'readme.txt', false)])).toEqual({ 1: 'fl', 2: 'ref' });
  expect(suggestLoraMapping('h3', [file(1, 'style_ref.safetensors'), file(2, 'style_i2v.safetensors')])).toEqual({ 1: 'ref', 2: 'fl' });
  expect(suggestLoraMapping('h3', [file(1, 'a.safetensors'), file(2, 'b.safetensors'), file(3, 'c.safetensors')])).toEqual({});
});
