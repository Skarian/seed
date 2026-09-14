# V4 photo semantic review

Evidence: `.local/agent-eval-complex-v4-stable`, all five `heldout-photo-*-r1`
trials, reviewed after the full 17-case run finished. Scope is these five photo
cases only, not the twelve separately reviewed complex synthetic cases. No media
was generated and no source, harness or saved evidence was modified.

Read every phase's exact user message, first saved executable request, final
request, tool calls/results and final assistant reply. Compared photo descriptions
with the four actual source photos previously visually inspected for the v3
review. Checked semantic meaning independently of deterministic pass status.

## Results

All five cases pass deterministic settings/input checks, and all seven creation
or edit phases save on their first tool call with no repair. First saved requests
equal final requests in each phase. Every final reply truthfully states that a
request is ready for review; none claims completed generation.

| Trial | Semantic result |
| --- | --- |
| `heldout-photo-01-opening-portrait-r1` | Pass with minor precision caveats: correct first-frame woman, orange suit, held helmet, small smile and gaze right; fixed six-second portrait, static spacecraft, no extra person, silent output. “Professional studio lighting” is compatible with the photographed portrait, but explicitly saying preserve original lighting would be stronger. Hairstyle and no-added-text constraints are implicit in the starting-frame reference rather than repeated. |
| `heldout-photo-02-two-people-cafe-r1` | Correct identities/order/roles, woman left/man right, both orange suits, helmets explicitly on the floor out of view, exact dialogue at 4 and 8 seconds, windows ending, fixed camera, faint ambience and no music/narration. **Visual precision defect:** the man is described as having a “bald head,” although the photograph shows very closely cropped hair. Keeping the exact reference face/hairstyle is also requested, making this an unnecessary conflicting detail. |
| `heldout-photo-03-dog-room-video-r1` | Pass: actual golden retriever and room, empty of patrons, seated forward/left/forward stages at 0/3/6 seconds, subtle drift from the correct source 1–4 seconds, no test-pattern appearance, walking, other dog, people, text or sound. Video source audio remains disabled by the canonical omitted/false default. |
| `heldout-photo-04-edit-one-line-r1` | Pass: reversed photo order correctly assigns man/B left, woman/A right with her own helmet; dialogue at 3 and 6 seconds and mutual smile at 9, fixed seated shot, warm room and low ambience. Edit replaces only A's sentence, exactly, while retaining B's question and every other prompt character, input, note and setting. “White helmet” describes its outer shell but omits the dominant black visor; “her reference helmet” would avoid needless overspecification. |
| `heldout-photo-05-two-clips-one-source-r1` | Pass: one dog image plus distinct `clipA` 0–2 and `clipB` 4–6 source ranges, same video asset, both initially audio off. Prompt distinguishes first/second reference for target 0–4 and 4–8 seconds, with seated dog, grass and no visible test pattern. Edit enables only clipB audio and adds one phrase to the second shot referencing its soundtrack. All other prompt text, inputs/order/ranges and output settings remain exact. |

The photo 05 added phrase is “accompanied by the audio from <Audio 1>.” This
correctly resolves from `[[clipB:audio]]`: Audio 1 is the sole enabled soundtrack,
even though its parent input is Video 2. It does not enable the first clip or
confuse audio numbering with video numbering. Its audio instruction applies to
the second shot only and is within the requested change; the natural outdoor
ambience remains unchanged.

## Interpretation and limits

Four cases have no material meaning conflict found, with small wording omissions
noted above. One has a localized visual-description defect (closely cropped hair
called bald), while its asset binding, blocking, dialogue and settings remain
correct. Both revision tasks preserve the requested scope. No silent-output
soundscape conflict appears in these five trials.

The source cafe JPEG still contains a magenta corruption band over approximately
its lower quarter. Architecture and furniture are visible, and none of these
prompts copies the band. This frozen run uses that imperfect source; replace it
for future clean-image trials. This is one repetition per case and assesses
prepared request meaning, not generated-video fidelity or long-run reliability.
