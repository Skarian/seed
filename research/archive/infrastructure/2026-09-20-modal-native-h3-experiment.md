> Historical experiment notes. Executable spikes have been retired; the current
> application uses fal directly. See [current architecture](../../studio/ARCHITECTURE.md).

# Proposed Modal native H3 experiment

> The active experiment is now the [fal HQ/Fast spike](2026-09-20-fal-h3-two-mode-spike.md).
> The owner selected hosted H3 and H3 Max APIs after reviewing the
> [four-B300 design](2026-09-20-modal-four-b300-spike.md).
> Both Modal proposals are retained as earlier exploration, not the active plan.

September 20, 2026. Repository/source review only. No Modal resources, model
uploads, image builds, deployments, or generation requests have been created.
This is a proposed experiment, not a production decision or runnable deployment.
The user's cross-task note is a hypothesis to investigate, not a specification.

## What this experiment would answer

The owner frequently submits one video and explicitly wants GPUs released once
the submitted batch drains. Optimized starts from zero are the primary objective;
paid warm retention during review/prompting is excluded from the proposed design.
A batch may contain one job. There is no minimum batch size requirement.

Can a short-lived, single-node Modal worker start efficiently, generate native H3
with the owner's compatible LoRA/references, durably save outputs, and release
its GPUs? Measure repeated starts from zero and the complete cost per completed
job, alongside warm inference. Native quality is the first proposed model focus;
the user has not yet confirmed that choice.

## Repository findings at dbd388e

- `server/video.ts` builds ComfyUI graphs. HQ uses INT8 ConvRot DiT and text
  encoder, 30 res_multistep steps, video/audio shifts 12/3, and Sol sparse
  attention (tau 1.3, starting at 20%). HQ removes the Turbo adapter but retains
  the selected private adapter, at strength 0.8. This is an accepted Seed recipe,
  not a full dense native BF16 reference.
- `server/worker.ts` accepts one production connection through
  `http://127.0.0.1:18080`. `server/jobs.ts` serially reconciles and dispatches
  work, persists uncertain acceptance, retrieves verified output, and acknowledges
  completion. Replacing this path with a cloud backend is a separate integration.
- `worker/Dockerfile` pins ComfyUI and asserts PyTorch 2.11.0+cu130. Reusing that
  image does not establish compatibility with Modal B300.
- `server/storage.ts` puts Library, settings, and credentials outside the checkout.
  A benchmark should use separate local artifacts and leave the installed studio
  untouched.

Recommendation: a standalone Modal benchmark first, with its own output manifest.
An app integration should follow measured results, rather than being needed to
get the first result.

## Source audit

NVIDIA publishes 746.885 / 194.930 / 99.513 seconds for 1 / 4 / 8 B300s at
1344x768, 24 fps, 362 frames, with stereo audio. Its runtime README identifies
these as **SGLang Base BF16 dense** results, using 50 scheduler points and 49 DiT
forwards. The benchmark is reference-free T2VA, median of three runs after one
warmup. Loading, compilation warmup, and MP4 encoding are excluded. It does not
benchmark the owner's LoRA or mixed references. The default Sol-H3 examples use
a four-forward adapter; their multi-GPU path includes approximate attention and
INT8/FP8 transport. Do not copy those defaults for a native baseline.
[NVIDIA benchmark](https://nvlabs.github.io/Sana/Sol-Engine/Sol-H3/),
[runtime settings](https://github.com/NVlabs/Sana/tree/sol-engine/models/minimax_h3/Sol-H3).

The earlier Sol-Engine report measures 27.205 to 19.514 seconds for kernel fusion
and graph capture on an 8xGB200, 124-frame workload. Its 3.16x caching profile is
relative to that Diffusers baseline; SGLang already measures 19.300 seconds there.
Thus dividing the separate 99.513-second SGLang/B300 result by 3.16 would both
change workloads and use the wrong speedup denominator. The cache profile has
reported LPIPS 0.210, not identical output. No $0.50 forecast is adopted.
[NVIDIA optimization report](https://nvlabs.github.io/Sana/Sol-Engine/H3/).

SGLang documents native mixed BF16/FP32 precision, separate FL2VA/Ref2VA
partitions, style/subject LoRA loading, and an explicit `quality: "lossless"`
request mode. Native precision should preserve required FP32 operations, rather
than forcibly cast everything to BF16. Its current H3 docs caution that compile
can alter numerics and that the audited `quality: "high"` cache profile is limited
to a specific 4xH200 workload. Start with eager execution and verify the actual
adapter format, alpha, strength, route, and loaded key coverage.
[SGLang H3 documentation](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3).
Source snapshot reviewed: `sgl-project/sglang` commit
`e97614d10c8e2c90a72387276086dc33f21bba67`; this is an audit reference, not a tested
deployment pin.

Modal supports `gpu="B300:8"` on one physical machine; requests above two GPUs
can wait longer. Its guide requires CUDA 13.1+ for B300, whereas the Sol-H3
README recommends CUDA 13.0. Resolve this compatibility gap in image preparation.
[Modal GPU guide](https://modal.com/docs/guide/gpu).

## Cold-start work to prioritize

Separate one-time preparation, recurring initialization, useful inference, and
GPU release. The previous 30-second to five-minute startup examples were cost
sensitivity scenarios, not measured or predicted H3 startup times.

Prepare dependencies and weights before serving. Use a pinned prebuilt image and
verified model/LoRA files in a Volume; avoid installation, external weight
downloads, and redundant conversion on the GPU startup path. Load only the
selected route. Modal recommends Volumes and describes comparable read performance
for image-contained weights, so baking weights into an image is not an assumed
speedup. [Model storage](https://modal.com/docs/guide/model-weights).

Compare parallel reads of independent components and checkpoint shards with the
runtime's existing loader. Avoid making each rank redundantly parse every large
component where the runtime permits sharing. Profile storage throughput and host
memory before choosing concurrency; more readers are not automatically faster.
Moving work into `@modal.enter` alone changes when it runs, not how much work is
required. [Initialization guide](https://modal.com/docs/guide/cold-start#reduce-latency-from-initialization).

Test CPU Memory Snapshots for imports and CPU-only initialization. GPU transfer
and distributed process/communication initialization follow restore. Snapshotting
the full CPU model is a separate measurement: restoring large memory images still
requires IO. SGLang's child-process initialization may require restructuring for
a parent snapshot to help. Full GPU snapshots are not a dependency of the plan:
Modal currently describes practical multi-GPU code as generally incompatible,
and snapshots do not remove storage-bandwidth-bound weight loading.
[Snapshot support and limitations](https://modal.com/docs/guide/memory-snapshots).

Persist compatible Triton/Inductor/runtime kernel caches, keyed by pinned software
and hardware configuration. Benchmark any remaining compilation or graph capture
against total single-request and batch cost. Cache files are not a guarantee that
all GPU initialization or capture can be skipped. Modal provides a concrete
cache pattern in its [SGLang example](https://modal.com/docs/examples/inkling_small).
These changes must retain the native quality contract; do not use quantization,
sparse attention, or fewer steps as a cold-start shortcut.

Keep each queued request's seed and adapter choice outside shared snapshot state.
Invalidate incompatible artifacts when model/adapter/runtime versions change.
Prove a restored worker loads the requested adapter rather than stale state.

## Smallest useful test sequence

1. Prepare and pin the runtime, selected native model partition, encoder and VAEs
   on persistent storage using CPU resources. Verify the manifest before GPUs
   start. Inspect the selected private LoRA locally; do not upload all studio data.
2. Allocate at most one eight-B300 container. Record GPU identities, topology,
   driver/CUDA/runtime versions, allocation delay, loading time, and host memory.
   Keep minimum/buffer containers at zero, cap the pool at one container for this
   experiment, and disable application-level retries. Set the shortest supported
   idle window (currently two seconds); verify actual release in provider state.
3. Run one five-second smoke request with native audio, followed by a
   fifteen-second request and one warm repeat. Use the native full schedule,
   dense attention, native precision, and no extra acceleration adapter or cache.
   Treat the smoke result as a functional check, not a full benchmark warmup.
4. Once the base path works, run a fixed request with the owner's selected LoRA,
   plus a matched no-LoRA control. Use the correct model partition. Mixed-reference
   Ref2VA is a separate test from reproducing the published T2VA number.
5. Save each output, hash, manifest, logs, and timing immediately. Verify dimensions,
   actual frame count, fps, duration, and decoded stereo audio. Preserve native
   frame rounding in the benchmark; do not silently trim 362 frames to Seed's
   360-frame delivery convention.
6. Commit each output and manifest to durable private cloud storage, then release
   GPU capacity when the queue drains. A CPU process can subsequently download,
   hash-check, and inspect the results; do not hold eight GPUs while waiting for
   the PC to retrieve a completed video. Keep durable artifacts until local
   verification succeeds. Confirm zero GPU workers and report retained storage.
   Failures should preserve available logs before shutdown.
7. After functional validation, measure the prepared baseline and optimized
   startup configurations from zero running GPU workers. Include an isolated
   one-video request and a small prepared batch, with independent cold starts
   within the approved budget. A second invocation on the same live worker is
   not evidence of a cold-start improvement. Record first-ever build/cache/
   snapshot creation separately from later starts with reusable artifacts.

Record model revisions/hashes, adapter metadata, prompt/seed, reference hashes,
sampler/schedule, precision/attention settings, load/warmup/inference/export/
transfer times, peak memory, and actual provider charges. A single adapter check
cannot establish arbitrary LoRA compatibility. A short run establishes feasibility,
not reliable latency distributions or perceptual superiority.

## Cost boundary to set before execution

Modal lists B300 at $0.001972/GPU-second, or $7.0992/GPU-hour. The eight-GPU node
therefore costs $56.7936/hour in GPU charges. Arithmetic at the published warm
latency is $1.57 per clip. Three/five idle minutes add $2.84/$4.73; ten review
minutes add $9.47. CPU, RAM, loading, retries, storage, and transfer are additional.
These are rate calculations, not Seed measurements or an experiment budget.
[Modal pricing](https://modal.com/pricing).

Release GPUs after every completed batch, including single-video batches. A
3-5 minute warm window is outside the owner's requested design. The retained-idle
costs above explain the rejected policy; they are not a per-generation surcharge.
Modal bills reserved GPUs during idle retention. Residual allocated initialization
and finalization also belong in the measured compute cost; storage remains a
separate resource after GPUs are freed. Do not promise billing exclusively for
the denoising kernel or instantaneous teardown.
[Modal cold starts](https://modal.com/docs/guide/cold-start).

Before paid execution, choose a total dollar ceiling, bound GPU allocation time,
account for CPU staging and host resources, and define a shutdown margin. Do not
assume free credits are available or that a function timeout alone caps all costs.

## Setup status and remaining preparation

Python 3.13 is present. The Modal SDK/CLI, default `~/.modal.toml`, and Modal token
environment pair were absent in this task environment. Account existence and
workspace limits remain unknown. Use an interactive login, never credentials in
chat. No private LoRA or media files were opened in this review.

Next preparation: confirm the user's experiment focus and account; build the
isolated harness and resolve CUDA/dependency pins; validate its local request,
cost, and artifact handling; review the selected LoRA; then obtain the bounded
spending authorization needed for the prepared run. No deployment code or paid
tests were performed during familiarization.
