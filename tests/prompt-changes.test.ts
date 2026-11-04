import { it, expect } from 'vitest';
import { promptChanges } from '../web/app/format.js';

// Synthetic prompts only.
it('describes prompt edits as phrases, not word lists', () => {
  expect(promptChanges('A sunny cafe table with a plate of avocado toast, gouache style.', 'A sunny cafe table with a bowl of fresh strawberries, gouache style.'))
    .toEqual(['plate of avocado toast → bowl of fresh strawberries']);
  expect(promptChanges('A teapot on a shelf.', 'A teapot on a shelf, with gentle steam rising.')).toEqual(['added: with gentle steam rising']);
  expect(promptChanges('A red kite, no lettering.', 'A red kite.')).toEqual(['removed: no lettering']);
  expect(promptChanges('A red kite.', 'a red kite.')).toEqual(['prompt reworded']);
});
