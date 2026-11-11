/**
 * What the owner asked for in words: sound, silence, motion. The server reads these when it drafts (a clip stays silent
 * unless sound was asked for) and the plan's checks read them on the same messages, so the two never disagree.
 */

/** The owner's last `count` messages up to a point: what a turn was asked for. */
export const asked = (messages: ReadonlyArray<{ role: string; text: string }>, count: number) =>
  messages
    .filter(m => m.role === 'user')
    .slice(-count)
    .map(m => m.text);

export const asksForSilence = (text: string) =>
  /\b(silent|no sound|no audio|without (?:sound|audio)|mute)\b/i.test(text);
/** Sound in any form ("we hear footsteps on the pier"), unless the same words ask for silence. */
export const asksForSound = (text: string) =>
  /\b(sound|audio|music|score|soundtrack|ambien\w*|noise|voice|dialog\w*|speak\w*|sings?|hear|footsteps|waves crashing)\b/i.test(
    text,
  ) && !asksForSilence(text);
/** A clip rather than a still ("animate shot 2", "a 10-second video"). */
export const asksForMotion = (text: string) =>
  /\b(clips?|videos?|animat\w*|motion|moving|movie|footage|move|film it|seconds?)\b/i.test(text);
