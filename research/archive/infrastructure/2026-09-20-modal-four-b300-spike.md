> Historical experiment notes. Executable spikes have been retired; the current
> application uses fal directly. See [current architecture](../../studio/ARCHITECTURE.md).

# Four-B300 H3 Ref2VA storage and cold-start spike

> Superseded for this task by the [fal HQ/Fast spike](2026-09-20-fal-h3-two-mode-spike.md).
> The owner selected hosted fal H3 and H3 Max APIs. The Modal design below is
> retained for reference; no Modal deployment or paid execution was performed.

Design, September 20, 2026. Current scope: design and report back; no cloud
resources, model downloads, deployments, or paid runs have been started.
This supersedes the earlier text-only, two-video-batch matrix.

## API alternative reviewed after the cost discussion

The owner pointed out fal's dedicated H3 LoRA inference endpoints. Verified
September 20: `minimax/h3/reference-to-video/lora` supports the selected mixed
image/video/audio inputs and 5-15 second output. Its OpenAPI schema accepts
one to three LoRAs, each supplied as a URL or Hugging Face repository with an
optional weight filename and scale from 0 to 4. LoRA training on fal is not a
prerequisite in the input contract. This establishes a route to bring compatible
external adapters, not universal compatibility with every H3-derived export.

At 768p, fal currently lists $0.06 per output second for standard H3 and $0.075
for H3 with LoRA. A 15-second output is therefore $0.90 or $1.125 respectively;
four outputs are $3.60 or $4.50, and five are $4.50 or $5.625. These are published
output charges, not a confirmed all-in quote for the selected mixed references:
the endpoint pages do not clearly specify current reference-video/audio billing.
Do not copy H3 Max's token billing rules onto these separate endpoints.

The reviewed serving schemas do not disclose BF16/FP8/INT8 precision or native
step count, so API output cannot be described as a verified BF16/full-schedule
reference. Nonetheless, cheaper hosted inference with external LoRA inputs
weakens the economic case for self-hosting. Recommendation: evaluate fal's
standard H3 with the same three assets and no LoRA before committing to the paid
Modal experiment; measure actual charge, latency and audio quality. This is a
recommendation pending the owner's choice, not an executed API job or an
authorization to change the selected no-LoRA fixture.

[Standard H3 pricing](https://fal.ai/models/minimax/h3/reference-to-video),
[H3 LoRA pricing](https://fal.ai/models/minimax/h3/reference-to-video/lora),
[LoRA input documentation](https://fal.ai/models/minimax/h3/reference-to-video/lora/api),
[LoRA OpenAPI contract](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/reference-to-video/lora).

## Exact experiment

Run native H3 Ref2VA with three reference assets on one Modal host containing
four B300 GPUs. Test a single 15-second video from zero running workers, release
the worker, then test a batch of four 15-second videos from another cold worker.
All four GPUs cooperate on each video. The batch processes its four jobs
sequentially in one resident model process. Total: two GPU sessions, five videos.

The main question is the complete cost and wait for one occasional request.
The batch measures startup amortization. There is no paid warm-retention window
while the owner reviews outputs or prepares the next request.

Three-reference fixture: owner confirmed the earlier mixed setup: one image,
one three-second video with its soundtrack, and one separate three-second audio
clip. Use actual meaningful media, never empty files, silent placeholders, test
patterns, or dummy tones. Preserve source
order, crop/trim, timestamps, audio handling, prompt tags, and hashes in a fixture
manifest. Three source assets can yield four modality streams when the video
also supplies audio; report both counts.

The earlier harness identifies a generated portrait PNG, a generated cafe MP4,
and a WAV extracted from that MP4. These are generated media references, not
camera recordings; the separate audio file is not an independent source.
Local inspection on September 20 confirmed the files exist and decode: the
portrait is 1280 x 720 (1,043,074 bytes), the source video is 1344 x 768 with
five seconds of 32 kHz stereo audio (1,982,401 bytes), and the WAV is three
seconds of 32 kHz stereo audio (384,078 bytes). Both audio streams are non-silent.
The WAV is quiet (approximately -51.6 dBFS RMS); audition and inspect the selected
clips before GPU submission to establish useful reference content. File validity
and nonzero samples alone do not establish intelligible speech or quality.
Provenance is recorded in `C:/projects/runpod/.local/gemma-h3/benchmark.mjs`
and `C:/projects/runpod/.local/hq/test-pipelines.mjs`.

Use the same references and prompt for all five videos. Single seed S equals
batch job 1 seed S; jobs 2-4 use S+1, S+2, S+3. This measures four takes with the
same references. Do not describe it as four simultaneous requests.

The owner's ideal single-request result is below $2 in recurring total cost and
below five minutes from submission to durable result. These are evaluation
targets, not cancellation thresholds or promised results. Report the measured
achievable cost, latency, and batch throughput even if those targets are missed.
Show one-time preparation and ongoing storage separately as specified below.

## Configuration and implementation boundary

The owner has selected the official native checkpoint below for the first spike,
to measure cost/latency and investigate whether the current audio quality improves.
This is an experimental configuration, not a change to Seed's production recipe.
The current manifest totals 99.625 GB across image/video models and adapters.
Its Ref2VA HQ core is only 53.925 GB: pruned INT8 denoiser 20.970 GB, INT8
conditioning encoder 27.141 GB, FP16 video VAE 5.208 GB, FP32 audio VAE 0.605 GB,
plus the selected content LoRA. HQ does not load the 1.956 GB Turbo adapter.
Thus this 144 GB native variant is approximately 2.7 times the current Ref2VA
core. It also changes the sampling recipe; it cannot isolate provider performance
against the existing HQ workflow or identify one cause of an audio improvement.
These are file sizes, not measured VRAM requirements.
[Current model manifest](../../worker/models.json),
[current HQ graph](../../server/video.ts).

| Item | Specification |
|---|---|
| Placement | One Modal Function container, `gpu="B300:4"`; verify topology and peer communication |
| Model | Official native MiniMax-H3, `--model-variant ref2va`, request `task="ref2va"` |
| Parallelism | Four-way Ulysses, TP1 / SP4 / Ring1, encoder placement `auto`, resident model |
| Recipe | Native BF16 plus required FP32 components; full native schedule, 50 scheduler points / 49 denoiser evaluations; video/audio shifts 12 / 3 |
| Output | 1344 x 768, 24 fps, requested 15 seconds, native frame rounding and stereo audio; record actual duration/frame count |
| Execution | Eager, `quality="lossless"`, dense attention; no quantization, sparse attention, cross-step approximation, Turbo, or GPU snapshots |
| Host resources | Request 8 physical CPU cores / 256 GiB RAM; CPU soft limit 16, RAM hard limit 512 GiB, subject to admission |
| Lifecycle | `min_containers=0`, `buffer_containers=0`, `max_containers=1`, `scaledown_window=2`; application retries disabled |
| Serving | Standalone authenticated Modal Function and local runner; one SGLang engine per container |
| Image | Pinned Linux image, compatible CUDA 13.1+, PyTorch/SGLang/media libraries; build before any GPU allocation |

SGLang audit revision: `e97614d10c8e2c90a72387276086dc33f21bba67`.
Pin the tested image digest and dependency lock before executing.
The current Seed CUDA 13.0 worker image cannot simply be reused for Modal B300.
[GPU requirements](https://modal.com/docs/guide/gpu),
[native H3 recipe](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3).

No LoRAs in this spike. The owner explicitly selected the official native H3
BF16 model alone; style, subject, behavior, and acceleration adapters are all
excluded. Record an empty adapter list in every run manifest. LoRA compatibility
testing is deferred to a later experiment.

### How the four GPUs cooperate

Modal supplies one host/container with four B300 devices. One SGLang deployment
uses four GPU worker ranks, one per device, to process one request together.
The main denoiser uses Ulysses4 sequence parallelism with TP1 and Ring1: its
weights are replicated, while the packed token workload is distributed. Around
attention, all-to-all exchanges redistribute sequence/head partitions so each
attention head can use the full context; this does not generate four independent
temporal clips or stitch unrelated outputs together. Verify peer access and
the actual high-bandwidth GPU interconnect during initialization.

With `--encoder-parallel auto`, the supported single-host B300/P2P policy folds
the Qwen conditioning encoder across otherwise idle Ulysses ranks. Record the
resolved policy instead of assuming it. The native visual VAE distributes
complete overlapping decode tiles across its decode group. Audio decode and
CPU preprocessing/mux need not use all four GPUs equally. Record the active
ranks and stage timings; no claim of fourfold speedup for every stage is made.
The batch processes four complete videos sequentially using the same resident
four-GPU model, then releases the worker.
[SGLang H3 parallelism and placement](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3),
[Ulysses sequence/head exchange](https://github.com/microsoft/DeepSpeed/blob/master/blogs/deepspeed-ulysses/README.md).

Keep the spike outside Seed's production worker connection, database, and Library.
One invocation accepts the entire list of one or four jobs. No public endpoint,
general queue service, backend migration, or one/eight-GPU comparison is needed.

## Stage 0: put H3 on Modal's fast persistent storage

This is a required, measured preparation phase, completed before renting GPUs.

Storage layout, with a unique spike suffix on each resource name:

| Resource | Mount / contents | Lifetime |
|---|---|---|
| `seed-h3-models-<id>`, Volume v2 | `/models/h3/<revision>/Ref2VA/...`, model manifest and READY marker; GPU mount read-only | Persists across both sessions and scale-to-zero |
| `seed-h3-cache-<id>`, Volume v2 | Supported runtime caches, namespaced by image/model/device and run | Persists through experiment |
| `seed-h3-artifacts-<id>`, Volume v1 | `/artifacts/inputs/<fixture-id>/`, `/artifacts/results/<run-id>/<job-id>/` | Inputs/outputs survive GPU teardown |

Volumes v2 is the chosen performance candidate for reproducible weights/caches;
it is beta. Keep original media locally and use v1 for experiment artifacts.
Modal describes Volumes as a distributed filesystem with caching and up to
2.5 GB/s throughput, without a throughput guarantee. Mounting it does not mean
the checkpoint is already in host RAM, local NVMe, or GPU memory.
[Volume behavior and v2 status](https://modal.com/docs/guide/volumes).

### What we stage

Proposed official repository pin:
`MiniMaxAI/MiniMax-H3@42ed227ee7df40d41602854ae760620d6eb651fe`.
Retain the root-plus-`Ref2VA` layout expected by the native loader. Resolve only
that partition and required metadata/license. No adapter files are staged.

| Component | Native path under Ref2VA | Published rounded size |
|---|---|---:|
| Ref2VA denoiser | `transformer/`, 13 shards and index/config | 66.3 GB |
| Conditioning encoder | `text_encoder/`, 14 shards and configuration | 66.7 GB |
| Video VAE | `video_vae/`, including `source/model.safetensors` | 10.4 GB |
| Audio VAE | `audio_vae/` | 0.605 GB |
| Metadata and text processing | `model_index.json`, `processor/`, `tokenizer/` | Record exact bytes |

The upstream Ref2VA directory totals about 144 GB, approximately 134 GiB.
These are inventory estimates, not verified local storage usage. The complete
upstream repository is about 498 GB and includes other partitions/layouts;
do not blindly download the whole repository.
[Ref2VA files](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/main/Ref2VA),
[denoiser](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/main/Ref2VA/transformer),
[encoder](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/main/Ref2VA/text_encoder),
[video VAE](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/main/Ref2VA/video_vae),
[audio VAE](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/main/Ref2VA/audio_vae),
[repository](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/main).

### Preparation procedure

1. Build the pinned dependency image. Log build elapsed time and billed resources
   independently of model staging.
2. Create the task-owned Volumes. Run a CPU-only downloader, initially 4 physical
   cores and 16 GiB RAM, using a pinned Hub snapshot and an explicit file allowlist.
   Download directly from Hugging Face into Modal storage; do not relay the
   roughly 144 GB through the PC. Use bounded concurrent downloads and record
   transfer bytes, duration, and achieved throughput.
3. Validate all shard indices, sizes, hashes, configuration, and native tensor
   dtypes without materializing the full model in CPU RAM. Produce a
   manifest of relative paths, exact bytes, SHA-256 values, and revisions.
   Avoid duplicate HF caches/copies in the final storage footprint.
4. Write READY only after verification; explicitly commit the Volume. A fresh
   CPU container then checks the committed manifest, files, and readable shard
   headers. No GPU invocation is permitted until that check succeeds.
5. Upload just the three fixture assets. Validate them with ffprobe/image checks
   and actual decoding on CPU; inspect the image and video frames and audition
   the audio to establish meaningful content. Reject empty/invalid media, blank
   video, silent placeholders, and dummy test media. Prepare the selected clips
   and manifest, and commit the input files. Confirm the worker actually receives
   and encodes all three assets with the expected prompt tags and token counts.
   Record upload/preparation cost separately; preserve original source hashes.
6. GPU workers mount the committed model read-only and use local paths with Hub
   offline mode. Missing files fail before model loading; no runtime download,
   package install, full checksum pass, or redundant full-volume copy is allowed.

Weights remain on the Volume when GPUs terminate. They are loaded from this
prepared storage on each new GPU session, not downloaded again from Hugging Face.
The image contains dependencies, not a second copy of the checkpoint.
[Modal model-storage guidance](https://modal.com/docs/guide/model-weights).

## Run matrix and cache controls

| Case | Starting state | Work | Finish |
|---|---|---|---|
| S: single | Zero GPU containers; prepared model/input Volumes | Load model once; generate one video | Commit artifact, return, verify GPUs released |
| B: batch four | Zero GPU containers; a new process/container; same prepared model/input Volumes | Load once; generate jobs 1-4 serially without model unload between jobs | Commit each artifact, then release GPUs immediately after job 4 |

Case S is also the end-to-end functional check. There is no extra smoke video,
unreported warmup generation, or optimization A/B run in this five-video scope.
Run B only after S produces usable output and the projected batch fits the budget.

Use the same initial compiler-cache contents for S and B, in separate writable
namespaces. If no compatible prebuilt cache exists, both begin without it and
pay their own first-use compilation. Record any implicit JIT in startup or the
first request; it is part of cost. Preserve caches afterward for a possible
follow-up optimization. No custom reference-embedding reuse is added; record
any reuse the runtime already performs.

The weights Volume stays prepared throughout. Provider storage/page caches and
physical host selection are not under our control, so this is process-cold,
not a claim of physically uncached disks. Record available host/cache information.
With two cold starts, report individual results, not p95 or causal speedup claims.

## Timing and cost for every stage

Each event includes run/job ID, rank, component, monotonic start/end, UTC
timestamp, bytes where relevant, and GPU allocation state. Record resource
usage, model/config hashes, provider execution IDs, per-GPU VRAM and activity.
Attach the resource meter intervals to a timeline.

| Stage | Timing recorded | Cost attribution |
|---|---|---|
| Image preparation | Build start to ready image | One-time build CPU/RAM or observed image-build charge |
| Model storage preparation | Download, integrity check, commit, fresh-reader verification separately | One-time CPU/RAM plus storage bytes/days; zero GPU cost |
| Reference preparation | Upload, validation, clip preparation, commit | Input preparation CPU/transfer/storage; zero GPU cost |
| Scheduling | Submit to allocation, allocation to first user-code event | Full user-visible delay; charge only allocation intervals confirmed by provider |
| Runtime initialization | Imports, process launch, topology/NCCL initialization | Four GPUs plus host resources while allocated |
| Model loading | Per-component Volume read, deserialization/reconstruction, host-to-device transfer | Four GPUs plus host resources; log bytes/read throughput and peak RAM |
| First-use preparation | Kernel JIT, internal warmup, readiness | Startup/first-request cost, explicitly assigned once |
| Reference processing | File decode/preprocess, visual encoding, reference-audio encoding | Per job; separate CPU decode from GPU encoding where exposed |
| Prompt encoding | Tokenization and conditioning/text encoder | Per job; record prompt and reference token counts |
| Denoising | Full schedule, step count, per-step durations | Per job, four GPUs allocated |
| Output decode | Video VAE and audio VAE separately | Per job |
| MP4 output | Encoding/mux, file verification | Per job; GPU allocation still counts if retained |
| Durable save | Write and explicit Volume commit | Per job; committed result path and hash |
| Shutdown | Final commit/return to confirmed GPU release | Entire charged tail; no hidden idle allowance |
| Retrieval | CPU-only result transfer and local verification | CPU/egress if charged; GPUs already released |

Use runtime hooks and CUDA events with synchronization at existing stage
boundaries. Avoid per-operation synchronization that distorts throughput.
If mmap/read, reconstruction, and device copy overlap or cannot be distinguished,
report a combined measured interval with diagnostic subspans; never fabricate
separate timings. Parallel rank durations do not add to wall time. The same
allocated second is billed once across overlapping work, multiplied by four GPUs,
not four times again for four ranks.

In addition to the detailed timeline, produce `stage_metrics.csv` with:
`case, job, stage, wall_s, allocated_gpu_s, bytes, cpu_ram_cost_estimate,
gpu_cost_estimate, other_cost, cost_evidence`.
Here `allocated_gpu_s` means device-seconds across all four GPUs.
Keep overlapping diagnostic rows out of additive totals. Attribute shared startup
and shutdown once per session, then show their per-video allocation separately.

## Accounting model and report

Current standard Function prices:

- Four B300s: 4 x $0.001972 = **$0.007888 per allocated second**, $0.47328/minute.
- Requested 8 cores / 256 GiB: approximately $0.00067312/second extra.
  Combined requested-resource rate: approximately **$0.51367/minute**.
- At 16 cores / 512 GiB: approximately $0.55405/minute including GPUs.
  CPU limits are soft; this is a planning rate, not a contractual spend cap.
- CPU staging at 4 cores / 16 GiB: approximately $0.00528/minute at requested
  usage. Actual billing follows requested/used resource rules.
- Volume list price: $0.09/GiB/month, with 1 TiB/month included at current public
  pricing. About 134 GiB of weights is about **$12.07/month gross**; incremental
  storage may be zero if the account has sufficient included capacity.
  Measure actual bytes, other account usage, and retention before claiming zero.

Use base placement pricing without a paid region/non-preemptible override.
Record the price/date and actual resource configuration at execution.
[Pricing](https://modal.com/pricing),
[resource metering](https://modal.com/docs/guide/resources).

Let L = allocated startup cost, G_i = complete generation/commit cost for job i,
and T = shutdown cost. Report:

- Single recurring compute: L_single + G_single + T_single.
- Batch recurring compute: L_batch + sum(G_1..G_4) + T_batch.
- Batch average: batch recurring compute / 4.
- Each video's own generation cost, plus startup/shutdown allocation, shown
  separately so a cheap warm average cannot conceal a costly first request.
- One-time setup and reference staging, ongoing storage, and any transfer charges
  on separate lines. Also provide the actual total experiment cost including them.
  Show amortization over five outputs as an additional view, never the only view.

For each job show render duration and submit-to-durable-result latency; jobs 2-4
include their queue wait. Show time to first output and time to all four outputs.
Report local-download latency separately. Reconcile the total estimated compute
against Modal usage/billing evidence; per-stage dollars are allocations from
metered time, not separate provider invoices. Mark pending reconciliation clearly.

Volume usage is sampled daily; deletion can retain billable storage for up to
four days. Budget that tail. Network egress is currently uncharged in September
2026; Modal documents new allowances/charges starting October 1, so check the
execution date rather than hard-code free transfer.
[Storage billing](https://modal.com/docs/guide/volumes),
[egress policy](https://modal.com/docs/guide/network-egress-billing).

NVIDIA's approximately 195-second four-B300 native benchmark is text-to-video.
It is not a forecast for this three-reference task. We will measure Ref2VA time;
there is no honest measured cost for these five outputs yet.
[NVIDIA workload and timings](https://nvlabs.github.io/Sana/Sol-Engine/Sol-H3/).

## Native baseline rationale and audio comparison

Precision-benchmark review (September 20): published B300 BF16/online-FP8
measurements show modest warm-latency gains and substantial VRAM savings, not
an established cold-start solution. A small H100 study reports high audio
similarity for INT8 ConvRot relative to BF16; it does not establish perceptual
equivalence for our mixed-reference workload. Consequently keep the selected
native reference run, but do not promise that removing INT8 or pruning will fix
the audio. Do not expand this spike into a broad precision sweep.
[B300 precision sweep](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3#b300-precision-and-encoder-placement),
[quantization and pruning measurements](https://huggingface.co/multimodalart/MiniMax-H3-Pruned#measured),
[experimental Ref2VA NVFP4 measurements](https://huggingface.co/abakanai/Minimax_h3_hybrid#50-block-numerical-smoke-test).

MiniMax's official model card recommends supported local inference frameworks
and explicitly provides a four-GPU SGLang Ref2VA command. SGLang exposes native
precision with the reference schedule and a lossless request profile. These
establish an appropriate reference configuration, not a guarantee of good audio
on every prompt/reference set or a measured four-B300 Modal cold start.
[Official deployment guidance](https://huggingface.co/MiniMaxAI/MiniMax-H3#local-deployment-of-h3-base),
[SGLang quality profiles](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3).

H3's transformer jointly predicts video/audio latents. Quantization, approximate
pruning, sparse attention, sampling changes, and adapters are therefore possible
contributors to output changes in both modalities. This is a hypothesis, not a
diagnosis of the owner's audio problem. A smaller checkpoint is not by itself
evidence of lower quality: MiniMax also documents that AdaLN outputs can be
precomputed so the corresponding weights need not remain resident for inference.
Distinguish exact precomputation from approximate fitted/pruned variants.

Our current audio VAE is already FP32. Seed prepares reference audio as 32 kHz
stereo; the HQ exporter converts generated samples to 16-bit PCM with clamping,
then muxes AAC at 256 kbit/s. No observed clipping defect is established by this
code review, but generated peaks outside [-1,1] would be clipped. Existing checks
confirmed decodable, nonempty audio; they were not a controlled listening test.
[Audio export](../../worker/comfy_seed/video.py),
[reference preparation](../../server/media.ts),
[earlier validation limits](../development/H3-HQ-VALIDATION-2026-09-12.md).

Keep the five-video matrix. Select an existing poor-audio HQ example as the
single/batch-first fixture where its exact three references, prompt, and seed
are available. Use the same fixture across all five native outputs, without any
adapter. Historical HQ outputs used adapters, so record their metadata and
explicitly label that additional difference. The existing HQ output provides a
qualitative comparison without an additional paid control generation; it cannot
isolate BF16's effect. If its fixture cannot be recovered, also label the existing
comparison unmatched.

Save the native decoded waveform as a float32 WAV before clamping/normalization
or lossy encoding, alongside the final MP4. Record sample rate, channels,
duration, peak/RMS, non-finite samples, clipping fraction and silence/dropouts.
Decode the final MP4's audio and compare it with the raw waveform to separate
generation problems from export artifacts. Preserve the unmodified originals;
make loudness-matched copies only for blinded listening. Score intelligibility,
distortion, reference fidelity, unwanted sounds, and audio/video synchronization.
The owner's description of the specific audio defect is pending.

Keep prompt/reference configuration fixed across all five adapter-free runs; include
explicit intended speech/sound descriptions only if already in that fixture.
MiniMax recommends structured context/prompting, but changing prompts in the
same comparison would introduce another variable. Equal seeds across different
runtimes/samplers do not guarantee identical starting noise or aligned output.
Improvement would justify later one-change-at-a-time diagnosis, not a claim that
INT8 alone caused the prior problem. Audio diagnostics and WAV persistence get
their own timing/cost entries under output verification; no extra generations.

## Success, budget, and resource cleanup

Verify resolution/frame count, decodable stereo audio, successful use of all
three references, and usable nonblank output. Inspect reference identity,
motion, and sound adherence. Compare the same-seed single and batch-first output
using decoded frames/audio; the comparison is a consistency check, not a broad
quality or arbitrary-LoRA compatibility certification.

Success means the report accounts for all time/cost, both cold starts work, the
batch keeps one model resident, and GPUs release when work drains. Aim for
release within 15 seconds after final durable output; investigate and stop the
task-owned app if still allocated after 30 seconds. CPU retrieval must not extend
GPU lifetime. Model storage survives both scale-to-zero transitions.

Retain the proposed **$25 gross experiment allowance** as a design recommendation,
not an authorized expenditure. Limit aggregate four-GPU allocation to 30 minutes
(about $16.62 at the host planning rate above), leaving room for CPU preparation,
storage including deletion tail, and cleanup. Stop admission at an estimated $20,
reserving $5. Re-estimate before starting the four-job batch from measured single
startup/render times with a 25% margin; do not launch a batch that cannot fit.
Do not silently shrink the batch, retry failures, or increase the allowance.

Use a five-minute startup timeout, ten-minute single-execution timeout and
25-minute four-job execution timeout, plus an independent supervisor enforcing
the remaining aggregate allocation budget. These are abort bounds, not promised
latencies. Function timeouts and budget meters can lag; cancellation must stop
the engine/child processes and task-owned app, then verify no GPU containers.
[Timeout semantics](https://modal.com/docs/guide/timeouts).

Keep model storage across both tests. For the bounded spike, copy and verify all
results locally, then remove task-created Volumes after reporting their sizes
and retention costs unless a follow-up explicitly retains them. Preserved weights
are the intended ongoing deployment design; deleting the experiment cache ends
its ongoing storage exposure, not each generation's cache. Preserve pre-existing
resources. Record cleanup timestamps and delayed storage charges.

Next implementation deliverables: standalone Modal app, CPU staging/verification
command, immutable model/reference manifests, single/batch runner, stage
instrumentation, budget supervisor, five outputs, event log/CSV, and reconciled
report. Resolve Modal authentication, image/dependency compatibility, concrete
fixture content validation, and spending authorization before the paid run. This document
is the completed design; no performance result is claimed.
