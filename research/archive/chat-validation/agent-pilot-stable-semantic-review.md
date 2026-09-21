# Independent semantic review: stable-token pilot v3

Reviewer: `tool_plan` sub-agent. Evidence: `.local/agent-eval-pilot-v3-stable`. All **18/18 completed trials** were independently read: exact user request, actual saved compiled prompt, inputs/settings, tool-error records, and final assistant message from the sibling `snapshot-create.json`. This is a development pilot, not the complex held-out suite.

Fixture SHA-256 hashes match the direct v2 pilot for all four assets. That review included visual inspection of both images and a six-frame contact sheet of the actual motion video. Audio properties were checked against the fixture definition/metadata; this review does not claim listening-based validation or generation-quality evaluation.

## Results

- Exact settings/reference checks: **18/18 passed**.
- First mutating call correctness under those checks: **18/18 passed**; no rejected tool calls.
- Final user-intent and prompt-consistency review: **16/18 passed, 2/18 failed**.
- False claims of completed generation: **0/18**; all final answers correctly say the request is ready for review.
- Additional model-instruction format issues: **3/18**, described below and not hidden inside the settings pass rate.

The remaining semantic failures are both mixed-audio cases. Input selection is now correct, including the extracted video soundtrack, but the prompt describes an audible final soundscape even though the user asked for silent output. Export is still correctly silent. The same strict prompt/settings consistency criterion was used in the v2 review.

## Per-case findings

Each entry points to `fresh-create-<lane>-<mode>-r1/result.json` and `snapshot-create.json` under this pilot directory.

| Lane / mode | Semantic verdict | Evidence |
|---|---|---|
| image / sfw | Pass | Exact simple instruction retained: "A yellow sphere resting on a green stage." Correct seed42/batch1/landscape/1mp. |
| image / nsfw | Pass | Yellow sphere rests on green stage, matching requested subject/color/action. Added soft lighting is compatible; no unrelated sexual content. |
| video / sfw | Pass | Yellow sphere rolls left-to-right across green; soundscape and music N/A agree with silent export. |
| video / nsfw | Pass | Same correct roll/color/stage; camera pan compatible with unconstrained camera. Silent soundscape and output agree. |
| opening / sfw | Pass | Correct image/first_frame and compiled <Picture 1>; "rolls gently ... to the right," consistent yellow/dark-green reference. Default fit preserved. |
| opening / nsfw | Pass | Same correct identity and gentle rightward motion. Prompt lacks integrated_multimodal_description heading; separate format issue. |
| bookends / sfw | Pass | Yellow opening morphs smoothly to blue triangle and pale background. Ending token compiles to "the ending-frame guide," no invented Picture2. |
| bookends / nsfw | Pass | Same role/color/shape transformation. Closing guide described in plain text, correct first-image Picture1, no retry. |
| two-images / sfw | Pass | Subject1 is yellow Picture1; Subject2 is blue Picture2. Yellow approaches blue then stops with a gap. Creative camera cuts do not contradict user's unconstrained camera. |
| two-images / nsfw | Pass | Correct source/color ownership; sphere recedes toward triangle destination. Background transition compatible with supplied images. |
| motion / sfw | Pass | Source1–4/no soundtrack. Prompt borrows motion only, discards visual pattern. Gray sphere is permitted: this user message did not request yellow. |
| motion / nsfw | Pass | Same source/range/motion-only separation. Chrome material is an unconstrained creative addition, not a swap with another case's yellow image. |
| sound / sfw | Pass | Correct standalone Audio1/range, pulsating sphere, silent output and N/A soundscape. Frequency-perfect visible synchronization remains unnecessarily strong wording. |
| sound / nsfw | Pass | Same audio identity and pulsation, silent export/N/A soundscape. No visual source invented. Same synchronization quality concern. |
| opening-motion / sfw | Pass | Correct opening image plus video1–4/no soundtrack. Guide compiles to plain "the opening-frame guide"; yellow/green preserved. Required full-reference section format not followed. |
| opening-motion / nsfw | Pass | Same correct identities, guide description, yellow/green and motion transfer. Required full-reference section format not followed. |
| mixed / sfw | **Fail** | Inputs now correctly include video soundtrack plus standalone tone, mapped Audio1/Audio2. But overall_soundscape asks for "A harmonic combination of two synthetic sine waves ... creating ... soundscape" despite silent output. It also invents a "pulsing tempo" for steady input tones. |
| mixed / nsfw | **Fail** | Correct Audio1=video440Hz and Audio2=standalone660Hz, but overall_soundscape asks for "A composition of synthetic tones, blending ..." while output is silent. Conditioning inputs can remain selected without describing an audible final mix. |

## What improved, and what remains

The main adapter changes have useful evidence: frame guides no longer cause invalid numbered labels, all 18 preserve expected fit/default framing, both mixed cases retain their requested video soundtrack, and all 18 have correct first-call settings/reference selection. These are observed outcomes for this one repetition, not a broad reliability guarantee.

Both mixed cases still need prompt-level separation between audio used as input conditioning and final audible sound. The saved prompt should state silence in overall_soundscape while retaining input audio references in the appropriate conditioning/retention description. An input soundtrack must not be dropped to achieve that.

Three format defects remain outside user-intent scoring:

- `opening-nsfw`: missing the required integrated_multimodal_description section heading.
- `opening-motion-sfw`: missing that heading and uses the base-style structure instead of the six-section full-reference guide.
- `opening-motion-nsfw`: uses three base sections despite a general video reference requiring the full-reference guide.

No actual MiniMax inference was run, so the effect of these formatting defects on output is not measured. They should be tested or corrected, rather than treating tool acceptance as proof the provider-specific guidance was followed.

The source-tone cases retain the user's broad intent but overstate exact frequency synchronization. The fixtures are steady sine tones, not a beat track or speech. This remains a quality observation, consistently scored the same way as direct v2.

The root agent received these findings before this report. A later prompt adjustment or compiler change must be evaluated in a fresh run; it cannot retroactively convert these 2 semantic failures into passes. Full workflow/revision matrix, repeated-instance tests, and complex held-out review remain separate.
