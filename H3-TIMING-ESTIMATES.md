# Stock Hearmeman decision and timing estimates

**Storage update: user selected 100 GB ($7/month), replacing the earlier 120 GB proposal. See [LATEST-PLAN.md](LATEST-PLAN.md). Generation timing estimates below are unchanged.**

September 7, 2026. User selected the stock Hearmeman bundle, allowing only low-risk operational improvements. This supersedes proposals to swap encoders or add experimental optimizations at initial deployment. No cloud deployment performed.

## Initial configuration

Keep both pruned INT8 models, stock INT8 encoder, stock VAEs, all three Turbo adapters and bundled upscaler/preview assets: 81.46 GB. Keep the proposed 120 GB standard network volume, $8.40/month at the previously verified rate. Bundled optional assets need not run on every generation. Use the provided eight-step workflows initially and retain a standard twenty-step comparison workflow.

Preserve the template's own SageAttention setup and fallback; do not add a second attention override. Its output still needs verification. No new Spectrum/Sol-Attn/cache stack, encoder swap, fused checkpoint, PDD integration or core-code edit for the first deployment.

Low-risk operational improvements: verify persistent files before shutdown; preserve a tested version manifest; use one ComfyUI process and sequential GPU jobs; keep normal model/node caching rather than adopting low-VRAM flags; reuse unchanged inputs through existing cache; avoid unnecessary source-resolution references; protect browser/admin endpoints. Reference downscaling can affect detail, so follow the supplied workflow instead of aggressively reducing it. No new custom cache plugin is needed merely to start.

## Published measurements reviewed

These are firsthand reports from operators or implementation authors, not benchmarks run here. Older builds, different kernels, different weights and different precision prevent exact transfer to our installation.

| Report | Hardware and workload | Measured time | Why it is not our exact benchmark |
|---|---|---:|---|
| JUNI controlled comparison | PRO 6000, 1344×768, 243 frames (~10 s), 20 steps, SolAttn, warm, same image/seed and Comfy commit as comparison GPU | 256.2 s / 4m16s | SolAttn and reported NVFP4 selection differ from stock |
| Spectrum author | PRO 6000, pruned BF16, I2V, 992×768, 7 s, 20 steps, Euler/beta, DiffAid | 340.59 s without Spectrum; 200.32 s with Spectrum | BF16, DiffAid and an older experimental Spectrum version |
| Cloud Run operator | PRO 6000, DiffSynth NF4 + 4-step Turbo, 832×480 | 29.6 s for 5.2 s clip; 51.0 s for 9.4 s; 87.1 s for 15.1 s | Different framework and quantization |
| Same Cloud Run operator | PRO 6000, 1280×720, 124 frames, 4-step Turbo | 66.0 s | Different framework and quantization |
| MATLOWAI model author | PRO 6000, reference workflow, 1152×640, 243 frames, fused model + SLA | 76 s at 4 steps; 103 s at 8; 292 s at 25 | Modified weights, extra LoRAs and sparse attention |
| animede implementation | PRO 6000, 768×768, 124 frames, 30 steps | 157–159 s denoising; 6.5–9 s decoding; API request 185–245 s depending on encoder/loading | Different Diffusers implementation; square canvas; older environment |
| Long-duration stress test | PRO 6000, 1376×768, 1008 frames / 42 s, reference workflow | 4947 s / 82m27s; ~90 GB peak VRAM | Far beyond ordinary clip lengths; not a recommended preset |

Sources: [JUNI](https://note.com/j_alpha_lab/n/n1071215dfa4f), [Spectrum test and discussion](https://www.reddit.com/r/StableDiffusion/comments/1vhuorq/45_lower_minimax_h3_sampler_time_with_new/), [Cloud Run report](https://zenn.dev/acntechjp/articles/zenn-gcp-cloud-run-gpu-minimax-h3), [MATLOWAI](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot), [animede](https://github.com/animede/Diffusers_minimax-h3/blob/main/README.en.md), [42-second stress test](https://www.reddit.com/r/StableDiffusion/comments/1vnafvc/minimaxh3_can_generate_42s_videos_natively_on_an/).

Counterevidence matters: another [ComfyUI deployment](https://github.com/tong-io/tongflow-modal-minimax-h3) reports 18m11s for a ten-second PRO 6000 request. Its README includes historical/current configurations and timings that do not line up cleanly, so I do not use it as the central estimate. It does show that the GPU name alone cannot establish latency. The [japanfeats report](https://zenn.dev/japanfeats/articles/b2a6cf5788cead) found an older Turbo adapter made a run slower; its diagnosis was not established by a controlled kernel profile. Its headline resolution table omits clip duration/steps and is excluded from our timing estimates.

## Estimated planning ranges for our pod

Inference from the reports above, with deliberately broad allowance for stock INT8/Sage versus alternative stacks. These are not published stock-Hearmeman measurements or confidence intervals. Assume a warm healthy pod, one job, ~24 fps, video plus audio, no upscaling or second pass. Include ordinary encoding/decoding; exclude pod startup and initial downloads.

| Output resolution | Clip length | Stock eight-step Turbo estimate | Standard twenty-step estimate |
|---|---:|---:|---:|
| ~480p | 5 s | 0.5–1.5 min | 1–3 min |
| ~480p | 10 s | 1–3 min | 2–6 min |
| ~768p | 5 s | 1–3 min | 2–6 min |
| ~768p | 10 s | 2–6 min | 4–12 min |
| ~768p | 15 s | 4–10 min | 8–20 min |

Confidence is moderate-to-low for T2VA/I2V and lower for complex Ref2VA. These are working budget bands, not hard maximums. If a healthy stock installation is consistently slower, investigate model loading, patching, attention fallbacks, clip/reference token counts and known version regressions before accepting the result as normal.

T2VA and first-frame I2V are the strongest fit for this table. I2V adds image conditioning and is not automatically faster than T2VA. Simple Ref2VA may fit the same broad bands; budget toward their upper end. Multiple full-resolution images, source video and audio references can exceed them significantly. I did not find a matched stock benchmark sufficient to assign a universal Ref2VA multiplier.

Four-step drafts can be faster, with the exact-GPU alternate-stack examples around 30 s for five seconds at 480p and 66 s at 720p. Do not present those as stock guarantees or simply halve eight-step end-to-end time. Keep four-step as an optional workflow already bundled, not the quality default.

Video and audio are generated jointly in these workflows. Muting or discarding audio afterward does not remove the joint generation cost. Standalone still-image or audio-only workflows are not validated stock deliverables; no invented timings are assigned to them. Similarly, the bundled latent upscaler does not have a verified timing for this setup and any extra pass is excluded. Output MP4 muxing is distinct from generation/decoding.

Initial provisioning includes the 81.46 GB download and can take tens of minutes; network speed and image pulls dominate. Later model loading can add tens of seconds to minutes when changing modes or recreating a pod. Startup, warm generation and repeated-seed timings must be recorded separately during acceptance.

## Community feedback incorporated

- Hearmeman is recommended in recent [RunPod setup discussion](https://www.reddit.com/r/RunPod/comments/1w6bpa6/h3_minimax_set_up_in_runpod/) and has [workflow-specific discussion](https://www.reddit.com/r/comfyui/comments/1vlbfqk/minimax_h3_workflows_with_turbo_lora_auto/). This is evidence of use, not proof that every template revision is correct.
- Eight-step versus four-step quality is scene-dependent. A firsthand [ComfyLab comparison](https://comfylab.dev/blog/workflows/minimax-h3-comfyui-pdd-acc-vs-turbo-lora-rtx-3090/) found PDD eight-step preserved fight motion better but cost 51–60% more than its four-step comparison. Different adapter and GPU; supports keeping motion/audio review rather than selecting on still frames.
- The Spectrum thread includes both speedups and a commenter retracting an earlier comparison after discovering attention settings had changed. This directly supports not stacking accelerators and not multiplying unrelated speedup claims.
- Older modified-encoder advice is not accepted uncritically: the [Heretic author's discussion](https://www.reddit.com/r/StableDiffusion/comments/1vmdxzk/psa_im_the_creator_of_heretic_and_i_advise_you_to/) warns that changing encoder representations can hurt downstream generation. Our audited stock manifest uses Comfy-Org INT8, not that historical modified encoder.

At the observed $2.09/hour GPU rate, one minute costs about $0.0348: two minutes ~$0.07, six ~$0.21, twelve ~$0.42, twenty ~$0.70. Add persistent storage and small container-disk charges; retries and idle time also count. Final handoff should replace these estimates with measured T2VA, I2V and Ref2VA timing for the actual chosen image and workflows.
