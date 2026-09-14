# Exploratory v4 revision-edge review

Evidence: `.local/agent-eval-edges-v4-stable`, 18 completed trials, one repetition
each. Prompt guidance changed during this run, so these are exploratory findings,
not a frozen-version reliability score. Read both phases' saved requests and
prompts, requested changes, input identities/settings and final replies.

All 18 deterministic checks pass. All 18 edits save on the first tool call.
Two creation prerequisites (`first_frame-to-last_frame` and
`first_frame-to-reference`) needed a repaired call, correctly reflected in their
whole-scenario first-attempt failures. Every final response describes a request
ready for review rather than claiming generated media.

| Cases (all prefixed `edge-`, suffixed `-r1`) | Semantic findings |
| --- | --- |
| `duplicate-clip-duration`, `duplicate-clip-start` | Only the second instance's requested range component changes. Same source, separate IDs, first clip, ordering/audio and exact prompt preserved. |
| `fill-to-fit`, `fit-to-fill` | Only image framing changes, exact prompt retained. |
| `high-native-to-fast-720p`, `fast-720p-to-high-native` | Exactly quality and size change together; prompt and other settings unchanged. |
| `frame-sequence-to-video`, `video-to-frame-sequence` | Only output format changes; requested generated-audio setting and exact prompt retained. This checks saved intent, not whether a frame export contains playable sound. |
| `first_frame-to-reference`, `last_frame-to-reference` | Correct image label changes to Picture 1, former guide wording removed, motion source and creative scene retained. |
| `reference-to-first_frame`, `last_frame-to-first_frame` | Input role and unnumbered guide binding correct, but rewritten prompt falsely treats the guide composition as showing an orb at left with an arch at center. The actual fixture has a centered sphere and no arch. |
| `reference-to-last_frame`, `first_frame-to-last_frame` | Role/bindings correct; prompt attempts ending continuity, but matching the actual guide conflicts with the retained stationary arch and rightward stopping position. Reference-to-last explicitly prioritizes the guide's final position; first-to-last still says stop on screen right while matching the guide. |
| `replace-image-with-video` | Image replaced by video range 1–4, source audio off, image framing removed. Orb becomes an invented subject rather than something falsely claimed in the test video; staging/timings/camera preserved. |
| `replace-image-same-kind` | Correct triangle asset replaces sphere. Blue/triangular identity replaces yellow/spherical descriptions throughout; sliding replaces rolling and its sound coherently; camera, timings and arch retained. |
| `silent-to-generated` | Enables output sound and faint rolling without enabling source video audio. Visual scene retained; speech/music excluded. |
| `generated-to-silent` | Keeps source soundtrack enabled but replaces audible soundscape with silence. Visual staging/settings preserved. Summary still calls the video an audio guide, compatible with reference use rather than promising audible output. |

The ordinary creation prompts preserve the requested tabletop, yellow orb,
stationary arch, 0–3/3–5/5–8 action stages, locked camera and sound instructions.
The guide cases expose a real conflict in the scenario: the supplied frame has
neither the requested arch nor the requested off-center orb. Naming the correct
guide is not enough to resolve that conflict. A better response should explicitly
reconcile composition with the required starting/ending frame or ask which
constraint takes priority. Do not report these four resulting-guide cases as
unqualified semantic passes. Creation prerequisites that already use frame guides
have the same tension, even when a later edit removes it.

These results support narrow edit preservation and correct canonical bindings.
They do not establish successful generated-video continuity, and no GPU
generation occurred.
