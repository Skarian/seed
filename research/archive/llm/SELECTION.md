# Studio LLM selection notes

9 September 2026. Research shortlist, not a deployment decision or tested ranking.
See ../STUDIO-MVP.md for scope.

**Current decision:** See [STUDIO-MODEL-DECISION.md](MODEL-DECISION.md).
The comprehensive follow-up recommends a 31B LLMfan46 Gemma Heretic director
plus a 12B LLMfan46 Gemma Heretic audiovisual reviewer, with a bounded 12B-only
trial first to honor the single-model preference. Google documents a five-minute
12B video-with-audio example; earlier notes understating joint Gemma capabilities
are superseded. Omni remains a fallback reviewer. Sections below preserve the
historical investigation and should not be treated as the final recommendation.

## Requirements

Self-hostable Heretic/abliterated weights; strong reasoning and reliable tools;
image, video and actual audio understanding across the studio. Long-term:
script and coordinate production of a 20-minute video. Choose for output quality,
latency, and cost per successful task, not parameter count alone.

## Latest clarification: director plus full audiovisual reviewer

User clarified that the second model must jointly review video and its audio,
not merely return audio observations. Keep Gemma 4 31B Heretic as the director.
First reviewer candidate is Huihui-Qwen3-Omni-30B-A3B-Thinking-abliterated (exact
repo and component inspection below). Its base documents temporal audio/video
alignment, music/sound analysis and use_audio_in_video=True. Exact derivative
quality remains untested and has no UGI entry in the inspected snapshot.
Use scene-sized clips and timestamped reports. Do not apply the smaller Gemma's
30-second audio limit to Omni. Both BF16 checkpoints' weights alone exceed 96GB;
evaluate quantization, sequential loading, or on-demand separate reviewer compute.
This supersedes the E4B helper proposal below; deployment remains unimplemented.

## Historical proposal: larger director plus smaller audio helper

User is now considering two Gemma models. Proposed: retain a 31B Heretic director
from the existing shortlist and use llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic
as the audio helper, rather than E2B. The user has not selected the final 31B
variant. The helper reports timestamped observations; the director combines them
with visual review and makes final editing decisions. One visible chat agent.

Official audio documentation covers ASR, translation and speech understanding,
with a 30-second audio limit and mono 16kHz preprocessing. Start with overlapping
20-25 second windows. Do not promise music aesthetics, precise lip synchronization,
stereo mix assessment or synchronized audio/video review without validation.
Use signal measurements for clipping/loudness/silence instead of model guesses.
Two models on one LLM GPU is a possible deployment optimization, not a proven fit;
measure memory with both serving engines, visual inputs and working context.
https://ai.google.dev/gemma/docs/capabilities/audio

## Historical single-model audio investigation

User now wants one modified model for reasoning, images, video and audio. The
31B Gemma candidates below no longer qualify as the sole studio model.

Fresh UGI CSV snapshot: 1,309 rows, sorted numerically by UGI descending, counting
each tested configuration separately. Highest modified entry whose image/video/
audio components I could verify: llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic
with thought prefill, rank 501, UGI 38.54, willingness 10/10, NatInt 16.35.
Coder E4B non-thinking is rank 538, UGI 37.71. E4B is approximately 8B total,
4.5B effective, not a 31B substitute. Both exact repositories have audio_config
and vision_config; direct safetensors headers contain 752 audio-related and
659 vision-related tensors. This verifies packaging, not inference quality.

Larger candidates outside UGI coverage:

- huihui-ai/Huihui-Qwen3-Omni-30B-A3B-Thinking-abliterated, revision
  56794765458a0bede7c8a6245a2f7f9e51675abc. Author explicitly documents
  abliteration of the text component. First candidate to audition for the full
  studio requirement, not a tested winner. 266 monthly HF downloads at inspection.
- Sabomako/Qwen3-Omni-30B-A3B-Thinking-heretic, revision
  71f2b240f2d721456fa0ce7efe50663c034de450. Card reports 7/100 refusals versus
  99/100 and KL 0.003563; author-reported, not independent evaluation.
  172 monthly downloads. Alternative if the first candidate fails evaluation.

Neither exact derivative appears in this UGI snapshot. Base Qwen3-Omni Thinking
scores 33.04; that score cannot be assigned to either derivative. Melinoe Omni
is ranked but its modification method has not been verified as abliteration.
No large, highly UGI-ranked, modified all-modality winner was established.

For BOTH Omni derivatives, config and safetensors index inspection confirms
audio and vision configs, 525 audio-related and 351 visual tensors, and
31,719,205,488 BF16 parameters (63,438,410,976 bytes). The official base supports
joint audio/video using use_audio_in_video=True, plus image input. Thinking
returns text, which is sufficient for the director. Preserved tensors do not
prove that abliteration preserved understanding or reliable tool use.

Official base Transformers/FlashAttention2 BF16 memory table: 15-second video
68.74 GB, 30 seconds 77.79 GB, 60 seconds 95.76 GB, 120 seconds 131.65 GB.
Use short clips for the initial 96GB GPU trial; do not promise a full 20-minute
video in one request. Serving overhead, context and quantization need measurement.

Pi integration: standard Pi messages currently carry text/images. Add a studio
inspect_video(asset_id, start, end, question) tool that sends synchronized video
and audio to the SAME checkpoint's media-capable endpoint and returns findings.
Validate the serving engine and payload before deployment; copied model-card
install commands may be stale. Evaluate audio grounding, timing, tools and script
quality before making a final choice. No pod started or weights downloaded.

Sources:
- https://huggingface.co/spaces/DontPlanToEnd/UGI-Leaderboard
- https://huggingface.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic
- https://huggingface.co/huihui-ai/Huihui-Qwen3-Omni-30B-A3B-Thinking-abliterated
- https://huggingface.co/Sabomako/Qwen3-Omni-30B-A3B-Thinking-heretic
- https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Thinking

## Historical two-candidate comparison (superseded by audio requirement)

User excludes original Gemma from consideration. The current finalists are
coder3101/gemma-4-31B-it-heretic and llmfan46/gemma-4-31B-it-uncensored-heretic.
Both are valid multimodal candidates; earlier asymmetry was verification coverage,
not evidence of missing vision in llmfan46.

Live metadata on 9 September: coder monthly 8,874 / lifetime 53,778; llmfan monthly
56,062 / lifetime 99,320. Inspected the actual SVG download sparklines embedded in
both model pages: llmfan has a roughly five-point sustained high burst in the middle
of the 30-point plot, then falls near baseline; coder has a shorter spike cluster
later in the plot and smaller spikes elsewhere. Exact daily counts/dates are not
exposed by the unlabelled SVG. These shapes do not establish unique-user adoption,
fraud, or the cause of traffic. HF counts GET/HEAD requests to query files, including
config.json; automated loading/metadata requests can count without a full download.

Direct config and weight-index verification for BOTH: Gemma4ForConditionalGeneration,
vision_config, 356 vision-related tensors, identical total parameter/byte counts.
Processor configurations are semantically identical, including image and video
processors; video default num_frames=32. Config difference is recorded Transformers
version only (5.5.0.dev0 vs 5.5.0). Chat templates differ and need serving validation.
This confirms packaged architecture, not output quality or end-to-end readiness.

llmfan author reports MMLU 85.90% vs baseline 86.50% over 7,021 questions. This is
author-reported, not a head-to-head comparison with coder, and not a creative/vision
test. The UGI thinking scores remain 65.69 vs 64.99; both willingness 10/10. Downloads
and this small score gap should not decide the winner alone.

Pi source inspection: UserMessage and ToolResultMessage support TextContent and
ImageContent, with base64 images mapped to image_url in OpenAI-compatible requests.
No standard VideoContent in these message types. Therefore studio uploads store
media independently of LLM context; images are attached explicitly. For video use
an inspect_video(asset_id, start, end, question) tool that samples timestamped frames
and returns images, or calls the same model through vLLM video_url then returns its
analysis. vLLM documents Gemma4 video conversion to text + image frames internally.
UI playback of an MP4 alone does not make it visible to the agent. Keep 31B audio
analysis separate; shared processor audio fields do not prove audio weights exist.

Proposed first acceptance loop: reference image -> animate_image -> generated clip
-> inspect_video -> continuity critique/corrective tool arguments, using the same
assets and settings for each candidate. Pin model and serving revisions. No models
have been loaded or GPU tests performed during this research.

References:
- https://huggingface.co/docs/hub/models-download-stats
- https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic
- https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic/blob/main/processor_config.json
- https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/src/types.ts
- https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/src/api/openai-completions.ts
- https://docs.vllm.ai/en/latest/models/supported_models/

## Initial candidates

### UGI-first revision (9 September 2026)

Downloaded the current UGI CSV (1,309 rows), sorted descending by UGI score with
no size/provider filters. Row ranks include separate thinking variants and API
models. First self-hostable >= approximately 27B vision candidate is:

- Rank 6: coder3101/gemma-4-31B-it-heretic, thought-prefill configuration,
  UGI 65.69, willingness 10/10, writing 40.49, NatInt 36.53; tested by UGI
  12 April 2026. Non-thinking/configuration row scores 56.38 instead.
- Rank 8: llmfan46/gemma-4-31B-it-uncensored-heretic, thought-prefill,
  UGI 64.99, willingness 10/10; tested 16 April 2026.
- Above rank 6: Grok API entries (#1/#3) do not meet self-hosting requirement;
  GLM-4.6-Derestricted-v3 (#2/#5) and XORTRON 123B (#4) are text architectures.

Verified coder3101 config has Gemma4ForConditionalGeneration and vision_config;
weight index includes model.vision_tower and model.embed_vision weights. Published
tensor storage totals 62,546,177,752 bytes (~58.25 GiB), not peak runtime VRAM.
Google's base card documents reasoning, function calling, image input and video
as frames, with a documented maximum 60 seconds at 1 fps. 31B does not include
native audio input. Long videos require segmentation; actual derivative inference
and tool quality remain untested. This candidate now precedes Qwen for testing
under the user's requested UGI-first selection method.

Sources:
- https://huggingface.co/spaces/DontPlanToEnd/UGI-Leaderboard/blob/main/ugi-leaderboard-data.csv
- https://huggingface.co/coder3101/gemma-4-31B-it-heretic
- https://huggingface.co/coder3101/gemma-4-31B-it-heretic/blob/main/model.safetensors.index.json
- https://huggingface.co/google/gemma-4-31B-it

### Earlier Qwen shortlist

- Qwen3.6-35B-A3B Heretic: first candidate for interactive use. Official base has
  vision, reasoning, tools, and documented video_url input. MoE has 35B total,
  3B active parameters; active count does not reduce weights to a 3B footprint.
  Candidate derivative: trohrbaugh/Qwen3.6-35B-A3B-heretic. Its copied base
  benchmark tables are not evidence the modified checkpoint retains those scores.
- Qwen3.6-27B modified variants: dense comparison candidate. Do not assume smaller
  total count means weaker reasoning than the 35B MoE. A specific Youssofal BF16
  Heretic release preserves image/video architecture according to its author, but
  its own 25-prompt refusal table reports zero direct passes. This conflicts with
  a broad reading of its uncensored label; not a selected checkpoint.
- Qwen3.5-122B-A10B Heretic: larger comparison candidate if smaller models fail
  quality checks. 122B weights still need storage/memory despite 10B active.
  At 4 bits the raw parameter arithmetic alone is about 61 GB (decimal), before
  quantization metadata, vision components, context and runtime overhead. A 96 GB
  GPU is a test target, not a guaranteed fit for long-video contexts.

## Serving

Choose after exact checkpoint validation. vLLM is the initial video-serving
candidate because the official Qwen3.6 card documents video_url and frame sampling.
Validate supported quantization, processor, chat template, reasoning parser and
tool parser together. Preserve vision tower/projector. Do not choose an MLX-only
artifact for the NVIDIA pod. Ollama convenience alone should not determine model.

## Proposed evaluation

Run identical prompts/assets against modified candidates and their unmodified
bases as diagnostic controls. No GPU provisioning or paid testing performed yet.

1. Image grounding: identify actual details and discrepancies in reference/result
   pairs; score hallucination, identity/wardrobe/camera continuity judgments.
2. Video grounding: short clips with known temporal changes; require timestamps
   and evidence. Sampled video frames do not establish audio understanding; use
   a transcript/audio analysis tool if needed.
3. Writing: 20-minute outline, character/style constraints, then two developed
   scenes. Human review for pacing, voice, repetition and coherence.
4. Tools: 20+ requests using our four schemas, including revisions and errors.
   Check valid calls, correct assets/settings and no invented completed outputs.
5. Revision: change a character/detail halfway through; update affected shot plans
   while retaining other decisions. Test budget and duration arithmetic.
6. Measure first-response latency, completion latency, peak VRAM, context growth,
   and cost per accepted result. Re-test final quantization and thinking mode.

Long-form architecture later: persistent brief, script, shot list, continuity
notes and asset IDs; retrieve relevant sections per scene and review the whole
outline periodically. Do not promise 20 minutes of autonomous quality from one
giant conversation. At 5-15 seconds per generated clip, 20 minutes is roughly
80-240 shots before retakes if all footage is generated that way.

## Sources

### Leaderboards for narrowing candidates

- UGI: https://huggingface.co/spaces/DontPlanToEnd/UGI-Leaderboard
  Community evaluation includes modified checkpoints and willingness/refusal
  behavior. Not a vision/video or reliable-agent certification.
- OpenVLM: https://huggingface.co/spaces/opencompass/open_vlm_leaderboard
  Image understanding and multimodal benchmark comparisons.
- OpenVLM Video: https://huggingface.co/spaces/opencompass/openvlm_video_leaderboard
  Video-MME, MVBench, MMBench-Video, TempCompass, MLVU; compare frame counts,
  subtitle conditions and benchmark update dates.
- BFCL: https://gorilla.cs.berkeley.edu/leaderboard.html
  Function/tool calling; prefer current official results over older HF mirror.
- EQ-Bench writing: https://eqbench.com/creative_writing.html
  LLM-judged creative writing; useful for shortlist and sample reading, not proof
  of 20-minute narrative coherence or personal taste.

Hugging Face hosts many community leaderboards; hosting is not an HF endorsement.
Use the exact checkpoint/quantization/thinking setting when available. Separate
base-model results from modified-variant evidence. Missing coverage is unknown,
not a failing score. Shortlist 2-3 from these sources, then run a small studio test.

- https://huggingface.co/Qwen/Qwen3.6-35B-A3B
- https://huggingface.co/Qwen/Qwen3.6-27B
- https://huggingface.co/trohrbaugh/Qwen3.6-35B-A3B-heretic
- https://huggingface.co/Youssofal/Qwen3.6-27B-Abliterated-Heretic-Uncensored-BF16
- https://huggingface.co/Qwen/Qwen3.5-27B (base comparison tables)
- https://huggingface.co/coder3101/Qwen3.5-122B-A10B-heretic
- https://github.com/p-e-w/heretic
