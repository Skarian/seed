# Independent semantic review: matrix v3

Evidence: `.local/agent-eval-matrix-v3-stable`. Reviewer: `tool_plan`. This report tracks **48** focused scenarios: 18 settings edits, 18 prompt revisions, and 12 label/input changes. Other matrix categories are outside this report. This run uses the frozen v3 build; subsequent v4 prompt rules do not apply to its results.

**Reviewed: 48/48.** All focused case results have been individually examined. There are 47 narrow-edit semantic passes and one uncertain bookend close-up case. All 48 pass the automatic settings checks. Whole-trial tool success without retries is 43/48; excluding the semantic uncertainty gives 42/48 strict whole-trial first-attempt passes.

Scope: compare the requested change with the actual before/after request, preserving prompt text where required, unchanged settings, and input-instance meaning. A correct narrow edit does not prove that the initial prompt captured every original user restriction. Initial complete-scene semantic quality is not rescored by these edit-preservation rows.

Whole-trial first-attempt status includes both create and edit: each first saved request must equal its phase final request, both first tool calls must succeed without tool errors, and the reviewed edit must be correct. The original harness field for edit cases considered only the edit phase; do not use it as a whole-trial first-attempt rate.

| Case | Review | Whole-trial first attempt | Evidence |
|---|---|---|---|
| settings-image-seed | pass | pass | Only seed42->876; prompt and inputs byte-for-byte preserved. |
| settings-image-count | pass | pass | Only batch1->3; prompt and inputs byte-for-byte preserved. |
| settings-image-aspect | pass | pass | Only aspect16:9->9:16; all other output fields, prompt and inputs preserved. |
| settings-image-random | pass | pass | Only seed42->random; prompt and inputs byte-for-byte preserved. |
| settings-image-combined | pass | pass | Only seed42->99 and batch1->2; prompt and inputs preserved. |
| settings-image-portrait-count | pass | pass | Only aspect9:16 and batch2; prompt and inputs preserved. |
| settings-video-seed | pass | pass | Only seed42->876; prompt and inputs byte-for-byte preserved. |
| settings-video-count | pass | pass | Only batch1->3; prompt and inputs byte-for-byte preserved. |
| settings-video-aspect | pass | pass | Only aspect16:9->9:16; all other output fields, prompt and inputs preserved. |
| settings-video-random | pass | pass | Only seed42->random; prompt and inputs byte-for-byte preserved. |
| settings-video-combined | pass | pass | Only seed42->99 and batch1->2; prompt and inputs preserved. |
| settings-video-portrait-count | pass | pass | Only aspect9:16 and batch2; prompt and inputs preserved. |
| settings-mixed-seed | pass | pass | Only seed42->876; prompt and inputs byte-for-byte preserved. |
| settings-mixed-count | pass | pass | Only batch1->3; prompt and inputs byte-for-byte preserved. |
| settings-mixed-aspect | pass | pass | Only aspect16:9->9:16; all other output fields, prompt and inputs preserved. |
| settings-mixed-random | pass | pass | Only seed42->random; prompt and inputs byte-for-byte preserved. |
| settings-mixed-combined | pass | pass | Only seed42->99 and batch1->2; prompt and inputs preserved. |
| settings-mixed-portrait-count | pass | pass | Only aspect9:16 and batch2; prompt and inputs preserved. |
| revisions-image-warm | pass | pass | Warm golden lighting added; yellow sphere still rests centrally on green stage, composition/settings unchanged. |
| revisions-image-close | pass | pass | Close-up replaces the distant framing while sphere, green stage and lighting remain. |
| revisions-image-blue | pass | pass | Blue rim light added; yellow material and green stage preserved. |
| revisions-image-slow | pass | pass | Requested slow/deliberate motion changes resting sphere to rolling; consistent with latest motion request, but trajectory was not specified by user. No settings changed. |
| revisions-image-background | pass | pass | Distant blurred trees added; replaces neutral background as requested, otherwise sphere/stage/light unchanged. |
| revisions-image-remove-detail | pass | pass | Clear air explicitly added; original contained no fog/haze. Other prose/settings unchanged. |
| revisions-bookends-warm | pass | pass | Warm golden lighting added; yellow-to-blue sphere-to-triangle transformation and guide identities preserved. |
| revisions-bookends-close | uncertain | accepted; semantic uncertain | Camera zoom added as requested, but explicit final ending-guide composition is replaced with a close-up triangle while same last_frame input stays. Endpoint/framing conflict needs clarification or actual generation evidence. |
| revisions-bookends-blue | pass | pass | Requested blue rim light added throughout; base yellow-to-blue transformation, backgrounds, guides and settings unchanged. |
| revisions-bookends-slow | pass | pass | Only transformation wording changes to slow/deliberate; same five seconds, guide identities, colors and background transition. |
| revisions-bookends-background | pass | pass | Distant tree silhouettes added then fade with background; sphere/triangle transformation and endpoint guides retained. |
| revisions-bookends-remove-detail | pass | pass | Clear air explicitly added; no original fog/haze to remove. Other narrative/input/settings preserved. |
| revisions-mixed-warm | pass | pass | Warm lighting replaces flat lighting, same color/shape, motion/audio references and static camera. |
| revisions-mixed-close | pass | fail: initial retry | Closer camera framing replaces static-camera sentence; scene/motion/inputs/settings preserved. Initial create used raw asset ids and was rejected once. |
| revisions-mixed-blue | pass | fail: initial retry | Blue rim lighting added; yellow material, background and motion retained. Initial create used raw asset ids and was rejected once. |
| revisions-mixed-slow | pass | pass | Only movement gains slow/deliberate qualifier; same source motion trajectory, colors, audio input roles and settings. |
| revisions-mixed-background | pass | pass | Distant trees added; sphere, motion, lighting, camera, audio and settings retained. |
| revisions-mixed-remove-detail | pass | pass | Clear air added; remaining prompt and all settings/inputs retained. |
| labels-reorder-images-sfw | pass | pass | Input order reversed with stable IDs; all Picture labels correctly remapped while sphere and triangle roles remain unchanged. |
| labels-remove-scene-sfw | pass | pass | Triangle input and its mentions removed; sphere motion and settings retained. |
| labels-disable-soundtrack-sfw | pass | fail: edit retry | Video audio disabled; standalone tone correctly becomes Audio1. One edit retry because canonical nested range was submitted to flat schema. |
| labels-remove-standalone-audio-sfw | pass | pass | Standalone tone removed; soundtrack Audio1 retained, no obsolete Audio2 mentions. Visual prompt and settings unchanged. |
| labels-first-frame-plus-motion-sfw | pass | pass | Prompt alone changed; opening guide stays unnumbered and Video1 retains motion ownership. Added diagonal motion is plausible but generation fidelity untested. |
| labels-closing-only-sfw | pass | pass | Opening guide removed; ending guide preserved without numbered label. Original yellow-to-blue transformation and settings preserved. |
| labels-reorder-images-nsfw | pass | pass | Input order reversed; every Picture mapping changes correctly, preserving yellow mover, blue destination, background ownership and all scene details. |
| labels-remove-scene-nsfw | pass | pass | Triangle input and prose removed; sphere identity, forward motion, tracking camera and settings retained. |
| labels-disable-soundtrack-nsfw | pass | fail: retry | Video audio disabled, separate tone correctly Audio1; visual prompt/settings intact. Create used id instead of asset; edit copied nested range, both recovered. |
| labels-remove-standalone-audio-nsfw | pass | fail: retry | Separate tone removed and obsolete Audio2 mentions eliminated. Video soundtrack, visuals and settings preserved. Nested range caused one edit retry. |
| labels-first-frame-plus-motion-nsfw | pass | pass | Only prompt revised; opening guide unnumbered, Video1 motion ownership, sphere appearance and static camera retained. |
| labels-closing-only-nsfw | pass | pass | Opening guide removed; ending triangle unnumbered and settings retained. Departure becomes abstract rather than yellow sphere; removal instruction allows interpretation but scene-preservation scope is ambiguous. |

The image slow-motion case starts from a resting still-image subject. Its follow-up explicitly asks for motion, so portraying a slow roll is a reasonable interpretation, but this case cannot establish preservation of the original resting action. It should not be scored as a model failure solely for introducing motion requested by the follow-up.

Initial-creation retries observed in `revisions-mixed-blue` and `revisions-mixed-close`: the model selected the correct three source asset IDs, roles and clips, but used those IDs in the tool field requiring short handles. It recovered after the identifier error. The edit itself was first-attempt correct; the whole trial was not.

All 48 reviewed cases also had their final create/edit assistant messages inspected (96 messages). All correctly describe requests ready for review; none claims the asset was generated.

The soundtrack-disable SFW edit initially copied nested `range` from canonical request storage into the flat tool input. The schema rejected it as additional properties; the corrected attempt retained the requested clips and disabled only video audio. This is an avoidable mismatch between visible request context and accepted edit arguments.

Two further retries occur in NSFW soundtrack-disable (create used existing-input `id` for new assets; edit copied nested `range`) and standalone-audio removal (nested `range` edit). Thus five cases required recovery, across six failed phases. Correct final labels did not require subject guessing or changing the selected media.

Closing-only NSFW removes the initial sphere description along with its guide, using an abstract departure shape. The instruction asks to remove the opening frame and preserve settings, so this is acceptable within that narrow test. If preserving the narrative starting subject is required, the scenario must state that explicitly; SFW happened to retain it.
