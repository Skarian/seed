> Historical optimization research; candidates below are not enabled defaults.

# H3 optimization decisions — September 7, 2026

User preference: preserve good quality, accepting a modest visible loss (approximately 10%) if speed improves dramatically. No GPU deployed or settings changed. These are research-backed candidates, not measured results from this installation.

## Resolve the storage confusion

The two selected diffusion checkpoints are already `minimax_h3_fl2va_pruned_int8_convrot.safetensors` and `minimax_h3_ref2va_pruned_int8_convrot.safetensors`, 20.9704 GB each. Comfy explains its pruning as replacing redundant modulation computation with a functionally equivalent lookup table, with no output-quality loss. Quantization is a separate numerical approximation. A full FL2VA BF16 file is 66.2805 GB; pruned BF16 is 40.2257 GB; pruned INT8 is 20.9704 GB. Avoid equating pruning with a sacrificed percentage of quality. [Comfy announcement](https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui)

The earlier smaller estimate used a 15.6871 GB NVFP4-AWQ encoder. Stock Hearmeman selects the 27.1413 GB INT8 encoder, plus three Turbo adapters and an upscaler. This was a change in the compared bundles, not an increase in the required size of the pruned diffusion models.

| Selection | Model assets |
|---|---:|
| Stock audited Hearmeman bundle | 81.4641 GB |
| Same bundle, replacing INT8 encoder with NVFP4-AWQ | 70.0099 GB |
| Smaller encoder, both 8-step adapters, omit optional 4-step adapter and upscaler | 67.3631 GB |

The small preview decoder remains in the last option. These totals exclude generated files, uploads and software caches. The smaller encoder is a supported Comfy-Org conversion, not a smaller language-model architecture; it does not require a Blackwell GPU merely to load. [Comfy model card](https://huggingface.co/Comfy-Org/MiniMax-H3)

A 100 GB standard volume is sensible for the 67.36–70.01 GB steady-state set and costs $7/month at the already-verified $0.07/GB-month rate. A 120 GB volume costs $8.40/month and accommodates retaining both encoders temporarily: the full stock bundle plus the NVFP4 encoder is 97.15 GB. Do not promise 20 GB of free space on a 100 GB volume while keeping both encoders. Additional experimental adapters also consume space. Download experiments sequentially rather than collecting every model. Do not permanently retain full BF16 checkpoints purely for benchmarking.

## Ranked candidates

| Optimization | Decision and quality implications |
|---|---|
| Pruned INT8 ConvRot diffusion + CUDA 13 | Keep as default. Comfy-Org explicitly prefers INT8 ConvRot with cu130 over FP8 scaled. Verify native quantized kernels, rather than assuming any custom loader is faster. |
| Exact conditioning reuse and model residency | First priority for repeated seeds. Reuse only when model, prompt, references and encoding settings match. Keep the active diffusion model resident where memory allows; do not blindly import low-VRAM flags into a 96 GB configuration. |
| SageAttention, H3-compatible implementation | First speed experiment. Official Comfy docs describe roughly 2× generation speed with minimal quality loss, but actual gain and correctness are configuration-dependent. Compare against standard attention on full intended clip dimensions and verify video and audio. |
| LightX2V 8-step 768p Turbo | Leading everyday candidate for both modes. Eight evaluations versus twenty offers a theoretical 2.5× reduction in sampling work, not a guaranteed 2.5× end-to-end speedup. Motion, detail and sound can change. |
| Alibaba PAI PDD 8-step | High-priority alternative to LightX2V. Both FL2VA and Ref2VA exist. Needs a PDD-aware loader/sampler, not plain LoRA loading. Compare each model family independently. |
| NVFP4-AWQ text encoder | High-priority storage/encoding experiment. Saves 11.45 GB; it runs during conditioning, not every denoising step. Do not advertise this as a dramatic sampling speedup. Check long prompts and reference fidelity before replacing INT8. |
| Spectrum H3 | Trial on standard 20-step preset first. Forecasting skips transformer evaluations and changes trajectories. Preserve exact warmup/tail steps; do not initially combine with Turbo or another cache. |
| Sol-Attn for SM120 | Trial separately from Sage. Sparse attention is approximate even when selected blocks are computed exactly. Preserve conditioning/audio rows and dense final steps where supported. Attention-kernel benchmarks are not total generation speedups. |
| Ref2VA Accelerator | Mode-specific alternative to Spectrum. Try Conservative before Balanced. Published production path was validated on BF16 and needs fresh testing with our INT8 model. Avoid simultaneous full-block caches. |
| EasyCache / H3 Speed Cache / TeaCache-style residual reuse | Secondary experiments. Residual reuse differs from exact prompt caching and can introduce texture/motion errors. Prefer one cache at a time; no default stack of all available nodes. |
| Four-step Turbo | Separate draft preset. Do not assume a 10% quality bound. Use the matching adapter, sigma shifts and sampler; four steps on an undistilled model is not equivalent. |
| Full NVFP4 or mixed INT4/NVFP4 diffusion | Lower priority on 96 GB. Memory savings are less valuable here; limited evidence includes disproportionate audio sensitivity. Keep INT8 unless a matched end-to-end test demonstrates a worthwhile gain. |
| FP8 diffusion / GGUF / custom hybrid loader | Compatibility or constrained-memory alternatives, not default upgrades to our CUDA 13 INT8 configuration. |
| torch.compile / CUDA graphs / optimized H3 fusions | Conditional engineering work after profiling. Account for compile time and shape changes. Open H3 graph-capture reports mean a blanket compile flag is not a proven free speedup. |
| Tiled VAE / preview decoder / latent upscaler | Use tiling for memory need, tiny decoder for preview, full VAE for final. Lower-resolution generation plus upscaling is a separate quality tradeoff and can lose its speed advantage in decoding/upscaling. |

Sources for individual decisions:

- [SageAttention setup and expected tradeoff](https://docs.comfy.org/tutorials/video/minimax/minimax-h3#speeding-up-generation-with-sage-attention). Use one attention override and preserve a standard-attention fallback. A successful import or kernel probe alone does not prove clean H3 media.
- [LightX2V specifications](https://github.com/ModelTC/Minimax-H3-Turbo). The table specifies different video/audio shifts for different adapter versions; avoid mixing old 544p recipes with 768p adapters. Its training uses reference resizing `match`; excessive reference resolution adds tokens and should be justified by visible identity/detail benefits.
- [Alibaba PAI PDD release](https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs) and [community ComfyUI PDD integration](https://github.com/Jalen-Brunson/ComfyUI-MiniMax-H3-PDD-Acc). The latter handles pruned AdaLN rebasing and the parallel-decoding head bank. Validate that all required pieces attach; an ordinary LoRA loader can silently omit important portions. PDD is an alternative to Turbo, not another adapter to stack on top.
- [Spectrum](https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3) explicitly reports larger composition/motion/detail changes when combined with few-step LoRAs. Its [decoded-media benchmark](https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3/blob/main/OBJECTIVE_MEDIA_BENCHMARK.md) covers a narrow three-seed ER-SDE comparison; it does not establish universal quality retention.
- [SM120 Sol-Attn implementation](https://github.com/KingGore/ComfyUI_sol-attn_Blackwell). Consider exact conditioning KV/query rows and dense tail settings as experimental starting points. Inspect the implementation before deployment: README descriptions of fractional tail controls are not fully consistent. Exact attention for audio rows does not make final generated audio bit-identical when other model states change.
- [Ref2VA Accelerator](https://github.com/BMB12d3/ComfyUI-H3-Ref2VA-Accelerator) and [H3 Speed Cache](https://github.com/linjian-ufo/comfyui-speed-minimaxH3). The latter explicitly warns against chaining full-model/block caches. Its separate text-encoder cache is a distinct, exact-reuse candidate.
- [Measured EasyCache investigation](https://github.com/pepikir/minimax-h3-speedup): one RTX 3090 study found late-step reuse introduced fine-texture artifacts; ending caching at 70% reduced both artifacts and the speed gain. Treat that threshold as a test starting point, not a universal safe value. Its large repeated-seed speedups included avoiding reloads on a memory-constrained GPU and should not be projected onto our 96 GB card.
- [Hybrid NVFP4 measurements](https://huggingface.co/abakanai/Minimax_h3_hybrid) show faster selected linear operations but explicitly distinguish numerical smoke tests from perceptual quality and acknowledge audio sensitivity. An additional [PRO 6000 measurement](https://huggingface.co/buckets/mrfakename/h3/tree/MiniMax-H3-NVFP4/README.md) reported 2.17 to 1.90 seconds/iteration for fully NVFP4 versus INT8 at low resolution; its quality claim was retracted and its scheduler was nonstandard. That does not justify replacing our INT8 default.

## Newer fast runtimes and distilled models

[FastH3 Preview v1](https://haoailab.com/blogs/fasth3-preview/) is worth tracking, but its headline 14× figure compares against a 49-call baseline on B200 with optimized VSA kernels and compilation. Our proposed baseline already uses twenty or eight steps, and the PRO 6000 is a different Blackwell architecture. The release targets text-to-video/audio, with image/reference support described as future work. The VSA-distilled checkpoint needs its matching sparse backend; substituting dense attention does not preserve its published result. This is a separate experimental T2VA lane, not a replacement for both requested modes.

[NVIDIA Sol-H3](https://nvlabs.github.io/Sana/Sol-Engine/Sol-H3/) and [vLLM-Omni's H3 recipe](https://github.com/vllm-project/vllm-omni/blob/main/recipes/MiniMaxAI/MiniMax-H3.md) contain valuable fusion/attention techniques, but their datacenter and multi-GPU benchmarks do not establish a ready-made Hearmeman/SM120 setup. Do not abandon the integrated ComfyUI workflow to chase those headline numbers before measuring the simpler candidates.

Community merges and distilled LoRAs from Larryvrh, FastVideo conversions and other authors can be tested later. Popularity and a single attractive example are insufficient to put an unbenchmarked merge ahead of the supported baseline and the two maintained eight-step families.

## Performance regression check before lossy tuning

[ComfyUI issue 15665](https://github.com/Comfy-Org/ComfyUI/issues/15665) remains open and reports a resolution-dependent slowdown around a `v.clone()` change, especially with Sage on some smaller GPUs. Results vary across reports; this is not proof our Linux 96 GB pod is affected. Benchmark intended 768p/duration settings and observe GPU power, memory and per-step timing. Do not blindly delete the clone: it was introduced as a memory fix. Compare attention backends or a reviewed fix if the regression reproduces.

[Issue 15551](https://github.com/Comfy-Org/ComfyUI/issues/15551) documents synchronization and data-dependent Python control flow that impede full graph capture. It supports profiling before promising torch.compile gains.

## How we apply the 10% preference

There is no calibrated universal percentage for video quality. SSIM or tensor cosine against a baseline is not a measurement of attractiveness, identity, physical motion or lip sync. A different output can score poorly against a baseline yet look better; a crisp still frame can hide broken motion/audio.

Use a proposed acceptance target of at least 2× warm end-to-end speed for an everyday lossy preset, with no obvious drop in identity, motion or audio and only modest detail changes. This target operationalizes "dramatically better"; it is not a claim of a measured 10% loss. Keep a conservative preset for difficult shots.

Test in stages to avoid a large bill:

1. Establish pruned INT8 standard-attention, standard-sampler baseline. Measure cold start separately from repeated runs. Preserve existing Comfy caches and use valid exact conditioning reuse where useful.
2. Compare Sage versus baseline, then NVFP4 encoder versus INT8 encoder. Include a long prompt and image/reference-conditioned cases. The base reference is the supported pruned INT8 setup; this does not prove a 10% bound relative to original BF16 weights.
3. Compare LightX2V 8-step and PDD 8-step with their own correct schedules. Do not change resolution, duration or references to make a faster candidate look deceptively better.
4. Only if worthwhile, compare conservative Spectrum and sparse attention individually; add Ref2VA-specific caching as an alternative. Audit node revisions and compatibility before installing.
5. Screen with a short case per mode; then test finalists on several matched seeds covering faces/speech, fast motion, fine textures and multiple references. Listen for clipping, noise, words and sync. Inspect video temporal stability and prompt adherence, not just selected frames.
6. Record total time, sampling time, encode/decode time, peak RAM/VRAM, actual model calls, cache hits and fallback messages. Never multiply published speedups from unrelated machines.
7. Hand over three presets: Quality (no approximate cache/Turbo), Balanced (winner of eight-step tests with validated attention), Draft (four-step if useful). Promote the smaller encoder only if its conditioning checks pass. Remove rejected experimental weights after results are reviewed; retain reproducible manifests.

The resulting leading configuration is still Hearmeman + both pruned INT8 models. Eight-step distillation and compatible attention kernels are the likely large speed levers; smaller diffusion weights and aggressive caches are not the first quality trade to make on a 96 GB GPU.
