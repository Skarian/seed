# Independent semantic review: complex v5, three repetitions

Evidence: `.local/agent-eval-complex-v5-stable`. All36 initial prompts and nine edits were read against the original twelve scenario requests. Canonical settings/input changes and instance identities were compared. The source synthetic fixtures and frozen rubrics are unchanged from the earlier reviews. No rendering quality is claimed; there were no GPU generations.

Automatic settings/tool checks:36/36 trials pass and all45 phases succeed on their first tool attempt. Strict initial requirement retention:28/36 pass,8/36 fail. By repetition:9/12,11/12,8/12. This remains distinct from accepted tool arguments. V4 was7/12 on one repetition; v3 was1/12. The variation confirms a single favorable run is insufficient.

All nine edits preserve the requested narrow delta and stable reference identity relative to their initial request. Case11r1 inherits an initial background-audio duration defect; the edit correctly removes the requested alert but does not repair that preexisting defect. The three case12 reorders now move existing input IDs with their assets, unlike v4's source-reassignment defect.

| Trial | Strict initial review | Evidence |
|---|---|---|
| heldout-01-library-reflection-r1 | Pass | Identity, left/right ownership, bracelet, reflection, lighting and exclusions retained. |
| heldout-01-library-reflection-r2 | Pass | Identity, left/right ownership, bracelet, reflection, lighting and exclusions retained. |
| heldout-01-library-reflection-r3 | Pass | Identity, left/right ownership, bracelet, reflection, lighting and exclusions retained. |
| heldout-02-product-materials-r1 | Fail | No-other-writing restriction narrowed to card/radio rather than entire scene. |
| heldout-02-product-materials-r2 | Pass | Exact text/material/components/cable/camera and exclusions retained. |
| heldout-02-product-materials-r3 | Pass | Exact text/material/components/cable/camera and exclusions retained. |
| heldout-03-station-dialogue-r1 | Fail | Omits subtitles/narrator/third-person bans and below-dialogue ambience priority. |
| heldout-03-station-dialogue-r2 | Fail | Same omitted exclusions/audio priority; laugh called voiceover. |
| heldout-03-station-dialogue-r3 | Fail | Same omissions; soft laughter incorrectly placed inside spoken dialogue tag. |
| heldout-04-silent-frame-sequence-r1 | Pass | Boat/arch/timeline/overhead view and silence preserved. |
| heldout-04-silent-frame-sequence-r2 | Pass | Boat/arch/timeline/overhead view and silence preserved. |
| heldout-04-silent-frame-sequence-r3 | Fail | Omits no-cuts/no-other-view restriction; three Shot sections introduce ambiguity. |
| heldout-05-museum-prop-ownership-r1 | Pass | Correct locked-then-push camera, ownership, dialogue and exclusions in all repetitions. |
| heldout-05-museum-prop-ownership-r2 | Pass | Correct locked-then-push camera, ownership, dialogue and exclusions in all repetitions. |
| heldout-05-museum-prop-ownership-r3 | Pass | Correct locked-then-push camera, ownership, dialogue and exclusions in all repetitions. |
| heldout-06-motion-source-not-scene-r1 | Pass | Correct input roles/clips, near-touch action, scene and exclusions; source-motion fidelity remains ungenerated. |
| heldout-06-motion-source-not-scene-r2 | Pass | Correct input roles/clips, near-touch action, scene and exclusions; source-motion fidelity remains ungenerated. |
| heldout-06-motion-source-not-scene-r3 | Fail | Changes translating tracking camera into a pan. |
| heldout-07-two-audio-channels-r1 | Pass | Distinct440/660 roles, sitting orb, pulse/panel/pullback timing and exclusions retained. |
| heldout-07-two-audio-channels-r2 | Pass | Distinct440/660 roles, sitting orb, pulse/panel/pullback timing and exclusions retained. |
| heldout-07-two-audio-channels-r3 | Pass | Distinct440/660 roles, sitting orb, pulse/panel/pullback timing and exclusions retained. |
| heldout-08-bookend-transformation-r1 | Pass | Fit bookend guides, gradual shape/color/background/timing and exclusions retained. |
| heldout-08-bookend-transformation-r2 | Pass | Fit bookend guides, gradual shape/color/background/timing and exclusions retained. |
| heldout-08-bookend-transformation-r3 | Pass | Fit bookend guides, gradual shape/color/background/timing and exclusions retained. |
| heldout-09-opening-guide-plus-motion-r1 | Pass | Opening guide unnumbered; motion reference, arc/timing/camera/material and exclusions retained. |
| heldout-09-opening-guide-plus-motion-r2 | Pass | Opening guide unnumbered; motion reference, arc/timing/camera/material and exclusions retained. |
| heldout-09-opening-guide-plus-motion-r3 | Pass | Opening guide unnumbered; motion reference, arc/timing/camera/material and exclusions retained. |
| heldout-10-edit-speaker-only-r1 | Pass | Narrow speaker swap preserves all other prompt/identity/settings. |
| heldout-10-edit-speaker-only-r2 | Pass | Narrow speaker swap preserves all other prompt/identity/settings. |
| heldout-10-edit-speaker-only-r3 | Pass | Narrow speaker swap preserves all other prompt/identity/settings. |
| heldout-11-edit-audio-removal-r1 | Fail | Restricts background soundtrack to0–4 seconds rather than background across scene. |
| heldout-11-edit-audio-removal-r2 | Pass | Alert removal preserves video soundtrack mapping/panel/visuals/settings; initial audio defect noted where present. |
| heldout-11-edit-audio-removal-r3 | Pass | Alert removal preserves video soundtrack mapping/panel/visuals/settings; initial audio defect noted where present. |
| heldout-12-history-reorder-identity-r1 | Pass | Line+order edit preserves stable instance IDs, all other settings and scene text. |
| heldout-12-history-reorder-identity-r2 | Pass | Line+order edit preserves stable instance IDs, all other settings and scene text. |
| heldout-12-history-reorder-identity-r3 | Fail | Adds quiet museum ambiance despite footsteps/dialogue-only sound. |

The repeated station failure is the clearest systematic remaining weakness: explicit prohibitions and audio priority continue to vanish despite the generic self-check instruction. Case03r3 also wraps “(soft laughter)” in a dialogue tag, risking literal speech. Cases04r3 and06r3 show camera instructions being weakened or changed. Case02r1 is conservatively failed because “no other writing anywhere on card/radio” narrows the original scene-wide prohibition.

Case05r1 names Joel as Subject4 but additionally calls him S1 during dialogue; Mira is Subject3/S2. The explicit subject names are consistent, so this is a format ambiguity rather than a counted identity failure. Case12r1's quiet echoing-gallery description is treated as room acoustic character, not a newly specified ambient sound; case12r3 explicitly adds ambiance and fails. These judgment boundaries are recorded so the pass rate is reviewable.

No source changes were made during this frozen review. Tool robustness and semantic completeness must continue to be reported separately.

Failure distribution: text-to-image1/6, text-to-video4/6, reference-to-video3/24. Parent confirms the added v5 line-by-line checklist applies only to the reference guide; therefore the repeated station failures do not establish failure of that new checklist on text-to-video, where it was not supplied. Shared guidance for all workflows is a candidate after the freeze.
