/**
 * Whether a message asks for one of the owner's saved styles ("my Watercolor study style", "the imported Tonal study
 * style", "use the “Tonal study” style", "the Tonal study style", a LoRA), as opposed to a look described in words
 * ("in a hand-painted gouache style"). Used by the server's notes to Seed and by the plan's checks, so they agree.
 */
const named = /\b(?:my|saved|imported)\b[^.?!]{0,40}\bstyles?\b|\blora\b|["“'][^"”'\n]{2,40}["”']\s+style\b|\bstyle\s+(?:called|named)\b/i;
// A capitalised name before "style" after the/use/with/in ("the Tonal study style"); case matters here.
const titled = /\b(?:[Tt]he|[Uu]se|[Uu]sing|[Ww]ith|[Ii]n)\s+\p{Lu}[\p{L}-]*(?:\s+[\p{L}-]+){0,3}\s+style\b/u;
export function asksSavedStyle(text: string): boolean {
  return named.test(text) || titled.test(text);
}
