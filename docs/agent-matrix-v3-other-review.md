# Independent review of v3 fresh creation, recovery, context and photo cases

Evidence root: `.local/agent-eval-matrix-v3-stable`. This is a review of the
recorded **v3** requests, not the subsequently edited v4 instructions. No GPU
generation ran. The harness's deterministic `passed` field does not replace
this semantic verdict.

Review method: read each exact user instruction, first saved executable request,
asset-role mappings, final saved request and final assistant response from the
per-trial snapshots. Check supported settings against the scenario's manifest;
check prompt meaning separately. Settings/revisions/labels are reviewed by
another agent and are intentionally excluded here.

## Fresh creation — 18 reviewed

All 18 preserve the explicit requested seed, batch, aspect, duration, quality,
mode and input clip bounds. Reference identities and roles match the request:
the sphere is the subject/opening guide, the triangle is scene/ending guide,
the video is the motion source, extracted video audio is Audio 1 and separate
audio is Audio 2 when both are included. Opening guides combined with motion
video are described without inventing a numbered Picture label. Every final
assistant reply truthfully says a **request** is ready for review.

| Base case (suffix `-r1`) | Standard verdict | Spicy verdict | Evidence / reasoning |
| --- | --- | --- | --- |
| `fresh-create-image` | Pass | Pass | Yellow sphere remains on green stage; ordinary composition/lighting elaboration is compatible. |
| `fresh-create-video` | Pass | Pass | Sphere rolls across green stage; silent soundscape explicitly N/A. |
| `fresh-create-opening` | Pass | Pass | Actual sphere asset is first frame; movement gently right; static camera compatible. |
| `fresh-create-bookends` | Pass | Pass | Sphere-to-triangle color/shape/background transition; actual ending guide retained. |
| `fresh-create-two-images` | Pass | Pass | Sphere moves toward triangle/pale scene; the two assets are not swapped. |
| `fresh-create-motion` | Pass | Pass | Uses video for motion rather than copying its test-pattern appearance; valid 1–4 second clip, source audio off. |
| `fresh-create-sound` | Pass | **Prompt conflict** | Standard uses audio for pulsation with N/A soundscape. Spicy requests an audible 660 Hz soundscape despite silent output. |
| `fresh-create-opening-motion` | Pass | Pass | Unnumbered opening-frame guide retained; Video 1 supplies motion; audio disabled. |
| `fresh-create-mixed` | **Prompt conflict** | **Prompt conflict** | Assets/channels/settings are correct, but both prompts prescribe audible soundscapes despite silent output. |

Three semantic defects remain despite deterministic passes:

- `fresh-create-mixed-sfw-r1`: `overall_soundscape` asks for a blend of the
  440 Hz and 660 Hz tones. The user explicitly asked for silent output audio.
- `fresh-create-mixed-nsfw-r1`: `overall_soundscape` asks for an electronic hum
  correlated with motion. This conflicts with silent output.
- `fresh-create-sound-nsfw-r1`: `overall_soundscape` asks for the steady 660 Hz
  tone. Again, output was requested silent.

Each is visible in its `snapshot-create.json` under the saved request prompt.
The corresponding `audio.output` is correctly `silent`, so the application would
suppress the waveform. This is a **prompt-level inconsistency**, not evidence
that actual generated media contained audio. The frequencies were supplied in
fixture notes; this does not prove the model listened to the audio. Recommendation:
when output audio is silent, use audio references for visual rhythm if requested,
but write N/A for audible soundscape/music and remove audible-output instructions.

Fresh creation total: **15 semantic passes, 3 prompt conflicts**, out of 18
reviewed. No false completion claim or wrong input binding was found in these 18.

## Recovery — 12 reviewed

All six recovery cases in both modes pass semantic review. No initial invalid request
was saved; the assistant asked for clarification and then prepared the corrected
request. Final responses accurately state that the request is ready for review.
Final prompts preserve the requested subject/motion and are compatible with
silent output; opening-image and video-reference roles/ranges are correct.

| Case, suffix `-sfw-r1` and `-nsfw-r1` | Initial response / final result |
| --- | --- |
| `recovery-invalid-count` | Asks for a supported count; correction saves count 2. Minor clarity issue: says “likely” unsupported and does not state the known 1–16 range. |
| `recovery-invalid-seed` | Correctly cites maximum 9007199254740991; correction uses seed 42. |
| `recovery-invalid-aspect` | Clearly offers 16:9 or 9:16; correction uses 16:9. |
| `recovery-short-duration` | Initial tool attempt with duration 1 is rejected by schema, then response correctly explains minimum 5. Correction preserves its prompt and uses 5 seconds. |
| `recovery-missing-input` | Asks for the sphere image without inventing an ID; subsequent actual attachment becomes first frame. |
| `recovery-impossible-range` | Correctly explains that a six-second source cannot supply seconds 30–33; correction selects source seconds 1–4. |

Both short-duration cases initially tried duration 1 and received schema errors,
visible in `snapshot-invalid.json`. Their `firstAttemptCorrect: true` refers to
the corrected turn, not to an error-free entire dialogue. Report initial errors
separately. Both count clarifications omit the known 1–16 range; this is a minor
clarity issue rather than silent substitution or false success.

## Context — 12 reviewed

All 12 requested edits pass semantic review. Eight have compatible creation
prompts; four inherit the same silent-output prompt conflict found above.
Every final response accurately describes a request awaiting review.

| Case, suffix `-sfw-r1` and `-nsfw-r1` | Edit verdict / creation qualification |
| --- | --- |
| `context-return-to-request` | Pass: returns after an unrelated aside, changes seed to 876 only, preserves exact prompt. |
| `context-visual-return` | Pass: warmer lighting only; opening-image identity, role, rightward motion and settings retained. |
| `context-settings-after-history` | Edit passes: count 2 only, exact prompt and inputs retained. Both creation prompts prescribe audible blended tones despite silent output. |
| `context-compact-visual` | Pass: warmer subject lighting only; sphere and triangle identities, relation/motion, camera and settings retained. |
| `context-compact-roles` | Pass: aspect changes to 9:16 only; exact prompt and first/last frame bindings retained. |
| `context-compact-settings` | Edit passes: seed 99 only, exact prompt and inputs retained. Both creation prompts prescribe audible electronic tones despite silent output. |

The four settings edits correctly avoid rewriting a prompt the user explicitly
said to preserve. Classify these as initial prompt defects, not context drift.
`context-compact-settings-nsfw-r1` also repairs an initial creation asset-handle
error before saving. Its successful first edit does not make the entire dialogue
error-free.

**Coverage gap:** the six `context-compact-*` cases did not actually invoke
summarization. All six `snapshot-edit.json` files have no `run.summary`; their
recorded payloads contain no summarizer call. The fixture inserts one long
105,300-character message, but the dialogue contains fewer than nine messages.
`compactConversation` keeps the latest eight messages and returns without a
summary when there is no earlier message to summarize. These trials demonstrate
preservation with long history, not preservation across compaction. A targeted
follow-up must include more than eight separate messages, with substantial old
content, and assert an actual saved summary and summarizer call.

## Real photograph cases — 5 reviewed

Reviewed the actual four local photographs visually as well as all user messages,
saved requests and final replies. Both people wear orange suits; the woman has
short light-brown hair and holds a helmet with a black visor; the man has closely
cropped hair and a moustache. The dog has a light golden/cream coat and floppy
ears. The cafe has ornate columns, arches, windows and tables with patrons.

| Case, suffix `-r1` | Semantic verdict / evidence |
| --- | --- |
| `heldout-photo-01-opening-portrait` | Pass: woman photo is first frame, orange suit and held helmet retained, small smile/gaze right, fixed camera and original room/light; silent. Minor wording: “her left/right” for background objects should use screen left/right to avoid anatomical ambiguity. |
| `heldout-photo-02-two-people-cafe` | Pass: A/woman left and B/man right, both orange suits, correct picture order, exact dialogue assigned at 4 and 8 seconds, windows ending, patrons removed and helmets hidden. Prompt does not explicitly put helmets on the floor, but preserves the requested visible absence. |
| `heldout-photo-03-dog-room-video` | Pass: actual dog identity and room retained, dog remains seated with forward/left/forward stages at 0/3/6 seconds, source 1–4 second video supplies camera drift only, source audio off, silent output. |
| `heldout-photo-04-edit-one-line` | Pass: reversed source order correctly maps man/B left and woman/A right with her helmet. Dialogue speakers/timing and final smile correct. Edit changes only A's exact sentence; original answer removed and all other prompt text, inputs, settings and note preserved. Initial create wrongly used existing-input IDs and was rejected; retry used asset handles successfully. |
| `heldout-photo-05-two-clips-one-source` | Pass: same source has distinct `clip1` 0–2 and `clip2` 4–6 second instances. Prompt explicitly maps first and second video to target 0–4 and 4–8 seconds; dog stays seated and test pattern excluded. Edit enables audio only on clip2, retaining clip1 audio off, exact prompt, order, ranges, image and all output settings. |

All five final replies truthfully say the request is ready for review. Photo 04's
`firstAttemptCorrect: true` measures its edit; creation required a repaired call.
Bindings preserve reference identities, but prompts that say to preserve the
source hairstyle/face without describing them do not independently prove fine
visual recognition of every facial trait. No actual video generation was tested.

Fixture quality limitation: the cafe JPEG visibly contains a magenta corruption
band over roughly the lower quarter. Its architecture remains clearly readable,
and the saved prompts do not copy the band. Replace the source for future clean
visual tests; keep this frozen evidence unchanged.

## Reviewed-scope result

This review covers **47 trials**: 18 fresh, 12 recovery, 12 context and 5 photos.
All 47 passed the harness's deterministic checks. At the complete-scenario level,
**40 have no material semantic conflict found and 7 have silent-output prompt
conflicts** (3 fresh plus 4 context prerequisites). All 12 context edits and both
photo edits preserve their requested scope. Minor wording/clarification issues
are recorded above. The six named compact cases are not evidence of actual
compaction. This is one repetition per scenario, not the requested three-run
reliability result, and excludes the other agent's settings/revisions/labels scope.
