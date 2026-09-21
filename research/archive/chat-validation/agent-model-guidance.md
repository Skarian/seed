# Agent and generation-model guidance

Reviewed 2026-09-13. This document distinguishes model documentation, Seed's current implementation, and hypotheses that require testing. A valid request is not evidence that a rendered generation will satisfy the creative request.

## Exact model identities

| Layer | Seed configuration | Scope of the research |
| --- | --- | --- |
| Chat/tool agent | `google/gemma-4-31b-it`, OpenRouter, preferred Parasail with fallback | Gemma 4 function calling and the actual routed provider's supported parameters |
| Text to image | `krea2_turbo_int8_convrot.safetensors`; Qwen3-VL 4B encoder; eight-step graph | Open Krea 2 Turbo, not every feature of the hosted Krea product |
| Video | MiniMax H3 `fl2va` or `ref2va` pruned INT8 weights; Qwen3-VL 32B encoder; turbo or high-quality graph | The H3 base/full-reference guides plus the exact ComfyUI graph Seed builds |

These identities come from `server/chat/provider.ts`, `server/workflows.ts`, and `server/video.ts`. Pin model files and workflow/profile revisions in experiment records. Researching the model family does not prove that a particular quantization or sampler has identical output quality.

## Primary guidance and resulting decisions

**Krea 2:** the official repository recommends natural language and quoted rendered text. Detailed descriptions can help, but simple prompts also work. Seed's existing image guide already follows this; keep it and measure whether unnecessary expansion changes user intent. The official repository separately documents Raw and Turbo, so do not import Raw sampling recommendations into Seed's Turbo graph. [Official prompting guide](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md), [official inference repository](https://github.com/krea-ai/krea-2).

**MiniMax H3:** full-reference uses six fields and separate subject identities; frame-only/text modes use the base format. The old single-image instruction was wrong for mixed references. The concise local guide now chooses by actual input roles. [Official full-reference guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md).

The official base guide distinguishes text-only, opening-frame, opening-and-ending-frame, and ending-frame modes. It describes different alignment instructions for them. Seed currently passes some ending images through `MiniMaxH3AddGuide`, not a numbered reference slot. Do not ask the agent to invent a Picture label for those guides. Improve the graph/compiler separately before promising exact official keyframe-label parity. [Official base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md).

**Gemma 4:** Google documents native function calling with named tools, typed parameters, descriptions, validation before execution, and tool results included in subsequent model context. Its thinking example supports retaining a reasoning-enabled baseline; compare rather than assume that more reasoning always helps Seed's tasks. Google's examples use the Hugging Face chat template. Seed uses an OpenRouter OpenAI-compatible adapter, so preserve that transport's tool-message format rather than copying raw Gemma control tokens into prompts. [Official function-calling guide](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4).

Our design choices are deliberately more specific than those general guides: short instructions, flat tool fields, app-owned asset identities, precise errors, retained retry context, and a compiler A/B test. Their benefits must be demonstrated in Seed's tests.

## Model capabilities versus application rules

- High quality requiring native export, batch bounds, permitted aspect ratios, and clip-duration bounds are Seed validation/profile rules. Do not present them as universal H3 restrictions.
- A source video's soundtrack is usable only when the app supplies it. Its presence in a file alone does not establish agent perception or a generation audio slot.
- Sampled video frames are partial visual evidence. They do not establish what was said or heard. Audio-dependent intent needs actual accessible audio/transcription or clarification.
- `<Subject N>` describes a creative subject, whereas Picture/Video/Audio labels identify supplied input slots. Internal asset IDs and input-instance IDs are different again.
- Historical chat mentions keep their original asset binding. New generation numbering must not reinterpret an old mention.
- Exact generated prompt, input-instance mapping, prepared clip range, effective settings, and provider payload belong in the job record. Keep model-authored text and compiled text separately if tokens are tested.

## Community evidence: hypotheses, not requirements

An H3 discussion reports that explicitly selecting the relevant base/ref guide helps an LLM write prompts; other participants disagree about the quality of the demonstrated output. This supports testing route-specific guidance, not claiming a success rate. [Discussion](https://www.reddit.com/r/StableDiffusion/comments/1vffwq1/the_official_prompt_guide_for_minimax_h3_works/).

Another discussion reports video-preprocessing and soundtrack-wiring pitfalls, including anecdotal synchronization trouble and large-resolution costs. Use it to add preprocessing/audio fixtures and inspect the actual graph. Do not turn these anecdotes into new agent restrictions. [Video-input discussion](https://www.reddit.com/r/StableDiffusion/comments/1vg20lv/some_tips_for_feeding_videos_in_to_minimax_h3/).

No community claim above substitutes for official schema behavior or a reproducible local result. Unaffiliated domains named after H3 were excluded as authoritative documentation.

## Context size and experiment measurements

Google lists 256K context for Gemma 4 31B. OpenRouter currently advertises 262,144 context tokens and up to 16,384 completion tokens. Seed's current adapter reserves a smaller 8,192-token completion limit. Provider routing can change; record the actual provider and limits used, not just the public model name. [Google model card](https://ai.google.dev/gemma/docs/core/model_card_4), [OpenRouter model listing](https://openrouter.ai/google/gemma-4-31b-it).

Do not equate maximum context with reliable attention. Measure the complete outgoing payload, including tool schemas, request snapshots, prior attempts, and visual evidence. Existing character cutoffs are not token measurements.

Record for every live test:

- Effective system prompt/version/hash and schema bytes; text token count using the matching tokenizer when available, otherwise label estimates explicitly.
- Actual provider-reported prompt/completion tokens and cost. Visual input cost must come from the provider or matching processor, not base64 length divided by four.
- Number/resolution of images, sampled video timestamps, text-history length, retained attempt count, and whether a summary was used.
- Time to first tool call, full request preparation time, schema rejection count, semantic errors, and whether clarification was legitimately needed.
- Peak cumulative context during repairs and a reserved completion budget. Never truncate exact references/current request constraints to fit history.

Measure short, ordinary, and near-budget histories with identical user intent. Include compacted history, retry after failed creation, and visual versus settings-only revisions. Compare compact instructions against expanded examples, direct labels against stable tokens, and thinking enabled against disabled. Those are experimental axes, not promises of improvement.

Local guide size at this review (LF-normalized characters / whitespace words, **not tokens**): image 828 / 116; text-video 1,543 / 208; reference-video 3,359 / 498; Standard chat 1,068 / 166. Recompute after changes. Full upstream guides are research references and are not inserted wholesale into each request.

## Editable prompt migration

`chatPromptSnapshot` initializes versioned defaults before reading local instructions. Exact known legacy defaults or a previously recorded installed default can be upgraded; unknown/customized content is preserved. Replaced files are backed up under the config prompting directory's `.seed-backups`. `.seed-defaults.json` records the bundle hashes. Line endings are normalized only for comparison; custom content is not rewritten.

Current application rules remain outside editable creative guidance. Each run snapshots the full effective system, summary instructions, source files, version, and hash. A custom guide can still be creatively unsuitable; preservation does not mean it has been validated. Include custom-override fixtures in the reliability matrix.
