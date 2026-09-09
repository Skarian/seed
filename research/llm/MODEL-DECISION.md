# Studio model decision

## Recommendation

Use **LLMfan46 Gemma 4 31B Heretic as the studio director** and **LLMfan46 Gemma 4 12B Heretic as the audiovisual reviewer**. Initially target both on the existing class of 96 GB LLM GPU, with the director at Q8 and the reviewer at BF16. Keep ComfyUI on the separate media service already planned. This is a deployment recommendation based on public evidence and checkpoint inspection, not a claim that the models have passed a studio evaluation.

Before retaining two models, give the 12B checkpoint one bounded opportunity to do both jobs. It has the right input capabilities and a credible ecosystem. If it passes the writing, tool-use and audiovisual tests below, use it alone. Otherwise retain the 31B director without changing the UI. This makes the preference for one model an explicit acceptance criterion rather than an indefinite search.

Do not choose a modified Qwen3-Omni as the sole studio model on the available evidence. Qwen3-Omni is a real audiovisual reasoning architecture; it is not disqualified by text-only abliteration. The reasons for placing it behind Gemma are the sparse adoption of its exact modified checkpoints and weaker available creative-writing evidence. Keep it as the alternate reviewer if Gemma 12B fails sound/music or cross-modal grounding tests.

## The two jobs

The director needs to maintain a brief, write and revise scripts, preserve continuity, select assets, choose generation settings, invoke tools and recover from failed jobs. For eventual long productions, dependable instruction following and sustained writing matter more than simply accepting many input types.

The reviewer needs to receive the actual soundtrack together with the corresponding visual sequence. A transcript plus unrelated frame descriptions is insufficient for assessing whether a visible action matches a sound, whether narration matches the scene, or whether a soundtrack change is appropriate. The reviewer should return observations with timestamps and uncertainty; the director should own editing decisions.

The deployment should expose one conversation. Internal roles need not create two personalities or require manual model selection. The reviewer is a bounded tool with access to a clip and criteria, not an independent agent that can spend GPU budget on new generations.

## Why the Gemma 12B finding changes the shortlist

Google's dedicated 12B developer guide demonstrates processing approximately five minutes of video using 313 frames and the soundtrack, and separately demonstrates agentic app creation. This is stronger evidence for combined audiovisual use than inferring capability from configuration fields. The demonstration is for the original model, not a Heretic derivative.[1]

Hugging Face's integration article supplies video-with-audio preprocessing code and an E4B concert example. It also reports an E2B audio hallucination in that example. That establishes a working family-level input path, while showing why accepting sound does not guarantee accurate interpretation.[2]

The 12B model is a different architecture from the small E2B/E4B variants: it projects image patches and audio waveforms into a shared decoder. It has approximately 11.95B parameters. The official comparison reports stronger results for 31B than 12B on several reasoning and tool benchmarks; those results describe unmodified models.[3]

The earlier characterization of all smaller Gemmas as merely audio transcription helpers was too restrictive. Conversely, the five-minute demonstration does not establish expert sound mixing, reliable subsecond synchronization judgments, or unrestricted behavior on every audiovisual request.

### Conflicting duration guidance

The general Gemma documentation states 30-second audio and 60-second video guidance, while the dedicated 12B article demonstrates a substantially longer audiovisual segment.[1][3] The inspected processor configuration contains `audio_seq_length: 750`, and the current processor describes it as an audio-token cap. The feature extractor also exposes length/truncation behavior.[4]

Start the acceptance test with 20–25-second windows. This is a conservative application choice, not a statement that the 12B architecture cannot handle longer clips. Expand only after checking decoded audio duration, frame coverage, token counts and an event placed near the end of the clip. For a 20-minute production, scene-level review is useful even when longer contexts work.

## Exact checkpoints

| Role | Checkpoint | Initial representation |
|---|---|---|
| Director | `llmfan46/gemma-4-31B-it-uncensored-heretic` | Author's Q8_0 GGUF plus BF16 vision projector |
| Reviewer / single-model trial | `llmfan46/gemma-4-12B-it-uncensored-heretic` | BF16 Safetensors |
| Alternate audiovisual reviewer | `huihui-ai/Huihui-Qwen3-Omni-30B-A3B-Thinking-abliterated` | BF16 diagnostic baseline before quantization |

For the 12B repository, direct inspection of the Safetensors header found 677 tensors, including the audio projection and image embedder weights. Its processor configuration contains image, audio and video processors. This is a complete-looking multimodal package, not a text-only export. Its author reports Heretic ARA modification, 6 refusals in 100 tested prompts, and MMLU changing from 76.17% to 73.02% in the author's 7,021-question evaluation. These are author measurements, not an independent audiovisual or tool benchmark.[5]

The 31B checkpoint has both previously inspected vision components and an independently listed UGI result. Its publisher responded to a community report about stale chat-template/tokenizer files and confirmed an update. That is concrete maintenance evidence beyond model-card labels.[6]

Record revisions when building deployment artifacts. Inspected BF16 revisions were `031ce2063177d066ff637f15ab59a2ca2eccfd19` for the 31B repository and `cf3bb4a17e8cf1cdf6b429b6ed9f9dbe476c40e0` for the 12B repository. Pin the GGUF repository separately when it is downloaded; the BF16 revision does not pin a different repository.

## Community support

Public Hugging Face API snapshot retrieved September 9, 2026:

| Exact repository | Monthly downloads | Likes | Interpretation |
|---|---:|---:|---|
| LLMfan46 Gemma 4 31B Heretic, BF16 | 56,062 | 123 | Strongest exact-checkpoint community signal in this shortlist |
| Same 31B author's GGUF repository | 77,031 | 186 | Substantial additional distribution; not unique people |
| LLMfan46 Gemma 4 12B Heretic, BF16 | 496 | 11 | Small direct BF16 audience |
| Same 12B author's GGUF repository | 6,845 | 19 | Modest but visible use and discussion |
| Huihui Qwen3-Omni Thinking abliterated | 266 | 9 | Very limited exact-checkpoint evidence |
| Sabomako Qwen3-Omni Thinking Heretic | 172 | 2 | Very limited exact-checkpoint evidence |
| Original Qwen3-Omni Thinking | 401,359 | 318 | Strong base-model ecosystem; not evidence for a derivative |

Counts are API observations preserved in accompanying JSON snapshots, not estimates of active installations. Hugging Face counts selected file requests, including HEAD requests; GGUF repositories count GGUF-file downloads. Do not add repositories together and call the sum a user count.[7]

LLMfan46's release discussion contains questions from users, author replies and follow-up troubleshooting. The publisher also maintains multiple quantizations and has a broader Gemma community. These signals justify preferring this publisher over an isolated upload, but do not certify audiovisual quality.[8]

The counterevidence is important. A user of the 12B GGUF reported poor persona/prompt adherence; the author acknowledged instruction-following concerns and pointed to formatting failures in their evaluations. This is a reason to keep the 31B director available, not proof that all 12B tool calls fail. The complaint concerns a quantized build and a persona task; the BF16 studio test must determine transfer to this application.[9]

## What UGI does and does not establish

The saved UGI snapshot contains 1,309 entries. The following positions sort the numeric UGI column descending, counting different inference configurations separately.[10]

| Tested configuration | Position | UGI | Writing | NatInt |
|---|---:|---:|---:|---:|
| coder3101 Gemma 4 31B Heretic, thought prefill | 6 | 65.69 | 40.49 | 36.53 |
| LLMfan46 Gemma 4 31B Heretic, thought prefill | 8 | 64.99 | 40.61 | 36.41 |
| LLMfan46 Gemma E4B ultra Heretic, thought prefill | 501 | 38.54 | 19.21 | 16.35 |
| Original Qwen3-Omni Thinking | 747 | 33.04 | 19.35 | 21.26 |

Neither the selected Gemma 12B modification nor the Huihui/Sabomako Omni modifications appears in this snapshot. The original Gemma 12B with thought prefill records Writing 36.32 and NatInt 29.47; its refusal behavior depresses the aggregate UGI result. None of those base scores can be assigned to the modified checkpoint.

UGI favors the 31B director choice, but cannot select an audiovisual reviewer by itself. The near-tie between the two 31B variants makes publisher support a more useful discriminator than their small score difference. The writing gap makes replacing Gemma with Omni solely because it has more input types an unattractive default.

## Why not simply use Qwen3-Omni alone?

The original Thinking checkpoint jointly processes video and audio and returns text. Qwen publishes sound, music and audiovisual examples. This makes it a legitimate candidate for reviewing a completed scene, including non-speech sound.[11]

Huihui states that abliteration was applied to the text component. In the Omni architecture, visual/audio representations feed the language component that reasons and produces answers. Therefore editing the language component can plausibly affect responses across modalities. It does not mean the model only supports text; nor does it prove reduced refusal rates on audiovisual requests. The exact model retains 525 audio-related and 351 visual tensors in its index.[12]

Neither modified Thinking repository had a public HF discussion at inspection. Sabomako supplies an author refusal/KL report and has quantized derivatives, but little independent evidence. Huihui's Instruct source returned an authorization error during anonymous inspection despite public GGUF derivatives remaining discoverable; that weakens its appeal as a reproducible new baseline.[12][13]

There is also a real deployment trap. Qwen's original README distinguishes offline audiovisual processing from an older online-serving path that lacks the same `use_audio_in_video` option. A community discussion reports missing sound when sending sampled video. Current vLLM lists the Thinker architecture as supporting all relevant inputs, so the correct conclusion is to validate the exact serving path, not to call the model incapable.[14]

For this studio, keep Omni as the reviewer fallback if Gemma cannot ground music/sound or audio-picture relationships. Do not pay for a permanent second large reviewer GPU merely to avoid validating a smaller model first.

## Other candidates considered

| Candidate | Decision and evidence |
|---|---|
| Gemma E2B/E4B Heretic | Economical and multimodal, but a weak starting point for the main director. The 12B option gives a more appropriate capability tier. |
| igorls Gemma 12B Heretic v1 | Visible adoption, but the inspected BF16 repository lacks processor files. Community refusal complaints prompted the author to recommend a newer QAT variant and acknowledge early reasoning-evaluation errors. Do not select v1 from its 0/100 headline alone.[15] |
| AEON Nemotron 3 Nano Omni abliterated | Exclude from the initial build. Its author explicitly reports reasoning loops and degraded sustained chat. This is direct adverse evidence, despite detailed deployment material.[16] |
| divinetribe Nemotron Omni | Interesting alternative but the inspected offering is oriented toward MLX/Apple Silicon, with limited derivative adoption. Poor match for an initial NVIDIA deployment.[17] |
| MiniCPM-o 4.5 | Large base-model community. No convincingly supported Heretic/abliterated Omni checkpoint was established in the inspected results. MiniCPM-V and text-only MiniCPM5 variants do not substitute for it. |
| GitMylo Qwen2.5-Omni 7B abliterated | High current download count, but no model card or public discussion in the inspected repository. The count alone does not establish a dependable modified reviewer.[18] |
| Qwen3.5-Omni | No official self-hostable checkpoint satisfying the modified-model requirement was found. Similarly named OmniCoder/OmniClaw models are not evidence of this architecture's availability. |

## Lean deployment design

Preserve the existing plan: the studio/backend runs on exe.dev, an LLM service runs on Runpod, and ComfyUI runs on its own media service. The model choice should not add an extra always-on GPU by default.

For a two-model LLM service, use the 31B Q8_0 artifact with its vision projector and the 12B BF16 artifact. The inspected files are 32.636 GB, 1.201 GB and 23.919 GB respectively: approximately **57.76 GB decimal / 53.79 GiB of weight files**. This is not a VRAM measurement, but leaves a plausible budget on a 96 GB GPU for working context, media preprocessing and runtime allocations.[19]

Start with one request at a time, a bounded chat context and short review clips. Avoid speculative decoding and maximum advertised context during acceptance. If two concurrent runtimes allocate excessive memory, use sequential residency first; do not silently increase hardware cost. A successful single-model trial removes the 31B process entirely.

Initial runtime choices:

- Director: a pinned llama.cpp build serving the Q8 GGUF and projector through its compatible chat endpoint.
- Reviewer: a small private Python service using the native Transformers model/processor with explicit video-audio loading. Begin with the reference path for diagnosis, then optimize serving once results are correct.
- Pi: ordinary chat/tool calls use the director. A `review_video` tool calls the reviewer with asset ID, clip boundaries and criteria. In single-model mode, both paths use the same 12B checkpoint, with no recursive model invocation while a generation still holds the worker.

Current serving libraries have model support, but parser and modality integration remain moving parts. vLLM has public Gemma tool-parser defect reports, including lost tool calls after reasoning transitions. These reports justify regression tests on the pinned version; they do not establish that every runtime or request fails.[20]

## Review contract

The application supplies `asset_id`, original start/end timestamps, the actual audio-bearing clip, the intended script segment and review criteria. It should initially request five fields: observed events, observed sound/dialogue, discrepancies, uncertain judgments and suggested edits.

Each discrepancy should contain a timestamp range, direct evidence and severity. Separate an observation such as “the narration names a red car while a blue car is shown” from a subjective recommendation such as “the music feels too energetic.” Do not let a fluent review imply accurate perception.

The backend should record frame timestamps, decoded soundtrack duration, sample rate and token counts. A missing audio stream should produce an explicit diagnostic result. The model should never be asked to infer whether the infrastructure happened to send sound correctly.

Use ordinary signal analysis for loudness, clipping and silence. Do not use a mono/resampled language-model input to certify stereo balance or mastering quality. The model can combine those measurements with perceptual observations, but it should not invent measurements.

## Acceptance test and decision rules

Run the 12B model first in BF16. This is the single-model trial and the reviewer baseline simultaneously. Use pre-existing permitted media or authored test clips with known answers. Preserve the exact prompt, model revision, runtime version, input-processing settings and output for every case.

| Test group | Suggested cases | Acceptance target |
|---|---|---|
| Audio actually received | Same picture with two different spoken lines; original soundtrack versus silence | Detect the difference every time; do not invent speech in the silent control |
| Joint grounding | Narration names an object absent from the picture; sound belongs to an off-screen action; matching control clip | Correctly distinguish matching, conflicting and inconclusive evidence |
| Time coverage | Distinct events near beginning, middle and end; repeat after increasing duration | No lost end segment or fabricated full-clip coverage |
| Sound/music | Speech over music, environmental effect, music change, clean control | Useful grounded descriptions; confidence reduced when the answer is unclear |
| Images | Reference/result pairs with changed wardrobe, object count or camera position | Catch meaningful differences without hallucinating identity details |
| Tools | At least 20 requests covering all four workflows, revisions, invalid duration and failed job | At least 95% valid calls; zero invented completed jobs or wrong asset IDs |
| Writing | One 20-minute outline, two scenes and three constrained revisions | Coherent structure, preserved constraints, acceptable prose and manageable repetition |
| Long interaction | At least 20 turns with reused assets and changed requirements | No persistent loops, silent tool loss or forgotten critical constraints |

These are proposed application thresholds, not published benchmark scores. A failed media-control test should block reviewer acceptance even if the output sounds convincing. A failed director test should trigger comparison with the 31B model on the same cases rather than a blanket conclusion that the reviewer is unusable.

Decision order:

1. **12B passes both jobs:** deploy one model and stop evaluating alternatives.
2. **12B passes audiovisual review but misses writing/tools:** deploy 31B director plus 12B reviewer on the same LLM GPU if memory tests pass.
3. **12B fails audiovisual grounding:** test Huihui Omni against the identical media controls using the native joint-input path. Keep 31B in charge of scripts/tools.
4. **Neither reviewer passes:** do not label the product as providing reliable automated final-video review. Preserve manual review while evaluating another checkpoint; do not hide the failure behind a transcript-only workflow.

This sequence contains at most three initial checkpoints and a clear stopping rule. It prioritizes one model without sacrificing the requirement for a capable studio director or actual audiovisual review.

## Evidence status

Confidence is high that the base 12B Gemma has a joint audiovisual input path and that the selected modified package retains the relevant weights/processors. Confidence is moderate that it is the best economical reviewer to try first given publisher support and memory requirements. Confidence in exact audiovisual quality, tool reliability and simultaneous GPU residency remains unmeasured.

No GPU was started, full model weights downloaded, or model inference performed for this report. Checkpoint headers/configuration, public model metadata, source code and published evaluations were inspected. Community reports are identified as reports, not reproduced failures. The recommendation is ready for a bounded acceptance run rather than further open-ended model browsing.

## Sources

All live pages and API snapshots accessed September 9, 2026. Publication dates are included where relevant; model metadata can change.

1. Google Developers, [Gemma 4 12B: The Developer Guide](https://developers.googleblog.com/gemma-4-12b-the-developer-guide/), June 3, 2026. Five-minute audiovisual and agent demonstrations.
2. Hugging Face integration team, [Welcome Gemma 4](https://huggingface.co/blog/gemma4), April 2, 2026, subsequently updated. Joint input code and reported examples.
3. Google, [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4). Architecture, base benchmarks and duration guidance.
4. Hugging Face Transformers, [Unified processor](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4_unified/processing_gemma4_unified.py) and [audio feature extractor](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4_unified/feature_extraction_gemma4_unified.py). Also the [checkpoint processor configuration](https://huggingface.co/llmfan46/gemma-4-12B-it-uncensored-heretic/blob/main/processor_config.json).
5. LLMfan46, [Gemma 4 12B Heretic](https://huggingface.co/llmfan46/gemma-4-12B-it-uncensored-heretic). Method, author evaluation and checkpoint files.
6. LLMfan46, [31B template update discussion](https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic/discussions/4), April 14, 2026.
7. Hugging Face, [Model download statistics](https://huggingface.co/docs/hub/models-download-stats). Counts also preserved in `model-community-snapshot.json` and `model-detailed-snapshot.json`.
8. LLMfan46 and users, [Gemma release discussion](https://www.reddit.com/r/LocalLLaMA/comments/1u3flg9/gemma_4_quadruple_release_12b_12b_qat_26ba4b_qat/). Publisher participation and distribution, not an independent benchmark.
9. LLMfan46 and users, [12B prompt-adherence discussion](https://huggingface.co/llmfan46/gemma-4-12B-it-uncensored-heretic-GGUF/discussions/1), June 12, 2026. Read through the HF discussion API; preserved in `llmfan12-community.json`.
10. DontPlanToEnd, [UGI leaderboard dataset](https://huggingface.co/spaces/DontPlanToEnd/UGI-Leaderboard/blob/main/ugi-leaderboard-data.csv). Local snapshot: `ugi-leaderboard-data.csv`.
11. Qwen, [Qwen3-Omni Thinking model card](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Thinking). Native modalities and examples.
12. Huihui, [Qwen3-Omni Thinking abliterated](https://huggingface.co/huihui-ai/Huihui-Qwen3-Omni-30B-A3B-Thinking-abliterated). Modification description and files.
13. Sabomako, [Qwen3-Omni Thinking Heretic](https://huggingface.co/Sabomako/Qwen3-Omni-30B-A3B-Thinking-heretic). Author metrics and derivatives.
14. Qwen, [repository README](https://github.com/QwenLM/Qwen3-Omni/blob/main/README.md), [audio/video discussion 157](https://github.com/QwenLM/Qwen3-Omni/discussions/157), and vLLM [supported models](https://docs.vllm.ai/en/latest/models/supported_models/).
15. igorls and users, [12B refusal report and author response](https://huggingface.co/igorls/gemma-4-12B-it-heretic-GGUF/discussions/3), June 10, 2026.
16. AEON-7, [Nemotron Omni experimental release](https://huggingface.co/AEON-7/Nemotron-3-Nano-Omni-AEON-Ultimate-Uncensored-BF16). Explicit author regression disclosure.
17. divinetribe, [Nemotron Omni BF16](https://huggingface.co/divinetribe/Nemotron-3-Nano-Omni-30B-Abliterated-MM-bf16).
18. GitMylo, [Qwen2.5-Omni abliterated](https://huggingface.co/GitMylo/Qwen2.5-Omni-7B-abliterated).
19. LLMfan46, [31B GGUF files](https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF/tree/main). 12B weight size independently derived from its Safetensors header.
20. vLLM, [Gemma parser issue 54256](https://github.com/vllm-project/vllm/issues/54256), August 28, 2026; ggml, [multimodal runtime documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md).
