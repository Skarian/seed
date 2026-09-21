# Independent semantic review: direct-label pilot v2

Reviewer: `tool_plan` sub-agent. Evidence directory: `.local/agent-eval-pilot-v2-direct`. All 18 completed fresh-create trials were read independently, including their exact user text, saved compiled prompt, reference/setting fields, recorded tool failures and calls, and final assistant message in `snapshot-create.json`. This is a development pilot, not the frozen complex held-out suite.

The two image fixtures were visually inspected. They show a flat yellow circular/sphere symbol on dark green and a blue triangle on a pale background. A six-frame contact sheet of the actual video confirms a moving colored synthetic test pattern, not people or a location. Source audio was verified from the fixture generation definition and media metadata: continuous 440 Hz video soundtrack and separate continuous 660 Hz tone. No generated video/image quality was evaluated and no GPU job was approved.

## Results

- Automated exact-setting/reference checks: **12/18 passed**; **10/18 first-attempt correct** under that checker.
- First mutating tool call accepted: **14/18**. Acceptance alone does not mean the correct inputs were selected.
- Independently reviewed final request intent and prompt consistency: **15/18 passed, 3/18 failed**.
- False claims of completed generation: **0/18**. Every final answer correctly presented the request as ready for review.

Four automated failures involve the model explicitly choosing `fill` while the checker expected `fit`. The pilot user text did not specify framing and its tool rules did not state a fit default. Those are recorded separately as an expectation/default mismatch, not quietly relabeled as explicit user-instruction violations. Cropping can still lose source composition; the subsequent fit-default instruction is appropriate. Do not rewrite this pilot's scores after changing the rule.

The semantic failure count includes the SFW text-to-video prompt asking for rolling sound while the user requested silence. Its saved audio output is correctly silent, so this is a prompt/settings contradiction, not evidence that an audible output was generated.

## Per-case review

Every case below refers to `fresh-create-<lane>-<mode>-r1/result.json` and the sibling `snapshot-create.json`.

| Lane / mode | Final semantic verdict | Evidence and review finding |
|---|---|---|
| image / sfw | Pass | "yellow sphere resting ... green stage" preserves subject, color, resting action and setting. Extra studio lighting does not conflict. Correct seed42/batch1/landscape/1mp. |
| image / nsfw | Pass | "vivid yellow sphere rests ... green stage" preserves all requested content; Spicy mode does not invent sexual content. Correct settings. |
| video / sfw | **Fail** | Visual prompt correctly says yellow sphere rolls across green stage, but `overall_soundscape` requests "The rolling sound of a hard sphere on a solid surface." User requested silent audio. `audio.output` is silent, so the tool passes while prompt consistency fails. |
| video / nsfw | Pass | Yellow sphere rolls over green stage; `overall_soundscape: N/A`, silent output, correct duration and settings. No invented sexual content. |
| opening / sfw | Pass | Image remains first_frame and <Picture 1>; "roll gently ... to the right" preserves the intended motion and yellow/dark-green image. Model chose fill; checker expected unspecified fit. |
| opening / nsfw | Pass | Same first-frame identity and gentle rightward roll, correct silence/settings. Fill-versus-fit expectation mismatch noted separately. |
| bookends / sfw | Pass after recovery | Correct yellow first frame and blue last frame. Saved prompt morphs yellow sphere to blue triangle and fades dark-green background to pale. First call incorrectly mentioned <Picture 2>; retry changed it to ending-frame prose. |
| bookends / nsfw | Pass after recovery | Same correct transition and roles. Initial invalid <Picture 2> recovered; final uses ending-frame description. Fill-versus-fit mismatch remains. |
| two-images / sfw | Pass | <Picture 1> is yellow moving sphere; <Picture 2> is blue stationary triangle/destination. "moves directly toward" preserves direction of relationship. Background transition is a compatible creative choice. |
| two-images / nsfw | Pass | Sphere remains yellow subject and triangle remains blue destination with pale scene background. Sphere moves toward triangle; no label/identity swap. |
| motion / sfw | Pass | <Video 1> maps to correct source clip1–4 with soundtrack false. Prompt explicitly borrows motion while ignoring source colors/patterns. User did not specify sphere color here; choosing gray does not violate a yellow constraint from another case. |
| motion / nsfw | Pass | Correct video source/range/no soundtrack, sphere motion derived from source, no invented person/location. Sharp shifts are consistent with the synthetic moving pattern; exact kinematic reproduction is not proven by this preparation test. |
| sound / sfw | Pass | <Audio 1> maps to separate tone1–4; visible pulsating sphere and silent export preserved. Iridescent material is unconstrained. "Perfect synchronization" with tone frequency is overly strong and not an output guarantee; see quality note below. |
| sound / nsfw | Pass | Same source/range and pulsating sphere intent, silent output, no input identity error. Synchronization language has the same quality concern. |
| opening-motion / sfw | Pass after recovery | Image remains opening guide, video retains clip1–4/no soundtrack. Final describes yellow sphere/dark green directly and uses only valid <Video 1>. Initial invented Picture label was rejected once. |
| opening-motion / nsfw | Pass after recovery | Correct final opening guide/video mapping and color. Two failed attempts retained invalid <Picture 1> before removal. Fill-versus-fit mismatch remains. Final prompt has loose wording about keeping the centered position while moving; opening-center interpretation is clear from its shot description. |
| mixed / sfw | **Fail** | User explicitly requested video motion AND extracted soundtrack plus standalone tone. Video `include_audio` is absent, therefore false. Prompt nevertheless says audio is referenced from <Video 1> and <Audio 1>; the actual soundtrack is not supplied. The standalone tone occupies Audio1 instead of being the second audio reference. |
| mixed / nsfw | **Fail** | Same missing video soundtrack. Prompt additionally claims a 440 Hz layer from <Video 1> and 660 Hz from <Audio 1>, while only the standalone audio is actually passed. Silent export does not authorize dropping a requested conditioning input. |

## Root causes and recommendations from this pilot

1. **Input sound and output sound are confused.** Both mixed cases dropped the requested video soundtrack without a rejected tool call. This is an instruction/selection failure, not a validator failure: false is a valid setting with the wrong user intent. Explicitly distinguish `include_audio` from `audio_output`, then retest mixed cases with final audio both on and off.
2. **Provider guide-label exceptions still cost retries.** Both bookend cases and both mixed opening-guide cases initially invented a Picture slot. All recovered, but the NSFW mixed guide needed two rejections. The next stable-token pilot should test deterministic guide descriptions, not claim success based only on eventual recovery here.
3. **Prompt soundscape should agree with output silence.** The SFW text-only video passes settings checks but leaves audible instructions inside the prompt. A semantic check catches this; JSON validity does not.
4. **Default framing was insufficiently specified.** Four cases chose fill. Preserve these pilot results and make the future default explicit. Do not report every prior fill choice as disobedience when the source instruction omitted that choice.
5. **Avoid unnecessary source certainty.** Both tone cases claim precise visual synchronization with a steady high-frequency tone. The user asked for a pulsating sphere using an audio reference, so their core intent is retained, but the prompt would be clearer if it described a deliberate visible pulse influenced by the reference rather than guaranteeing frequency-perfect motion. No speech or beat track exists in the fixture.

These findings were sent to the root agent before the next changes. The subsequent adapter changes (fit default, explicit input soundtrack retention, deterministic guide-token descriptions) are not retroactively counted as fixes proven by this run. Complex narrative held-out scenarios, repeated inputs, and edits need their own evidence and independent review.
