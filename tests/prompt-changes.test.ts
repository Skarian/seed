import { it, expect } from 'vitest';
import { promptChanges } from '../web/app/format.js';

// Synthetic prompts only.
it('describes prompt edits as phrases, not word lists', () => {
  expect(promptChanges('A sunny cafe table with a plate of avocado toast, gouache style.', 'A sunny cafe table with a bowl of fresh strawberries, gouache style.'))
    .toEqual(['plate of avocado toast → bowl of fresh strawberries']);
  expect(promptChanges('A teapot on a shelf.', 'A teapot on a shelf, with gentle steam rising.')).toEqual(['added: gentle steam rising']);
  expect(promptChanges('A red kite, no lettering.', 'A red kite.')).toEqual(['removed: no lettering']);
  expect(promptChanges('A red kite.', 'a red kite.')).toEqual(['prompt reworded']);
});

it('drops a closing bracket whose opening one was not part of the change', () => {
  expect(promptChanges('Mara walks the pier.', 'Mara (navy wool trousers, worn black boots) walks the pier.')).toEqual(['added: navy wool trousers, worn black boots']);
});

it('never shows engine input tokens in a change summary', () => {
  const out = promptChanges('A girl on a pier.', 'A girl on a pier, based on <image1>.').join(' ');
  expect(out).not.toMatch(/image1|<|\[\[/);
});
