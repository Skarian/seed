# Real B200 validation — September 20, 2026

## Archive status

The B200 implementation was shelved after this experiment. Its complete source,
preload fix, tests and contemporaneous `studio/VALIDATION.md` are preserved at
`archive/b200-experiment-2026-09-20` (commit `5c9e6e0`), also retained on
`codex/b200-parallel-generation`. Only research reports were carried onto `main`;
the B200 runtime changes were not merged. Local evidence and generated media
remain in the paths recorded below. Future RTX pool work starts from `main`.

## Result

Decision: functional acceptance passed after the preload fix; the owner rejected
the economics for the current studio workflow and requested deletion of the GPU
and disk. Deletion is confirmed. Promotion is deferred.

Both 15-second HQ H3 mixed-reference clips completed. The second warm run took 16m 57s versus 17m 09s for the first (1.1% less time). Krea image generation and independent cancellation also passed while the first H3 job ran.

At this session's rental rates, the tested B200 configuration costs approximately 3.03 times the prior RTX PRO 6000 run. It supports simultaneous image/video work, but this unchanged HQ recipe still exceeds the desired ten-minute generation time. The first run spent 16m 36s in sampling, about 97% of total engine time; preloading and warm caches therefore have limited remaining time to remove. This comparison changes both hardware and memory-management configuration, so it does not establish the performance limit or best achievable economics of B200. See the configuration audit below.

## Configuration audit after shutdown

The owner's question about the small gain prompted a CPU-only audit of the saved
logs, the exact cached worker image, and upstream source. No GPU was rented again.

### Confirmed differences and possible causes

1. **The B200 test was not a hardware-only comparison.** Our dual-engine launcher
   adds `--highvram --disable-dynamic-vram` to keep both model sets resident. The
   prior RTX run used normal VRAM mode with dynamic VRAM enabled. In this pinned
   Comfy build, `--highvram` also disables dynamic VRAM unless explicitly overridden;
   removing only the second flag would not restore the default. We never measured
   a default, single-engine B200 baseline. This is a real confounder, not a proven
   source of the slowdown.
2. **The attention kernels merit architecture-specific profiling.** The
   [Sol source in comfy-kitchen 0.2.33](https://github.com/Comfy-Org/comfy-kitchen/blob/v0.2.33/comfy_kitchen/backends/cuda/sage_attention/sol_attn.cu#L16-L24)
   describes SM80+ support and tuning for SM120. NVIDIA identifies RTX PRO 6000
   Blackwell as SM120 and B200 as SM100 in its
   [GPU capability table](https://developer.nvidia.com/cuda/gpus).
   Support for a GPU does not establish optimal tuning for it. This is a specific
   optimization lead; the saved test has no kernel profile proving its impact.
3. **INT8 matrix-kernel selection is another testable lead.** The installed CUDA
   backend chooses a CUTLASS implementation with a cuBLAS fallback. Upstream
   [issue 98](https://github.com/Comfy-Org/comfy-kitchen/issues/98) reports a tall H3
   projection taking 144.3 ms through automatic selection versus 89.5 ms with an
   explicit configuration on an RTX A6000 and an older package. That is an
   author's microbenchmark on different hardware/software, not a B200 result or
   an expected whole-video speedup.

### What the evidence does and does not show

- Both successful runs used the CUDA-enabled kitchen backend, the intended
  Comfy Kitchen dense attention override and the logged Sol sparse producer path.
  The global startup line `Using pytorch attention` does not override those graph
  settings. Triton was disabled on both the RTX and B200 runs, not only B200.
- The B200 model was fully loaded. Reading the exact native patcher and mixed
  precision operations did not reveal a flag that unconditionally turns INT8
  matrix operations into full-precision operations: full-load LoRA patching calls
  the native setter, which requantizes the weight. Dynamic loading uses different
  staging and patching, but shares the mixed-precision linear implementation.
  Only profiling actual calls can establish the selected kernels and their cost.
- The warm video had no concurrent image computation and was only 1.1% quicker.
  The 25%/70% values are allocator memory budgets, not compute partitions.
- Sampling dominated runtime; models/downloads/startup were not repeated during
  the 17-minute warm generation. GPU utilization around 100% establishes activity,
  not efficient Tensor Core use. The power/clock snapshots do not substitute for
  a complete throttle-reason and kernel-efficiency trace.

The measured 22m 58s to 16m 57s change is approximately 26% less elapsed time,
or 1.35 times the throughput. It remains valid for these two tested configurations.
The earlier implication that this is all a B200 can deliver was too broad.

### Smallest useful next experiment, if a new rental is authorized

Start with one video engine using the normal production launch settings and the
same checkpoint, adapter, references and 131,683-token workload. Compare it with
the dual-engine preload settings on the same B200, recording actual INT8 matrix
and dense/sparse attention kernel times. Use a short selection of sampling steps
at the original sequence length to diagnose cost before paying for full clips;
a five-second text-only clip changes both shape and conditioning and cannot
answer this question. Validate any improvement with the full 30-step output.
Keep quantization, resolution, steps and sparse-attention policy unchanged for
the configuration comparison. Backend substitutions require output-quality checks.

No runtime flags were changed on speculation. Production and the installed app
remain unchanged. At the historical $6.296875/hour quote, generation alone would
need to reach about 5m 35s to match the earlier RTX clip's $0.59 cost; we have no
measurement showing that this is achievable.

## Hardware and recipe

- Vast instance 51703618, verified Oregon host 56167, one NVIDIA B200, 183359 MiB physical VRAM, 1000 W power limit, driver 580.126.09; 180 GB disposable disk.
- Rental quote: $6.30/hour including disk. Model ingress: approximately $0.24 for 99.4 GB in posted billing.
- Same existing INT8 ConvRot H3 checkpoints, text encoder, native VAEs and configured Civitai LoRAs. No 4-bit substitution or reduction in steps/resolution.
- HQ: native 1344 × 768, 24 fps, 360 frames, generated audio, 30 steps, native dense/Sol sparse attention. One image, one three-second video with soundtrack and a separate three-second audio reference.
- First seed 424242; second seed 424247 forces fresh sampling. Prompt, references, mode and quality are otherwise unchanged. Both runs started with base models already preloaded; “first” refers to first H3 inference after startup.
- First run included brief image generation/cancellation during video sampling. Warm run had no concurrent images. This is a practical two-run comparison, not a statistically controlled kernel benchmark.

## Measured timings and costs

| Run | Engine execution | Request to saved | Generation cost | With 10 min review/prompting |
|---|---:|---:|---:|---:|
| Prior RTX PRO 6000, 15s HQ + adapter | 22m 58s | 23m 07s | $0.59 | $0.85 |
| B200 first 15s HQ + adapter | 17m 09s | 17m 11s | $1.80 | $2.85 |
| B200 warm 15s HQ + adapter | 16m 57s | 16m 59s | $1.78 | $2.83 |

Generation cost = measured engine seconds × the session's hourly rental price / 3600. It excludes acquisition, downloads, debugging and idle time. Review/prompting adds ten paid idle minutes after each locally saved clip; human labor is not priced. These are dedicated rental costs, not serverless quotes.

The earlier RTX PRO 6000 Blackwell Workstation rental was $1.533333/hour including 240 GB disk, 97,887 MiB VRAM and a 440 W limit. Its measured run and evidence are in the September 12 H3 validation report and .local/gemma-h3. Prices are actual historical session quotes, not guarantees of future availability.

Three/four hours of GPU ownership at these rates cost $18.89/$25.19 on B200 versus $4.60/$6.13 on the prior RTX rental, before transfers and extra startup time. Review/prompting is already included if it occurs inside that wall-clock session.

## Concurrency, memory and startup

- Image alone: 3.165s engine execution, 6.056s request to saved.
- Fresh-seed image during video: 3.422s engine execution, 5.083s request to saved. Its execution interval lies inside the H3 interval.
- Image cancellation: the native image queue contained the job, the app cancelled it, and the video remained running. The first late cancellation attempt finished before the interrupt arrived; this is recorded separately and is not counted as a cancellation pass.
- An identical-seed image reused Comfy's sampling cache (0.14s). It is excluded from the fresh generation speed claim.
- Both image and video base model sets were resident before readiness, around 88.82 GiB total physical use. Peak sampled physical use across the test was 128.65 GiB of 179.06 GiB. Samples are approximately one second apart and may miss short spikes.
- Rental creation: 1.3s; authenticated SSH wait: 2m 55.7s; model preparation: 2m 50.3s; both engines first observed ready within another 36s. First Ready was observed 7m 19s after rent invocation, including a preparation approval pause. A startup defect was then corrected before the first successful generation. These timings are one host trial, not an availability guarantee.

## Defect found and fixed

The initial image failed because the startup loader created quantized parameters outside torch.inference_mode(), unlike Comfy's normal prompt executor. Applying the LoRA later hit “Cannot set version_counter for inference tensor.” The fix enters inference mode inside the preload thread. Both engines were restarted, and all subsequent completed image/video jobs used that fix.

Source: initial feature commit 3fcb8f4, fix commit cef8ad7 on codex/b200-parallel-generation. The rented image was ghcr.io/skarian/seed-worker@sha256:ddf23cbec59575960823645180be39a76ce2de5a446781d3d8bd532335075d8a, with only the committed preload fix applied over SSH. The published image itself therefore does not contain the final fix. Production pin and installed app remain unchanged. Automatic approval review blocked publishing the fix; explicit repository/registry publication approval is still required.

Validation after the fix: 69 worker tests passed, one skipped, including the thread-local inference-mode regression. Earlier full app/operations checks and SSH recovery evidence remain recorded in studio/VALIDATION.md. The live outputs passed native dimensions, exact frame count/fps/duration and nonempty audio decoding. Representative frames were reviewed; this is not a controlled perceptual-quality benchmark.

## Saved outputs, charges and cleanup

- Private evidence: .local/b200-live, including both engine logs, GPU samples, job observations, cancellation receipt and per-job output validation.
- Playback page: .local/b200-live/review/index.html. Original media remains in the isolated test Library under .local/b200-live/studio/data.
- Posted rental charges at the final billing read: $5.23; provider billing can lag.
- Rental wall time through confirmed deletion: 49m 24s; quoted compute/disk wall-time estimate $5.18 plus transfers. Deletion receipt: {"confirmed":"destroy","instance_id":51703618,"disk_retained":false}.

The separate H3 text/FL checkpoint check: passed a five-second HQ clip in 2m 05s engine time. This is route coverage, not a comparison with the longer mixed-reference clips.
