import { expect, it } from 'vitest';
import { editDimensions, isResolutionSize, resolveDimensions, resolutionOptions, sizeChoices } from '../shared/resolution.js';
import { patchGeneration } from '../shared/generation.js';

it('offers the approved catalog without flags and retains valid historical IDs', () => {
  expect(sizeChoices('text-to-image').map(p => p.id)).toEqual(['image-480','image-768','2mp','image-1440']);
  expect(sizeChoices('text-to-video').map(p => p.id)).toEqual(['480p','768p']);
  expect(isResolutionSize('image-to-image', '2mp')).toBe(true);
  expect(isResolutionSize('text-to-image', '1mp')).toBe(true);
  expect(isResolutionSize('image-to-image', '2mp', true)).toBe(true);
  expect(isResolutionSize('image-to-image', '480p', true)).toBe(false);
  expect(isResolutionSize('text-to-video', null, true)).toBe(false);
});

it.each([
  ['text-to-image', 'image-480', 864, 480], ['text-to-image', 'image-768', 1344, 768], ['text-to-image', 'image-1440', 2560, 1440],
  ['text-to-image', '0.5mp', 896, 504], ['text-to-image', '1mp', 1280, 720], ['text-to-image', '2mp', 1920, 1080],
  ['text-to-video', '480p', 864, 480], ['reference-to-video', '768p', 1344, 768],
] as const)('resolves %s %s and transposes exactly', (workflow, size, width, height) => {
  expect(resolveDimensions(workflow, size, '16:9')).toEqual({width,height});
  expect(resolveDimensions(workflow, size, '9:16')).toEqual({width:height,height:width});
});

it('preserves source rounding, area targets and small-image behavior', () => {
  expect(editDimensions(4000,2000)).toEqual({width:1440,height:736});
  expect(editDimensions(4000,2000,'0.5mp')).toEqual({width:1024,height:512});
  expect(editDimensions(4000,2000,'2mp')).toEqual({width:2048,height:1024});
  expect(editDimensions(50,50)).toEqual({width:64,height:64});
  expect(editDimensions(48,80)).toEqual({width:64,height:96});
  expect(() => editDimensions(31,80)).toThrow();
  expect(() => resolveDimensions('image-to-image','1mp','source')).toThrow('Choose a source');
});

it('removes duplicate dimension rows without rewriting the active preset', () => {
  expect(resolutionOptions('image-to-image','source','2mp',{width:512,height:512},true)).toEqual([{label:'512 × 512',size:'2mp'}]);
  expect(resolutionOptions('image-to-image','source','2mp',{width:1024,height:1024},true)).toEqual([{label:'640 × 640',size:'image-480'},{label:'1024 × 1024',size:'2mp'}]);
});

it('only shows a legacy size while selected, without changing its dimensions or source budget', () => {
  expect(resolutionOptions('text-to-image','16:9','image-768').map(p=>p.label)).toEqual(['864 × 480','1344 × 768','1920 × 1080','2560 × 1440']);
  expect(resolutionOptions('text-to-image','9:16','1mp').at(-1)).toEqual({label:'720 × 1280',size:'1mp'});
  expect(resolutionOptions('image-to-image','source','1mp',{width:512,height:512})).toEqual([{label:'512 × 512',size:'1mp'}]);
});
