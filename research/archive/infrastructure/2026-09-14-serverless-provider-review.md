# Seed: serverless provider and cost review

> **Historical research:** retained as a September 2026 snapshot. For the latest
> direction, see the [RTX worker-pool analysis](2026-09-20-rtx6000-worker-pool.md)
> and [measured B200 findings](../development/2026-09-20-b200-live-validation.md).
> Prices, assumptions and recommendations below reflect the research dates.

> **Superseded recommendation, September 15:** the user reports 20+ minute GPU acquisition, requires no quality loss, prefers serverless with their own setup, and accepts ten-minute generation for a 15-second clip. Read the [updated comparison and ten-minute session budget](2026-09-15-h3-quality-preserving-cost-comparison.md). The preferred candidate is Modal with one GPU per ComfyUI worker, held warm during the session; benchmark B300, then cheaper B200/H200 candidates. Do not use the historical release-between-attempts recommendation or accelerated-model results below as equivalent-quality evidence.

Reviewed September 14, 2026; updated September 15 with prompt/review time and the Runpod B300/4-bit claim. This is a recommendation and estimate, not a deployment or a serverless benchmark.

## Recommendation

Use **Modal as the first benchmark candidate**, with **Runpod Serverless as the alternative**. Retain Seed's local UI, Library, models and graph construction. Replace machine acquisition, SSH pairing and single-worker dispatch with asynchronous cloud jobs and persistent model/output storage.

**September 15 refinement:** prioritize an optimized single-GPU configuration for human-paced iteration. Larger cooperating GPU groups remain candidates for queued work and short bursts, but their execution-only economics do not cover minutes spent reviewing and prompting with GPUs reserved. The quoted Runpod recommendation for a 4-bit model on one B300 concerns **MiniMax M3**, not Seed's **MiniMax H3** video generator. See the final section for updated costs and quantization considerations.

**User's clarified session:** 15-second output clips, roughly ten minutes reviewing and preparing the next prompt between generations, for three hours total. The later 20+ minute acquisition constraint invalidates the earlier recommendation to release a GPU between attempts. See the updated comparison linked above; the historical tables below are sensitivity examples, not measured cold-start performance.

The user's three complaints require separate changes:

| Complaint | Change | What remains to prove |
|---|---|---|
| Finding and preparing a GPU takes too long | Provider-managed scheduling; pre-stage models; build dependencies once | First-job latency after a long idle period and during constrained capacity |
| Only one generation at a time | Independent GPU workers; initially cap the whole application at four concurrent jobs | Correct routing, isolated outputs, cancellation and durable receipt across workers |
| A single video takes too long | Benchmark faster hardware and an optimized Fast inference path | Same-model, same-input speed and visual/audio quality; serverless alone does not shorten sampling |

Four independent 15-minute jobs can ideally finish in about 15 minutes with four ready workers rather than 60 minutes sequentially. Both use approximately one GPU-hour, before startup, idle and transfer overhead. A single job still takes 15 minutes.

## Repository findings

- [Base manifest](../../worker/models.json): 11 pinned files, 99.625 GB. The recorded three private adapters bring preparation to approximately 101.48 GB. [Startup evidence](../../studio/VALIDATION.md#recent-measured-runs) ranges from 5m42s to 20m54s; the latter includes a corrected rental. A later [HQ test](../development/H3-HQ-VALIDATION-2026-09-12.md#infrastructure-timing-and-cleanup) records a 31m11s Runpod container pull before engine preparation.
- Image generation needs roughly 18.99 GB of base weights. The manifest also includes a 1.83 GB unfinished identity-edit adapter. Video adds 78.81 GB across both routes. Image jobs should not wait for video weights; each video route can use a subset of the full library.
- [Worker connection](../../server/worker.ts) currently accepts the fixed local SSH tunnel and retains one worker identity. [Worker startup](../../worker/run.py) rejects the retired HTTPS transport. Some architecture prose predates this implementation.
- [Job dispatch](../../server/jobs.ts) reconciles one engine session and serializes execution. Adding a provider endpoint without changing this contract will not produce parallel generation.
- [Video graphs](../../server/video.ts) already use eight-step Turbo for Fast. HQ uses 30 steps and explicitly enables Sol sparse attention through Comfy Kitchen. Fast does not select that HQ attention path. Applying an acceleration recipe requires a measured compatibility/quality test, not simply enabling an existing Turbo option.
- Existing durable download, output validation, idempotency and local Library behavior are valuable and should be preserved. Cloud jobs must persist outputs before the worker exits, allowing the PC to collect them later.

### Measured inference baseline

These are existing RTX PRO 6000 96 GB runs, not results from Modal or another serverless service. Engine time includes loading within the execution, sampling, decoding and encoding. It excludes acquiring the rental and downloading the complete model library.

| Workflow | Engine time | Estimated compute at $4 per worker-hour |
|---|---:|---:|
| Image | 2.9–7.1 seconds | $0.003–$0.008 |
| Fast, 5-second text-only video | 112–116 seconds | $0.12–$0.13 |
| Fast, 5-second mixed-reference video | 251–252 seconds | $0.28 |
| HQ, 10-second text-only video | 501 seconds | $0.56 |
| HQ, 10-second mixed-reference video | 908–912 seconds | $1.01 |
| Fast, 15-second mixed-reference video | 924 seconds | $1.03 |
| HQ, 15-second mixed-reference video | 1,374–1,378 seconds | $1.53 |

Source: [live HQ validation, including the subsequent 15-second tests](../development/H3-HQ-VALIDATION-2026-09-12.md). Physical GPU use in the later tests reached a sampled 67.15 GiB. This supports beginning the full video comparison with a 96 GB GPU; it does not establish a minimum. Earlier private telemetry reports approximately 54–60 GiB of system RAM used during video runs; that host-wide metric is not a container memory requirement.

## Provider comparison

Prices below are public USD rates checked on the review date. Faster cards are candidates, not benchmark-equivalent replacements.

| Provider | Relevant public rates | Assessment |
|---|---|---|
| Modal | RTX PRO 6000: $3.0312/GPU-hour; H200: $4.5396; B200: $6.2496; CPU and RAM extra | First choice for a custom Seed service and hardware comparison |
| Runpod Serverless | Full RTX PRO 6000 96 GB: $3.49/hour; H200: $5.93; B200: $8.64 | Familiar container route; competitive baseline compute price |
| fal custom Serverless | RTX PRO 6000: $2.99/hour; H200: $4.50; B200: $6.25 list prices | Worth considering if custom-deployment access and storage terms suit personal usage; public pricing directs users to support |
| RunComfy | A100 80 GB: $4.99/hour; H100 80 GB: $7.49/hour; H200 141 GB: $9.59/hour, pay as you go | Convenient workflow deployment, but higher listed compute prices and different hardware |

Sources: [Modal pricing](https://modal.com/pricing), [Runpod pricing](https://www.runpod.io/pricing), [fal pricing](https://fal.ai/pricing), [RunComfy pricing](https://www.runcomfy.com/pricing). Use list prices rather than negotiated “as low as” offers. Several secondary documentation tables have older rates; the current pricing pages take precedence here. ComfyDeploy was also checked, but its linked pricing page did not expose readable current prices, so it is not given a speculative quote.

### Why Modal leads

[Modal Volumes](https://modal.com/docs/guide/volumes) distribute model data across its compute pool without user-managed regional replicas. That directly addresses Seed's history of region-specific storage and capacity friction. Its [GPU configuration](https://modal.com/docs/guide/gpu) supports the current 96 GB family and H200/B200 comparisons. Capacity and kernel compatibility still need validation.

Runpod remains viable. However, a [single network volume constrains placement to its datacenter](https://docs.runpod.io/storage/network-volumes). Multiple volumes require manual synchronization and multiply storage cost. A 150 GB standard volume costs $10.50/month; three copies cost $31.50/month. Its [host model cache](https://docs.runpod.io/serverless/endpoints/model-caching) currently allows one Hugging Face repository per endpoint and downloads all variants in that repository. Seed's multi-repository base models and private adapters do not map directly to that feature.

fal has [persistent model storage](https://fal.ai/docs/documentation/development/use-persistent-storage) and a [ComfyUI deployment example](https://fal.ai/docs/examples/image-generation/deploy-comfyui-server). Its separate visual-editor quickstart documents a 5–10 minute initial warmup, so selecting fal without pre-staging would not by itself address the complaint. No fal storage quote or Seed latency test was obtained.

RunComfy supports custom models, nodes and saved environments. Its optional Pro plan includes 200 GB storage; the free tier's 10 GB does not accommodate this library. This is a convenience option, not evidence of faster execution of Seed's exact models. [Plan details](https://www.runcomfy.com/pricing).

## Cost model

For the same model and settings:

`monthly cost = worker rate × total billed worker-hours + storage + transfer + other services − applicable credits`

Count startup, model loading, execution, output persistence and paid idle time. Sum worker-hours across concurrent workers. External queue delay is distinct from worker runtime. [Runpod billing](https://docs.runpod.io/serverless/pricing), [fal billing](https://fal.ai/docs/documentation/serverless/pricing), [RunComfy billing](https://docs.runcomfy.com/serverless/about-billing).

The $4/hour estimate above approximates Modal's RTX PRO 6000 plus four physical CPU cores and 96 GiB RAM: **$3.987072/hour**. At 128 GiB RAM it becomes $4.242816/hour. These are explicit sizing assumptions, not verified resource requirements. CPU/memory use can exceed the allowance assumed here. An image-only worker can probably be smaller, subject to testing.

Modal currently lists $30/month included compute on Starter and 1 TiB/month included Volume storage. The model library fits within that storage allowance if it is otherwise unused. Credits are workspace-wide; do not count them twice. [Pricing](https://modal.com/pricing).

### Example months, before startup and idle overhead

Assumptions: 7.1 seconds/image; 252 seconds/Fast video (5 seconds, mixed references); 912 seconds/HQ video (10 seconds, mixed references). These hold current measured execution constant rather than inventing a serverless speedup.

| Monthly output | Engine worker-hours | Modal, about $3.99/hour, before / after full $30 credit | Runpod, $3.49/hour + one 150 GB volume |
|---|---:|---:|---:|
| 500 images + 20 Fast videos | 2.39 | $9.51 / $0 | $18.83 |
| 1,000 images + 100 Fast + 20 HQ videos | 14.04 | $55.97 / $25.97 | $59.50 |
| 2,000 images + 300 Fast + 100 HQ videos | 50.28 | $200.46 / $170.46 | $185.97 |

These are inference baselines, not all-in invoices. Add actual cold starts, idle tails, failed attempts, deployment work, output services, taxes and any paid transfer. For sensitivity: 60 seconds startup plus 60 seconds idle costs about **$0.13 per worker activation** at $4/hour. That is $13.33 across 100 activations and $133.33 across 1,000. This is an assumption, not a forecast of cold-start latency; batch/session patterns strongly affect image economics.

Modal has [announced egress billing from October 1, 2026](https://modal.com/docs/guide/network-egress-billing): Starter includes 1 TiB per cycle, then $0.04/GiB. September is uncharged. Volume I/O is excluded; transfers to the PC or an external store count. Large PNG exports deserve separate accounting.

Avoid continuous warm capacity for personal use by default: one worker at approximately $4/hour for 30 days is about $2,880 before credits. A short paid idle window can keep interactive bursts responsive without that commitment.

## Making individual videos practical

Benchmark **H200 and B200 against the full 96 GB RTX baseline**. With the same illustrative four-core/96-GiB host allocation on Modal:

- H200 totals approximately $5.50/hour and must be about **1.38× faster** to match baseline compute cost per clip.
- B200 totals approximately $7.21/hour and must be about **1.81× faster** to match it.

These are calculated break-even thresholds, not predicted speedups. A 2× B200 result would roughly halve wait time at slightly lower execution cost. For a 15-minute clip, that still means about 7.5 minutes; a two-minute target requires about 7.5× end-to-end acceleration. GPU branding alone cannot substantiate that target. B300 is not a first unchanged-image candidate because Modal documents CUDA 13.1+ whereas the worker is pinned to cu130.

The next software experiment should address the Fast attention path. [Comfy's H3 guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3#speeding-up-generation-with-sage-attention) describes an optional SageAttention speedup, but its approximate 2× claim is not a measurement of Seed's INT8/Turbo workflow and must not be added mechanically to a GPU speedup. HQ already has sparse attention. Test one change at a time with identical references, resolution, seed and audio.

If the current models cannot meet the requested latency after hardware/kernel work, expose an explicitly chosen faster draft recipe or reconsider the video model. A generic hosted model endpoint is not a drop-in replacement for arbitrary custom weights and LoRAs.

## Proposed validation before migration

1. Package only inference dependencies/custom nodes; pre-stage pinned models and adapters once. Separate image, FL video and reference-video dependency sets.
2. Run the same representative jobs on Modal RTX PRO 6000, then H200/B200. Measure cold scheduling, model load, execution and locally saved output separately. Include a long-idle cold request, repeated warm requests and four independent jobs together.
3. Compare the Fast attention candidate separately. Validate video, audio and references, and record cost per accepted output.
4. Only then change Seed dispatch: immutable per-job graph/preset, provider job ID, progress/cancel, durable remote output manifest, and idempotent local receipt. Keep a global concurrency cap across image/video services; four per endpoint would otherwise exceed four in total.
5. Use job lifetimes that cover current long videos. Runpod's [default execution timeout is ten minutes](https://docs.runpod.io/serverless/endpoints/endpoint-configurations), shorter than several existing successful jobs. Asynchronous GPU work must remain owned by the platform until it completes; returning early from an HTTP request must not imply the job is finished.

No application code, provider resources or credentials were changed during this review, and no paid generations were submitted. Exact serverless startup times, hardware speedups and final bills remain unmeasured.

## Follow-up: comparison with today's rentals and published H3 benchmarks

### Actual rental baseline

The private `.local/gemma-h3/REPORT.md` records the latest 15-second test's Vast rate as **$1.533333/hour including 240 GB disk**, on a 440 W RTX PRO 6000 Workstation. The preceding Spain test cost $1.9833/hour including disk. Use $1.533333 as the latest rental baseline, not the $4/hour serverless planning rate used earlier in this report. This is a historical quote, not a guarantee that an equivalent offer is available now.

At equal execution time, Runpod's $3.49 rate is **2.28 times** the latest rental; the illustrative Modal $3.987072 configuration is **2.60 times**. Against the earlier $1.9833 rental, the multiples are 1.76 and 2.01. These compare incremental execution cost before model-transfer, preparation, idle time, monthly storage and credits.

All rows below use mixed references and native 1344x768 output. They normalize the existing timings to each rate; they are not cross-provider measurements or per-job historical invoices.

| Clip / mode | Execution time | Latest Vast rate | Runpod Serverless, same GPU family | Modal, same GPU family plus assumed CPU/RAM |
|---|---:|---:|---:|---:|
| 5 seconds, Fast | 4.2 minutes, measured | $0.11 | $0.24 | $0.28 |
| 10 seconds, Fast | about 9.8 minutes, interpolated | $0.25 | $0.57 | $0.65 |
| 15 seconds, Fast | 15.4 minutes, measured | $0.39 | $0.90 | $1.02 |
| 5 seconds, HQ | about 7.6 minutes, estimated | $0.19 | $0.44 | $0.51 |
| 10 seconds, HQ | 15.2 minutes, measured | $0.39 | $0.88 | $1.01 |
| 15 seconds, HQ | about 22.9 minutes, measured | $0.59 | $1.33 | $1.52 |

The missing Fast 10-second point uses the midpoint between the measured 5- and 15-second execution times (588 seconds). The missing HQ 5-second point uses half the 10-second execution time (456 seconds). Both are rough budgeting assumptions; duration scaling is not necessarily linear and the endpoint measurements used different hosts. Text-only runs are cheaper: measured Fast 5-second execution at 115.7 seconds corresponds to about $0.05 / $0.11 / $0.13 across these three columns.

### Session cost can narrow the difference

At the latest rental rate, 10–20 paid minutes of preparation/idle time adds $0.26–$0.51 to a session, plus applicable model-download charges. Divide that among the clips made during the session. Forty idle minutes alone add approximately $1.02.

For an illustrative one-clip session with ten paid minutes of rental overhead versus two paid minutes of serverless startup/idle, the 5-second Fast clip costs about **$0.36 on Vast versus $0.41 on Modal** before transfer/storage. This does not predict a two-minute serverless cold start: it shows sensitivity to the non-generation time. Long productive rental sessions retain their cost advantage; sporadic jobs can narrow it.

### Published benchmark evidence

All rates in this subsection are recalculated using today's Modal GPU prices. They are **GPU-only execution subtotals**, excluding CPU/RAM, cold starts, warmup, idle time and transfers. They are not the authors' invoices or measured Modal results unless identified as such. In multi-GPU rows the GPU count is included in the arithmetic.

#### A. Closest ComfyUI example: TongFlow on Modal

The author's newer September 9 section reports a B200 reference-video run at 1344x768: **10 seconds in 412 seconds**, and **15 seconds in 684 seconds**, with an undistilled 20-step graph. Repriced GPU subtotals are **$0.72 and $1.19**. A matched 10-second PDD run took 226 seconds versus 418 seconds without PDD: about **$0.39** GPU-only. The encoder and recipes differ from Seed. Its RTX/H100 rows are older, and the README retains conflicting historical timings, so it does not establish a reliable hardware-only multiplier. [Author's report](https://github.com/tong-io/tongflow-modal-minimax-h3#picking-a-gpu-once-youve-decided-to-self-host).

#### B. Controlled SGLang study: eight H200s

The SGLang/Cache-DiT/NVIDIA/Ant authors report 1344x768 T2VA, 24 FPS, 50 configured steps, three prompts. Their dense reference path takes **39.67 seconds for a 5-second output** and **112.44 seconds for a 10-second output**: about **$0.40 and $1.13** across all eight GPUs. The conservative cache variant reports 28.02/78.28 seconds, with changed output. These are generation-side timings, excluding startup, warmup, polling and download; they do not cover Seed's mixed-reference job. [Controlled study](https://www.lmsys.org/blog/2026-08-27-minimax-h3-h200).

#### C. Operator study: optimized H200 Turbo

For approximately 5.2-second 768p outputs, one operator reports **34.953 seconds on one H200** and **5.136 seconds on eight H200s**, using SGLang, FP8, SageAttention, a different Turbo adapter and Cache-DiT. Repriced GPU subtotals: approximately **$0.044 and $0.052**, respectively. The protocol labels these `inference_time_s` whole-request measurements; they are not deployment-to-download timings. This is a promising reported result, not independent validation or a result for Seed's private adapters. [Operator's reproducible report](https://github.com/whn09/minimax_h3_h200/blob/main/RESULTS_TURBO.md).

#### D. OpenVDN: changed H3 architecture and trained adapters

The authors report **14.4-second, 768p** eight-evaluation denoising in **51 seconds on one B200** or **11.23 seconds on eight B200s**: **$0.089 / $0.156 GPU-only**. Their dense H3 comparison reports 134 seconds on one B200 versus roughly 264 seconds on one H200. These exclude model loading, warmup, VAE decoding and encoding. VDN adds a trained linear-attention branch and adapters; it does not establish compatibility with Seed's existing mixed-reference graph or private LoRAs. [Model authors' results](https://huggingface.co/OpenVDN/vdn-minimax-h3#results).

### What this changes

The evidence supports testing a faster **inference engine plus accelerator**, not only moving the unchanged Comfy worker. Single-GPU H200 results vary sharply with runtime and quantization; it should not be assumed faster than RTX from its product tier. Multi-GPU sequence parallelism can shorten one generation, whereas independent workers shorten the queue. The latter is the simpler initial Seed integration; the former requires engine support and appropriate interconnects.

For the same Seed graph, a B200 at the illustrative **$7.205472/hour** would need to be **4.70 times faster** to match the latest $1.533333/hour rental's execution cost. The previously stated **1.81 times** threshold compares B200 against Modal RTX serverless, not against today's cheap Vast rental.

Sensitivity for the existing 15-second HQ mixed-reference job:

| Configuration | Assumed execution | Execution subtotal |
|---|---:|---:|
| Current Vast rate | 22.9 minutes, measured | $0.59 |
| Modal RTX | same time, assumed | $1.52 |
| Modal B200, 2 times current speed | 11.5 minutes, hypothetical | $1.38 |
| Modal B200, 3 times current speed | 7.6 minutes, hypothetical | $0.92 |
| Modal B200, 5 times current speed | 4.6 minutes, hypothetical | $0.55 |

No published result found is an exact match for Seed's current private adapters, mixed image/video/audio references, INT8 weights and Fast/HQ graphs across all three requested durations. A full eight-GPU worker also has a larger cold-start cost and consumes eight GPUs of account quota; replicating four such workers would need 32 GPUs of quota. Validate those options on a few representative clips before building them into the product.

## Follow-up: should Seed use multi-GPU workers?

**Include multi-GPU video execution in the design and benchmark it before choosing the production backend.** The evidence is strong enough to expand the earlier single-GPU comparison. It does not establish that eight GPUs should handle every job.

### Scaling within one generation

The operator's same-recipe 768p Turbo plus Cache-DiT scaling sweep provides this comparison for an approximately 5.2-second output. These are reported inference times on AWS H200 hardware, converted to Modal's September 14 GPU rate of $0.001261/GPU-second; they are not measured Modal invoices or timings for Seed's graph.

| H200s working on one clip | Reported inference | GPU execution cost | Cost premium over one H200 |
|---|---:|---:|---:|
| 1 | 34.953 seconds | $0.0441 | baseline |
| 2 | 19.546 seconds | $0.0493 | 11.8% |
| 4 | 9.874 seconds | $0.0498 | 13.0% |
| 8 | 5.136 seconds | $0.0518 | 17.6% |

Sources: [operator scaling sweep](https://github.com/whn09/minimax_h3_h200/blob/main/RESULTS_TURBO.md#scaling-out-turbo-does-not-dilute-ulysses), [Modal pricing](https://modal.com/pricing). The runtime uses a different Turbo adapter and FP8/SageAttention/cache settings. Seed's own adapters and mixed references remain unverified. Do not extrapolate this table into measured 10- or 15-second costs.

The general rule at equal per-GPU rates is `execution cost multiplier = GPU count / speedup`. Eight GPUs delivering 6.81 times the speed cost 1.18 times as much. For interactive iteration, that may be a worthwhile premium. Simply exposing eight GPUs to the current ComfyUI graph will not enable this result; the sampler needs an inference implementation that divides one generation across them.

### Two different uses of eight GPUs

- **Independent workers:** eight clips run concurrently. This removes Seed's serialized queue and usually favors throughput per dollar when each job fits one GPU.
- **One cooperating group:** all eight accelerate one clip. This favors the time until the first result.

Illustratively, using the timings above, eight independent ready workers would finish eight clips in about 35 seconds; one eight-GPU group processing those clips sequentially would take about 41 seconds, but deliver the first after about five seconds. This is calculated scheduling behavior, not a measured fleet test.

### Full session cost and acquisition time decide the winner

For a reused worker, an approximate cost model is:

`GPU cost per clip = GPU count * rate per GPU-second * (generation seconds + total billed startup/idle seconds / clips per activation)`

Assume 120 seconds of total billed startup/idle overhead per eight-H200 activation, and the reported 5.136-second execution. This is an explicit sensitivity assumption, not a forecast of cold-start performance:

| Clips sharing that activation | GPU cost per clip including assumed overhead |
|---|---:|
| 1 | $1.26 |
| 10 | $0.17 |
| 100 | $0.064 |

CPU, RAM, storage, transfers, failed attempts and credits remain separate. Include pauses while reviewing outputs in paid idle time: one minute holding eight H200s costs approximately $0.61 GPU-only. [Modal documents billed GPU reservation during warm idle](https://modal.com/docs/guide/cold-start#keep-containers-warm-for-longer-with-scaledown_window).

Hardware availability also affects the original complaint. Modal supports up to eight H200/B200 GPUs on one physical machine, but says requests for more than two GPUs usually have longer waits. A ready two-GPU worker can beat an eight-GPU worker that takes an extra minute to acquire. Queue delay affects user latency; only billed resource time belongs in the cost formula. [GPU allocation documentation](https://modal.com/docs/guide/gpu#specifying-gpu-count).

### Revised validation and routing recommendation

Compare one, two, four and eight H200s plus a single B200, with separate Fast and HQ results for the same 5-, 10- and 15-second Seed inputs. First verify that the engine can preserve the user's adapters, image/video/audio references and acceptable output quality. Measure submission-to-local-output time and total billed cost per accepted clip, including cold and warm sessions and realistic review pauses.

The design should support individual image workers, independent video jobs for batches, and a cooperating GPU group for interactive video where measured speed justifies the cost. Choose the GPU count per workflow from those measurements. Account-wide limits should count GPUs, rather than only workers; four eight-GPU workers consume 32 GPUs. This expands the earlier four-worker proposal without committing to that capacity or renting anything.

## September 15: prompting, review, and the B300/4-bit claim

### Include human time in each iteration

Writing prompts and reviewing saved clips happen locally. They incur GPU charges only while a remote GPU remains reserved. Persistent model storage is different from a model kept loaded on a paid GPU. A serverless deployment can retain its models and outputs while its GPU workers scale to zero.

Let `G` be generation seconds, `D` the non-overlapping seconds between generations spent reviewing/preparing the next prompt, and `R` the total allocated GPU rate per second. For a long sequence of iterations with the worker kept warm:

- GPU cost per attempt is approximately `R * (G + D)`.
- Iteration time is `G + D`, plus any queue/transfer time not already included in G.
- If prompting overlaps another job's generation, do not count those same seconds twice.
- Initial prompt composition can happen before acquiring the GPU; final review can happen after releasing it.
- For a finite session of N attempts, use actual billed startup + `N * G + (N - 1) * D` + final paid idle, instead of charging N full gaps automatically.

The following uses the published H200 Turbo timings above for a roughly five-second clip and current Modal GPU rates. It assumes the GPU group remains reserved through every pause. These remain a different recipe from Seed and exclude CPU/RAM, startup, storage, transfers and credits.

| Configuration | Generation | Cost/attempt with 1-minute pause | With 3-minute pause | With 5-minute pause |
|---|---:|---:|---:|---:|
| 1 H200 | 34.953 s | $0.12 | $0.27 | $0.42 |
| 2 H200 | 19.546 s | $0.20 | $0.50 | $0.81 |
| 4 H200 | 9.874 s | $0.35 | $0.96 | $1.56 |
| 8 H200 | 5.136 s | $0.66 | $1.87 | $3.08 |

With a three-minute pause, one versus eight H200s changes the complete cycle from about **3m35s to 3m05s**: 14% less time, or 16% more iterations per hour, at about 6.9 times the GPU cost per attempt. The earlier 6.8-times generation speedup and 18% compute premium apply to the execution portion, not this human-paced session. Eight H200s are doing generation for only about 2.8% of that cycle. No hourly dollar value is assigned to the user's time here.

Sources: [H200 scaling measurements](https://github.com/whn09/minimax_h3_h200/blob/main/RESULTS_TURBO.md#scaling-out-turbo-does-not-dilute-ulysses), [Modal pricing](https://modal.com/pricing), [billed warm idle](https://modal.com/docs/guide/cold-start#keep-containers-warm-for-longer-with-scaledown_window).

### Existing 5-, 10- and 15-second Seed workflows with a three-minute pause

These rows preserve the earlier mixed-reference execution timings and pricing assumptions. They add 180 seconds of reserved time per attempt, using the long-session approximation above. They compare the current GPU family at equal runtime, not an optimized H200/B300 recipe. The three-minute pause is an illustrative assumption, not observed user behavior.

| Clip / mode | Latest Vast rate | Runpod Serverless RTX | Modal RTX plus assumed CPU/RAM |
|---|---:|---:|---:|
| 5 seconds, Fast | $0.18 | $0.42 | $0.48 |
| 10 seconds, Fast, interpolated runtime | $0.33 | $0.74 | $0.85 |
| 15 seconds, Fast | $0.47 | $1.07 | $1.22 |
| 5 seconds, HQ, estimated runtime | $0.27 | $0.62 | $0.70 |
| 10 seconds, HQ | $0.47 | $1.06 | $1.21 |
| 15 seconds, HQ | $0.66 | $1.51 | $1.72 |

The Vast column uses the historical $1.533333/hour including disk. Runpod uses $3.49/hour, excluding separate storage. Modal uses the previously specified $3.987072/hour allocation. All exclude acquisition/setup, additional transfers and session boundaries; add those actual costs. A serverless worker allowed to shut down during the pause will follow the next model instead.

### Release GPUs during review: lower idle cost, possible extra wait

For repeated cold activations, with `C` billed startup seconds and `L` paid idle-tail seconds, GPU cost per attempt is approximately `R * (G + C + L)`. The human pause is not charged while the GPU is released. Compared with staying warm for D seconds, releasing is cheaper at the same resource rate when `C + L < D`; it can add startup and acquisition latency before the next clip. Real startup stages can have different resource rates, so the invoice is the final measure.

For sensitivity only, assume a 30-second billed restart and five-second idle tail. The reported five-second-output workloads would cost about **$0.088 on one H200** or **$0.405 across eight H200s**, before other services. The eight-GPU option would add 30 seconds of startup to its 5.136-second generation. These startup assumptions are not measured for Seed; a much slower model load can erase the savings. Additional scheduling delay affects latency but must not be charged as GPU time unless resources are reserved and billed.

Proposed behavior: compose the initial prompt before allocating GPUs, persist finished outputs, use a short measured idle window, and allow multiple queued variations to reuse one activation. Keep an explicit warm-session option only where the reduction in startup waits is worth its measured cost. Review can happen locally after a batch is saved. Batch size should match the user's need for variations, since generating unwanted alternatives is also waste.

### The Runpod sentence concerns a different MiniMax model

The exact sentence appears in [Runpod's MiniMax M3 guide](https://www.runpod.io/articles/guides/run-minimax-m3-on-runpod), updated September 13. It discusses a 428B-parameter reasoning model with image/video input, and fitting its quantized weights into B300 memory. That is different from the H3 video/audio generation model used in `worker/models.json` and `server/video.ts`. Its single-B300 recommendation and quoted pod price therefore do not establish H3's best configuration or serverless price.

A B300 is still a reasonable H3 benchmark candidate on its own merits. Current [Modal pricing](https://modal.com/pricing) is $0.001972/GPU-second, or **$7.0992/hour**, before CPU/RAM. [Runpod's current pricing page](https://www.runpod.io/pricing) lists **$9.98/hour for B300 Serverless**. Three minutes reserved only for reviewing/prompting adds about **$0.355 / $0.499** respectively, before generation. H3 runtime for Seed's exact workflow on B300 remains unmeasured. The current worker checks for torch `2.11.0+cu130`; [Modal documents CUDA 13.1+ for B300](https://modal.com/docs/guide/gpu#b300-gpus), so validate a compatible runtime before using that hardware.

### Is 4-bit suitable for Seed?

Seed currently uses **INT8 ConvRot diffusion weights and an INT8 ConvRot Qwen text encoder**, with separate Turbo/private adapters. Four-bit quantization reduces numerical precision in selected model components; it is independent of the number of sampling steps and does not imply half-resolution output or a fixed percentage loss of visual quality.

The [Comfy-Org H3 model card](https://huggingface.co/Comfy-Org/MiniMax-H3) currently prefers INT8 ConvRot diffusion models with cu130. It also offers a separately quantized NVFP4/AWQ text encoder. An encoder-only change and a four-bit diffusion-model change are distinct experiments and may affect different parts of the workflow. Our existing eight-bit configuration already fits a single 96 GB card in the measured runs; four-bit is therefore an optional performance experiment, not a prerequisite for fitting on B300.

There is promising four-bit evidence: an [operator's H3 report](https://github.com/whn09/minimax_h3_g7e#关于-4-bitnvfp4) reports NVFP4 plus SageAttention outperforming FP8 plus SageAttention on RTX PRO 6000, after correcting loader/kernel defects. It also reports that NVFP4 without the accompanying attention optimization can be slower at 768p. This supports testing a specific working implementation, not assuming every four-bit export is faster or equivalent. Its custom LoRA merging and runtime differ from Seed; existing private adapters require their own validation.

Keep INT8 as the quality baseline. First compare an optimized single H200/B200/B300; then change diffusion precision and encoder precision separately, holding prompts, references, adapters, steps and attention settings fixed where supported. Evaluate identity/reference adherence, prompt adherence, motion stability, fine detail and audio on complete 5/10/15-second clips. Pixel similarity alone is not an adequate quality score for generative video.

The decision metric is **total session spend divided by clips the user accepts**, alongside total iteration time. If a quantized version saves 20% per attempt but reduces the acceptance rate from 80% to 60%, its cost per accepted clip becomes about 6.7% higher, even before extra review effort. Those percentages are illustrative, not observed quality results.

**Updated preference:** optimize one GPU for ordinary creative iteration, compare its measured cost with short bursts on multiple GPUs, and keep four-bit as an optional candidate until its quality and adapter compatibility are established. No rentals, generations, deployments or model replacements were performed for this analysis.

## User scenario: 15-second clips, ten-minute gaps, three hours total

### Assumptions and how clips are counted

Interpret three hours as the entire wall-clock session, including generation and review/prompting, rather than three hours of human review plus additional generation time. There is one generation at a time and ten minutes between the previous output arriving and the next submission. The first prompt is ready at the start; final review may happen after the session ends. Count only jobs that finish within the session; a further job extending beyond the three-hour limit is not launched in this model.

For generation/startup latency A seconds and a 600-second gap, the maximum completed outputs is `floor((10800 + 600) / (A + 600))`. If the last clip also needs its entire review inside the session, count `floor(10800 / (A + 600))` complete cycles instead. Network transfer and scheduling delays reduce these counts unless already included in A. This is a planning model, not observed user activity.

### Today's measured workflow

With the worker already ready at the start, the existing 15-second mixed-reference Fast run takes 924 seconds; HQ takes approximately 1376 seconds. That allows **seven Fast outputs or five HQ outputs** in three hours with the specified ten-minute gaps. Keeping the historical $1.533333/hour Vast rental for all three hours costs **$4.60**, or approximately **$0.66 per Fast output / $0.92 per HQ output** including the reserved review periods. Model preparation and rental acquisition are additional; if they occur within the three-hour session, output counts can fall. These counts do not assume every result is accepted.

### If GPUs stay reserved for all three hours

These session bills are rate times three hours and do not require guessing inference speed. Output counts on untested hardware remain unknown.

| Configuration | Three-hour reservation | Cost of each ten-minute reserved pause |
|---|---:|---:|
| Latest Vast RTX PRO 6000 rental, historical rate including disk | $4.60 | $0.26 |
| Runpod Serverless RTX PRO 6000 | $10.47 | $0.58 |
| Modal RTX PRO 6000 plus earlier four-core/96-GiB assumption | $11.96 | $0.66 |
| Modal 1 H200, GPU only | $13.62 | $0.76 |
| Modal 1 B200, GPU only | $18.75 | $1.04 |
| Modal 1 B300, GPU only | $21.30 | $1.18 |
| Modal 2 H200s, GPU only | $27.24 | $1.51 |
| Modal 4 H200s, GPU only | $54.48 | $3.03 |
| Modal 8 H200s, GPU only | $108.95 | $6.05 |
| Runpod Serverless 1 B300 | $29.94 | $1.66 |

Prices rechecked September 15: [Modal](https://modal.com/pricing), [Runpod](https://www.runpod.io/pricing). Modal GPU-only rows require CPU/RAM charges in addition; the RTX row uses the previous illustrative combined allocation. Provider storage/transfer and credits are excluded unless stated. This table assumes workers actually remain allocated; ordinary autoscaling may release them earlier.

For this user cadence, holding eight H200s through every review interval makes the human pauses expensive. A fast inference subtotal of a few cents is not a session cost. Conversely, cheap rented hardware can remain cost-effective while the user thinks, even if it is a poor choice for the time spent waiting on generation.

### Releasing a B300 between attempts: cost targets, not measured runtimes

For the following sensitivity table, total allocated time per attempt includes loading/startup, generating the 15-second clip and saving its output; GPU release is immediate afterward. Assume this also equals submission-to-output latency, with no extra scheduling wait. Each attempt is then followed by ten minutes off-GPU. A real idle tail adds a small extra charge, and a cold scheduling queue reduces output count.

| Total allocated time per attempt, assumed | Outputs completed in three hours | Modal B300 GPU cost per attempt | GPU cost for the session |
|---|---:|---:|---:|
| 1 minute | 17 | $0.118 | $2.01 |
| 2 minutes | 15 | $0.237 | $3.55 |
| 3 minutes | 14 | $0.355 | $4.97 |
| 5 minutes | 12 | $0.592 | $7.10 |

These are performance targets to validate, not claims that B300 achieves those times on Seed. They show why a high hourly rate can still be economical if GPUs are released during the ten-minute human pauses. CPU/RAM and other services must be added. The three-minute row would deliver twice the current Fast session's outputs for a comparable GPU subtotal, if the exact workflow and quality can meet that target.

### Actual 15-second published benchmark to investigate

The [operator's duration sweep on RTX PRO 6000](https://github.com/whn09/minimax_h3_g7e#片长曲线attention-的平方项到底占多少) reports 768p, 15-second Turbo generation in **190.645 seconds on one GPU** and **109.758 seconds on two** with Cache-DiT. Without cache, its Turbo measurements are 255.412/147.657 seconds. This uses a four-bit diffusion recipe, a different Turbo adapter and engine; it is not Seed's mixed-reference/private-adapter result. Treat it as a concrete candidate, not an equivalent-quality replacement or a B300 benchmark.

At the cached timings, already-ready workers would deliver **14 versus 16 outputs** by the end of the three-hour session; requiring final review inside the session gives 13 versus 15 complete cycles. The ten-minute human gap reduces the benefit of adding a second GPU to about two extra outputs. A good single-GPU engine is therefore the first experiment to prioritize.

For another explicitly conditional cost example, if the reported one-GPU 190.645-second time reproduced on Modal RTX, and each restart took 60 billed seconds with a five-second paid idle tail, the session would complete **13 outputs for about $3.68** using the earlier illustrative $3.987072/hour CPU/RAM-inclusive allocation. Only the source inference time is measured; the Modal runtime, restart and host sizing are assumptions. This estimate must not be presented as an observed Seed invoice.

### Decision for this usage pattern

Use the local UI and Library during the ten-minute review/prompt intervals. Keep model files and outputs persistent, acquire a GPU for generation, and release it after output persistence plus a short measured idle tail. Benchmark an optimized single-GPU implementation first, retaining the existing INT8 recipe for the quality comparison. Four-bit remains a separate experiment. Multi-GPU execution is worth retaining as an option where its full startup-to-output benefit warrants the extra cost; a continuously reserved eight-GPU worker is not the default for this schedule.

The first practical target is a complete 15-second result within roughly **three minutes of billed GPU allocation**, including startup and saving. On a single Modal B300 that corresponds to about **$0.355 GPU-only per attempt / $4.97 for 14 attempts in this session**. Choosing a lower-priced GPU that meets an acceptable latency can improve cost further. Actual scheduling delay, quality acceptance, adapter compatibility and startup measurements decide whether any candidate meets the target.
