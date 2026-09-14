# Release v6 scoped semantic review

Evidence: `.local/agent-eval-release-v6`. Scope: two standalone-audio creates, one mixed-input create, and complex03/06/12. No source changes during review. No generated video quality is claimed.

| Case | Tool first attempt | Strict semantic result |
|---|---|---|
| fresh-create-sound-sfw-r1 | Pass | Pass: audio1 clip1–4 seconds, visual pulsation, silent output; no fake soundtrack channel. |
| fresh-create-sound-nsfw-r1 | Pass | Pass: same source/clip/silent semantics, Spicy mode retained. |
| fresh-create-mixed-sfw-r1 | Pass | Pass: image, motion/video soundtrack and standalone audio retained with proper labels and clips; soundscape now Silence. |
| heldout-06-motion-source-not-scene-r1 | Pass | Pass: correct tracking camera, hand near-touch timeline, source-audio off, exclusions and quiet rolling/room ambience. |
| heldout-03-station-dialogue-r1 | Pass | Fail under strict rubric: now preserves narrator/subtitles bans and below-dialogue ambience, but encodes (soft laugh) inside spoken dialogue tag and does not explicitly retain no-third-person prohibition. |
| heldout-12-history-reorder-identity-r1 | Both phases pass | Initial strict fail: adds quiet museum ambience despite footsteps/dialogue-only instruction. Edit pass: exact line change and input reorder, stable IDs, no other differences. |

The standalone audio prompts synchronize visual pulses with tone frequency. This is an artistic instruction, not proof that a renderer can visibly reproduce660Hz pulsation. Settings and requested use of audio guidance are correct. Station's literal dialogue-tag laughter remains a known limitation; acceptance is not semantic perfection.

All six scoped cases completed: all seven phases accepted first attempt; four initial semantic passes and two known strict failures. The history edit preserves the correct requested delta and source identity. No claim that the release resolves all semantic instruction-following issues.
