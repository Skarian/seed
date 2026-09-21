# Agent semantic review protocol

The held-out suite is `scripts/agent-eval-heldout.mjs`. It contains twelve realistic, constraint-heavy prompts and three follow-up edits. Each case includes a semantic rubric. These cases complement the settings/tool matrix; they do not replace it.

## What a pass means

A saved request alone is not a pass. Report these separately:

1. **Tool correctness:** correct workflow, selected inputs and roles, clip ranges, settings, seed, batch size, note, revision target, and no unwanted generation.
2. **First-attempt correctness:** the first mutating call succeeds and the resulting request is correct. Legitimate preparatory inspection calls are not failures. Report total calls separately.
3. **Semantic correctness:** the saved, compiled generation prompt preserves the user's intended people, objects, ownership, dialogue, timing, camera, exclusions, and sound. A valid prompt-label number can still refer to the wrong person or object.
4. **Recovery:** if a call failed, did the error identify the problem and did the next attempt fix it without changing unrelated requirements?

No generated GPU media is produced in this evaluation. Semantic correctness refers to what the agent asks the generator to do, not a promise that a video model will obey every detail.

## Case coverage

| Case | Primary semantic risk |
|---|---|
| Library reflection | Ownership, left/right, reflection identity, negatives, saved note |
| Product materials | Exact counts and text, spatial layout, material versus lighting |
| Station dialogue | Speaker attribution, exact dialogue, camera cuts, timed actions |
| Silent frame sequence | Export format, silent output, occlusion, continuous object identity |
| Museum prop ownership | Two image mappings, two speakers, prop stays with its owner |
| Motion source not scene | Copy motion without hallucinating fixture scene content |
| Two audio channels | Video soundtrack versus separate audio, correct sound role and label |
| Bookend transformation | Opening/closing roles, guide-label exception, controlled transformation |
| Opening guide plus motion | Mixed guide/reference route, clip boundary, no fake Picture label |
| Edit speaker only | Change speaker without swapping identity/props/settings |
| Edit audio removal | Remove one audio input while retaining the video soundtrack |
| History reorder identity | Long-history recovery, simultaneous input order and dialogue edits |

Fixtures are deliberately unambiguous: a yellow sphere image, a blue triangle image, a six-second moving test pattern with a 440 Hz soundtrack, and a separate six-second 660 Hz tone. Human characters and narrative locations are creative instructions, not claims about the contents of those fixtures. Prompts explicitly distinguish source motion from generated scene appearance where needed.

## Review procedure

Freeze the suite before examining live outcomes. Record its SHA-256, agent prompt/tool versions, model and provider, reference mode, and repetition. Do not rewrite a failed test to match a model's answer. If test wording genuinely proves contradictory, record the reason, mark that trial invalid, and create a new version with a fresh held-out run.

The independent reviewer reads the original user prompt, initial request and input mapping, every tool call/result, final compiled request, and final reply. For edit cases, compare both before and after; a fluent replacement can conceal lost requirements. Use the stored run's actual mappings, never current global asset numbering.

For each semantic rubric item, record **pass**, **fail**, or **uncertain**, along with a short quotation from the compiled prompt or the missing/contradictory detail. Uncertain is not a pass. Evaluate the final edit against both the original unchanged requirements and `finalSemanticRubric`.

Hard failures include:

- Wrong speaker, object owner, source image, source audio, clip, role, or request target.
- Missing or changed requested exact dialogue/text.
- A core event ordered incorrectly, omitted, or assigned to the wrong time window.
- An explicit exclusion contradicted by newly added content.
- A supposedly narrow edit that drops or changes unrelated settings or major story requirements.
- A claim of successful preparation after rejection, or a request presented as already generated.

Harmless paraphrases may pass when meaning is unchanged. Decorative creative additions may pass only when they do not contradict a constraint or introduce a new consequential action. Do not reward more words, ornate language, or unsupported certainty.

For each failed or uncertain trial, classify the primary cause as instruction, tool schema, input context, reference resolver, model reasoning, truncation, provider/transport, or test ambiguity. Distinguish where the failure occurred from who fixes it. An app-side remapping bug must not be reported as a model failure.

Review every first repetition independently. Review every failed/uncertain trial and all edit trials across repetitions. The second reviewer adjudicates failures, disagreements, and a sample of passes; include the sample size in the report. Never describe unchecked repetitions as manually reviewed.

## Review record

Write a separate record per trial, without changing evidence:

```json
{
  "trial_id": "heldout-03-station-dialogue-r1",
  "reviewer": "independent reviewer identifier",
  "evidence": ["snapshot-create.json", "results.json"],
  "tool_correct": true,
  "first_mutation_correct": true,
  "semantic_verdict": "pass | fail | uncertain",
  "items": [{"criterion": "exact speaker ownership", "verdict": "pass", "evidence": "short exact quote or field path"}],
  "primary_cause": null,
  "notes": ""
}
```

Aggregate correctness only after adding semantic verdicts. Keep deterministic pass rates separate from reviewed semantic pass rates, with denominators and unresolved cases. Small samples establish evidence for tested situations, not reliability for every possible combination.

## Repeated assets: supported contract, remaining evaluation

The adapter now accepts an optional `instance` name on a new input. For example, two inputs can select the same source handle but use `instance: "clipA"` and `instance: "clipB"` with different clip ranges. Existing inputs are edited by `id`; combining `id` with a new `instance` is rejected. Ordinary single-source use needs no instance field.

The shared label resolver keys by input instance. Stable prompt tokens use `[[clipA]]`, `[[clipB]]`, and, when enabled, `[[clipA:audio]]`. Frame-guide tokens compile deterministically to an actual provider label where available, or to the plain phrases "the opening-frame guide" and "the ending-frame guide" when no numbered slot exists. This does not rewrite the surrounding prose. Approval still needs to expose the exact compiled prompt.

Unit tests cover repeated clips and independent soundtrack mapping. Real-model trials must still verify the same video at two ranges; the same image as opening guide and general reference; two instances with soundtrack on/off; removing/reordering one instance while retaining the other; and simultaneous prompt/instance edits. Until those runs and semantic reviews pass, report repeated-instance reliability as unverified rather than unsupported.
