# Independent semantic review: complex v4

Evidence: `.local/agent-eval-complex-v4-stable`, numbered cases 01–12, 12 creates plus 3 edits. Photographic cases in the same directory are outside this report. The reviewer read every original request, saved canonical prompt/settings/inputs, the three edits, and final assistant messages. Synthetic fixtures are the same yellow sphere, blue triangle, test-pattern motion and distinct 440/660 Hz tones inspected for v3. No generated assets were produced; prompt correctness is not proof of rendering fidelity.

All 12 automatic settings checks pass. All 15 phases save the correct checked settings on their first attempt with no tool errors. Strict complete prompt requirement retention improves from **1/12 in v3 to 7/12 in v4**. Five initial prompts still omit explicit restrictions. The main scene and dialogue are represented in all 12, although case05 changes camera onset. Of the three edits, two fully preserve intent and identity; case12 preserves the scene but changes input-instance identity.

| Case | Full requirement retention | Evidence |
|---|---|---|
| 01 Library reflection | Pass | Correct people, ownership, left wrist, camera/light, reflection exclusion, all prohibited additions, exact note and settings. Curious mood retained. |
| 02 Product materials | Pass | Exact card text, left/right component counts, cable, matte material, lighting/camera and all exclusions retained. |
| 03 Station dialogue | Fail | Exact dialogue/speakers/timing retained and slow-motion/zoom restrictions now present. Omits no subtitles, no third person and no narrator, and loses explicit ambience-below-dialogue priority. Off-screen laugh is called voiceover; this should not imply a new narrator. |
| 04 Silent frame sequence | Pass | Boat identity, behind-arch passage, all timing, fixed overhead camera and exclusions present. Frame-sequence export and silent output correct. |
| 05 Museum ownership | Fail | Orb/sign/person ownership and dialogue/timing correct. Omits no subtitles and no other people. Starts push-in at 0 seconds throughout, rather than initially locked then pushing. |
| 06 Motion source only | Fail | Correct motion clip/audio-off settings, orb/hand timeline, camera/toolbox and visual-pattern exclusion. Omits no subtitles and explicit no dialogue. Source described as rolling motion although actual test video is synthetic patterns; visual fidelity of borrowed motion remains unproved. |
| 07 Two audio channels | Pass | Correct source soundtrack versus standalone alert roles, 440/660 identities, panel timing, sitting orb, pullback and all exclusions. Fixes v3 floating-or-sitting alternative and extra bright objects. |
| 08 Bookend transformation | Pass | Both fit guides, proper unnumbered ending guide, gradual morph/color/background, precise timing and all exclusions retained. |
| 09 Opening guide + motion | Pass | Opening role retained without invented Picture label; motion clip 2–5 seconds, clockwise arc, timing/material, locked camera and silence/exclusions retained. Full reference six-section format now present. Minor compiled phrase “image the opening-frame guide” is awkward but understandable. |
| 10 Speaker edit | Fail on initial; edit pass | Initial still omits no subtitles. Edit changes exactly speaker ownership plus corresponding summary; wording, speech windows, people, props, inputs and settings retained. |
| 11 Audio removal | Pass; edit pass | Initial includes all explicit exclusions and distinct audio ownership. Edit removes only standalone tone/alert and Audio2 mentions; panel flash and video soundtrack Audio1 retained. |
| 12 History reorder | Fail on initial; identity failure on edit | Initial omits no subtitles but now avoids extra ambience, preserving footsteps/dialogue-only requirement. Edit changes exactly line and correct Picture bindings in scene text, but swaps assets under existing IDs instead of moving existing instances. |

Case12 submitted `[{asset:"input2",id:"input1"},{asset:"input1",id:"input2"}]`. The adapter accepted replacement under each ID, producing input1=blue sign and input2=yellow orb. This is not stable input-instance identity across revisions, even though compiled labels correctly refer to those new associations. Correct reorder is `[{id:"input2"},{id:"input1"}]`. This defect was not detected by the automatic asset-order checks.

All final create/edit messages describe requests ready for review, not completed generated assets. The history aside also states the creative request stayed unchanged.

The v4 improvement is substantial but incomplete: prohibitions still disappear selectively, particularly “no subtitles” in conversational scenes. More real-model repeats are needed; this single run does not establish reliability. Do not equate 12/12 accepted settings with 12/12 preserved user intent.

Following this review, the adapter now requires explicit `replace_asset` for a source change under an existing ID, rejects conflicting id+asset with reorder guidance, preserves a uniquely matching existing instance for asset-only edits, and rejects ambiguous duplicate-source edits. Four focused regression tests pass. These changes occurred after this run and do not retroactively improve its score.
