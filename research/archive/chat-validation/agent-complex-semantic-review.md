# Independent semantic review: complex stable-token v3

Reviewer: `tool_plan` sub-agent. Evidence directory: `.local/agent-eval-complex-v3-stable`. All **12 cases and all 15 create/edit phases** were independently read, including exact user messages, saved compiled prompts, reference identities, settings, tool results, and final replies. Rubrics were authored before these outcomes in `scripts/agent-eval-heldout.mjs`; this review does not change the cases or their expected settings to fit the results.

## Results need three separate measures

- **Tool/settings correctness: 12/12 cases, first attempt.** All three requested edit operations also succeeded without rejected calls.
- **Core scene and action composition: 11/12 cases retained the central requested intent.** Case07 weakens "sitting" into "floats or sits". Most dialogue, timing, actor/object ownership and reference mapping are otherwise strong.
- **Complete explicit constraint retention: 1/12 cases passes.** Case02 passes. Cases01 and03–12 omit at least one explicit exclusion or other requirement from the text actually sent for generation.
- **Narrow edit correctness: 3/3.** Speaker reassignment, removing one audio channel, and reordering references plus changing dialogue were handled correctly. These edits preserve any deficiencies already present in their initial prompts; they do not repair omitted original exclusions.
- **False generated-output claims: 0/15 phase replies.** Replies say ready for review or updated, not that media was generated.

The last metric is deliberately strict: when a user explicitly says "no subtitles," that instruction must reach the generator. It is not enough that the agent did not positively ask for subtitles. The generator receives the compiled prompt, not all the original chat instructions. Some positive wording can preserve an exclusion by meaning ("remains completely still" preserves "do not move"), but unrelated silence about a restriction does not preserve it. This review does not claim omitted restrictions necessarily cause bad rendered media; no GPU output was generated.

## Per-case evidence

Case paths below use `heldout-<number>-<name>-r1/result.json` and sibling snapshots in the evidence directory.

### 01 — Library reflection: fail complete retention

Preserved: Mira seated left, Joel standing right, navy/grey clothing, glasses, Mira's left-wrist copper bracelet, folded red map with Mira, Joel's empty hands, reflected room without another person, warm left light/cool shelves, elevated medium-wide framing, sharp faces, curious mood. Exact saved note, portrait aspect and batch2 are correct.

Lost: the prompt does not carry the explicit prohibitions on subtitles, logo, blood, an extra map, or a second bracelet. Its single bracelet/map descriptions preserve their main ownership but do not retain the explicit exclusion list. Evidence: prompt ends at "capturing a mood of curiosity" without the user's final restrictions. The first five scene/rubric groups pass; the explicit-negative-constraints group fails.

### 02 — Product materials: pass

The compiled prompt retains the left cream speaker, exactly two vertically stacked right brass knobs, one back cable leaving frame right, exact uppercase "KEEP LISTENING," no other writing on card/radio, walnut/olive/cream/brass materials, matte broad reflections, low front-left camera, right-side late light, entire radio focus, and exclusions for hands/plants/headphones/branding/floating parts. The user's no-other-writing intent is represented alongside a dark empty background and the only two text-bearing objects. No consequential extra content is introduced. Seed876/batch3 are correct.

### 03 — Station dialogue: fail complete retention

Preserved: both clothing/positions, red umbrella with Mira, empty hands with Joel, Mira's exact question at3 seconds, Joel's exact reply after cut at6, his left-pocket action, embarrassed reaction8–10, Mira's off-screen laugh, rain/station ambience, no music. The pocket is described as empty, so the requested absence of a visible letter is represented.

Lost: no-subtitles, no-slow-motion, no-dramatic-zoom, and ambience **below dialogue** are not carried through. The prompt says only "The sound of light rain and a distant station hum" without its requested relative level. "Off-screen voiceover" for Mira's laugh is loose terminology but not counted as a new narrator. Speaker/timing rubric passes; full sound/negative/camera constraint retention fails.

### 04 — Silent frame sequence: fail complete retention

Preserved: actual image-frame export, silent output, red boat/lower-left start/pale-blue sea, precise0–2/2–4/4–6 stages, passage behind stationary white arch, emerging right and stopping before edge, fixed overhead camera, paper texture, and no change to boat shape/color. The stable camera and continuous shot preserve the no-other-view intent; preserved boat shape covers the no-animal transformation.

Lost: the explicit no-text and no-extra-boats instructions are absent. These are not fulfilled merely by describing one boat in the primary action. Core animation and export rubrics pass; complete exclusion retention fails.

### 05 — Museum prop ownership: fail complete retention

Preserved: yellow Picture1 as Mira's orb, blue Picture2 as wall sign, both general references, characters' clothing and sides, orb in both hands, Joel's exact first line, Mira's exact second line while looking down at orb, final gaze toward stairway, no transfer/movement at the end, fixed sign, medium-wide camera followed by one push-in, quiet room tone and no music. The sign is explicitly fixed throughout, preserving the no-second-orb identity requirement.

Lost: no-subtitles and no-other-people are not explicitly maintained. Describing the two principals and an empty gallery atmosphere does not preserve the user's explicit cast restriction. Core identity, dialogue, timing, and camera groups pass; full exclusions fail.

### 06 — Motion reference, not scene: fail complete retention

Preserved: exact image/video mapping, video source1–4/audiooff, yellow orb and material/color, left-right roll/pause/resume timeline, hand only entering during pause and pulling away without contact, low rightward tracking camera, fixed red toolbox, single warm lamp, quiet rolling/room ambience and no music. It explicitly ignores the source video's visual elements; it does not claim an actual repair shop exists in the test-pattern input.

Lost: no-subtitles and no-duplicate-orb are not retained as explicit constraints. The requested source-motion versus target-scene separation works; complete negative retention fails. Camera tracking while the orb exits could be clearer but is not treated as impossible or an additional hard failure.

### 07 — Two audio channels: fail core and complete retention

Preserved: video440Hz soundtrack is selected as Audio1, separate660Hz alert as Audio2, image identity, required clips, high/native10s, background/foreground audio ownership, alert and panel flash at4, orb stops pulsing, dolly-back from5, steady background hum, no music and no visible test pattern.

Changed or weakened: the user says the orb is **sitting**; the prompt says "floats or sits stationary." This introduces an unrequested alternative. It also adds "a few faint, distant indicator lights" despite the user restricting other bright objects; the degree of brightness is ambiguous and should not be guessed. No-subtitles/no-spoken-words are omitted. Audio routing works, but ambiguity and exclusions fail semantic review.

### 08 — Bookend transformation: fail complete retention

Preserved: exact opening/closing roles and fit framing, one described transforming object, recognizable sphere0–2, flatten/fold2–6, settle triangle6–8, gradual yellow-blue and green-pale changes, centered static camera, silent output, valid Picture1/opening and ending-guide prose. There is no invented closing Picture label.

Lost: the explicit bans on shattering, particles, added shapes, text, and people are not carried into the compiled prompt. Smooth folding supports the intended principal transformation, but does not preserve all the forbidden decorative additions. Core guide/timeline/color behavior passes; complete constraints fail.

### 09 — Opening guide plus motion: fail complete retention

Preserved: actual opening guide, video2–5/audiooff, no illegal general-image conversion, plain compiled opening-guide phrase, hold0–2/clockwise arc2–5/lower-right settle5–7, locked camera, moving spotlight, yellow material, silent output. This case correctly uses all six full-reference sections, unlike some simpler pilot examples.

Lost: the explicit bans on showing the test pattern, adding text, or another sphere are not retained. The source test pattern contains varied geometric motion; calling its motion "smooth, curving" is an interpretation, not evidence that the source exactly depicts the requested arc. Requested target arc is nevertheless preserved. Core movement/role rubric passes; full exclusions fail.

### 10 — Speaker-only edit: edit passes; complete request fails

Initial request retains orb/sign identities, Mira-left/Joel-right, wardrobe/glasses, orb in Mira's hands, fixed medium two-shot, warm light, exact initial dialogue and timing, awkward stillness8–10, room tone, no music, seed99/batch2/note.

The edit correctly changes only the speakers: Mira asks "Is it safe?" at3 and Joel answers "Only if we leave it alone." at6. Positions, clothing, props, dialogue wording, camera, timing, references, settings, and note remain unchanged. This is strong narrow-edit behavior, not a new card.

Initial no-subtitles restriction was omitted and remains absent after editing. Full original-request compliance therefore fails even though every edit-specific semantic criterion passes.

### 11 — Remove separate audio: edit passes; complete request fails

Initial audio mapping, reference clips, yellow sphere, pulse0–4/panel4/still5–10, fixed camera, low soundtrack and alert roles are correct. The edit removes only the separate audio input and Audio2 prompt mentions, keeps the flashing panel, retains video soundtrack as Audio1, keeps output audio enabled and all settings, and deletes the audible alert sentence. The final assistant accurately explains the panel now flashes silently while background hum remains.

Initial no-subtitles and no-visible-test-pattern restrictions were omitted from the generation prompt and remain omitted. There is no positive instruction to show the test pattern, but the explicit exclusion was not passed through. Full request fails; edit-specific criteria pass.

### 12 — History reorder and dialogue edit: edit passes; complete request fails

Initial request preserves the actors, clothing/glasses, Mira carrying yellow orb with both hands left-to-right0–5, Joel under blue sign, stopping two steps away at5, exact first line, Joel looking down silently8–11, side-tracking camera that stops with Mira, and cool overhead light.

After long history, the edit reverses the input array while preserving input instance IDs. Yellow orb becomes Picture2 and blue sign becomes Picture1 throughout the compiled prompt. Mira's replacement line is exactly "You could have warned me." The original line is removed; ownership, camera, timing, sound and settings are otherwise unchanged. All edit-specific criteria pass.

Initial prompt adds "The hollow ambience of a museum hallway" despite the user's **only footsteps and her dialogue**, and omits no-subtitles/no-touch-or-handoff. Those deficits survive the otherwise-correct edit. Full request fails.

## Recommended next instruction changes

Keep the language short and explicit:

> Keep every user requirement in the generation prompt: exact dialogue, who speaks, object ownership, numbers, timing, camera, sound, and every "no ..." restriction. Do not summarize restrictions away. Do not add alternatives such as "floats or sits" when the user chose one. Before saving, compare the prompt against the user's instructions once.

For route choice:

> If any input is a general reference, including any video or audio, use the six full-reference sections. An opening-frame image does not change this. Use the base sections only when there are no general references.

For silent output:

> If final output is silent, write N/A or silence in overall_soundscape. Keep requested input audio references in the input list and explain their conditioning role elsewhere; do not remove them.

These are instruction proposals, not patches made by this reviewer. Do not introduce a hard reject based only on counting section headings without proving that exact formatting is a strict provider requirement. A structured evaluation can report guide compliance separately from invalid tool calls and lost user meaning.

This run was frozen before review. Once its failures are used to improve prompts, it becomes regression evidence for that next version; a fresh unseen set is needed for a new held-out reliability claim. Reusing these cases is useful, but should be labeled honestly.
