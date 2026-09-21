# Final v5 fresh creation and recovery review

Evidence: `.local/agent-eval-final-v5-stable`. Reviews below use actual saved prompt text and requested settings, not only the harness pass flag.

## Fresh creation: all 54 reviewed

All 54 requests saved successfully. 50/54 saved without a rejected call. The four repaired cases are standalone audio references: `fresh-create-sound-sfw-r1`, `-sfw-r3`, `-nsfw-r1`, and `-nsfw-r2`. The model sometimes supplied a video-only soundtrack flag or used `[[input1:audio]]` for a standalone audio input. No invalid request was saved during those attempts.

52/54 saved prompts preserve the requested scene and silent output consistently. Two prompts contradict the saved `audio.output: silent` setting in `overall_soundscape`: `fresh-create-mixed-sfw-r2` and `fresh-create-mixed-nsfw-r1` describe a composite of the supplied tones. The input tracks are correctly retained, but the generation prompt should describe final silence. This is a semantic defect even though the tool accepts the request and the final output flag is silent.

The remaining prompts retain the sphere/triangle identities, opening and ending roles, motion-source usage, and requested direction or transformation. Additional visual styling is consistent with these underspecified scene requests. Audio references guide pulsation without a claim that the agent heard the audio. Video-motion descriptions remain instructions for the generation model, not evidence that every source movement was inspected.

There are minor guide-format inconsistencies: some frame-only prompts put style before the starting-frame preamble or after `[Shot 1]`. These are recorded separately from user-intent preservation; no GPU output was generated to measure their effect. Passing this basic set is not evidence of arbitrary complex creative reliability.

## Recovery

All 36 recovery cases were reviewed. Invalid requests saved no card; the agent asked for a supported value, a missing image, or a clip range within the actual six-second source. All 36 corrected requests saved on their first call and retained the original scene, references, and silent output. Six one-second-duration attempts and one oversized-count attempt first hit schema validation before clarification; those expected invalid-phase calls are separate from corrected-phase success. Some count-limit explanations were vague rather than stating the maximum of 16. No false generation-completed claims were observed.
