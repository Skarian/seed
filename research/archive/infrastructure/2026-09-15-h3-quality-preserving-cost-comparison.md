# MiniMax H3: 15-second costs, serverless and quality constraints

> **Historical research:** retained as a September 2026 snapshot. For the latest
> direction, see the [RTX worker-pool analysis](2026-09-20-rtx6000-worker-pool.md)
> and [measured B200 findings](../development/2026-09-20-b200-live-validation.md).
> Prices, assumptions and recommendations below reflect the research dates.

> September 19 scope update: the user is building a personal director studio with Krea 2, H3, YuE2, per-job LoRAs and batch submission, used for 3–4 hours a few times weekly. See the [multi-model architecture and batch economics](2026-09-19-director-studio-architecture.md). Warm-session tables here remain valid scenarios; they are not the default cost of draining a batch and scaling down.

Reviewed September 15, 2026. USD list prices; no infrastructure provisioned or paid inference run.

## Decision

The previous recommendation to release a GPU between attempts is withdrawn for this workload until cold readiness is measured and acceptable. The user reports 20+ minutes to acquire a GPU. Repeating that interruption destroys an interactive session.

**Latest user preference: own setup on serverless; a 15-second clip taking ten minutes is acceptable.** Hosted model APIs remain cost references, but are no longer the recommended path. Preserve the ComfyUI graph, private models/adapters, reference handling and chosen quality settings.

**Primary candidate: Modal with one GPU per ComfyUI worker**, keeping an initialized worker ready for the session and scaling to zero outside it. Benchmark one B300 first, then one B200 and one H200 to find the least expensive configuration meeting the ten-minute target. A second independent worker supplies concurrent generation; it does not accelerate a single graph. Cooperating multi-GPU inference is unnecessary unless single-GPU candidates fail. Runpod Serverless is the alternative. No candidate has yet demonstrated the target on this exact workflow.

Serverless scheduling does not itself make sampling faster, eliminate capacity waits, or make a GPU held ready free.

## Quality contract and repository baseline

Use the current selected Seed workflow, references, private adapters, resolution, audio and sampling settings as the product acceptance baseline. No additional quantization, step reduction, sparse approximation or distillation is assumed acceptable. Separately, published dense BF16 reference results provide conservative evidence about the original H3 computation; they are not an exact match to Seed.

The repository currently loads INT8 ConvRot models. Fast already uses an eight-step Turbo adapter; HQ uses 30 steps and Sol sparse attention. Thus its measured HQ result is not an original 50-step dense BF16 benchmark. Hardware/runtime changes still need a paired quality comparison. Even exact algebraic runtime optimizations may change floating-point rounding and therefore the generated trajectory.

Local measured source: [15-second validation](../development/H3-HQ-VALIDATION-2026-09-12.md#additional-15-second-mixed-reference-validation), with rental rate in `.local/gemma-h3/REPORT.md`.

| Current Vast RTX PRO 6000 96GB | Time per 15s clip | Execution cost at recorded $1.533333/h |
|---|---:|---:|
| HQ, mixed references | 22m54s–22m58s | ~$0.59 |
| Fast, mixed references | 15m24s | ~$0.39 |

The outputs were 1344×768, 24fps, 360 frames with 15 seconds of audio. Inputs were one image, a three-second video with soundtrack, and separate three-second audio. The recorded hourly rate included 240GB disk and is historical, not a new capacity quote.

A three-hour allocation costs about $4.60. With 10-minute gaps and an initial 20-minute acquisition/preparation period inside the three hours, approximately five HQ or six Fast outputs complete. Budgeted cost is ~$0.92/HQ or ~$0.77/Fast when the entire three hours is charged. If initial queuing is unbilled, the bill is lower. At zero initial delay, seven Fast outputs fit; five HQ outputs still fit. First prompt is ready at session start; no final review is required for counting completed outputs.

## What the published hardware benchmarks actually show

Repriced at Modal's GPU rates. These were measured by their authors, generally outside Modal. Modal offering the hardware does not establish equivalent runtime or immediately available capacity.

| Hardware / source | Workload actually measured | Warm time | GPU cost for THAT measured output | Verified 15-second price? |
|---|---|---:|---:|---|
| 4× H200, SGLang | Dense BF16/FP32, 50 steps, 5s T2VA, 1344×768 | 74.38s | $0.375 | No |
| 8× H200, LMSYS/SGLang | Dense reference, 50 configured steps, 5s / 10s T2VA | 39.67s / 112.44s | $0.400 / $1.134 | No |
| 8× B300, SGLang | BF16, 50 steps, 5.167s FL2VA | 19.04s | $0.300 | No |
| 8× B300, SGLang | BF16, 50 steps, 5.167s Ref2VA | 29.12s | $0.459 | No |
| 4× B300, vLLM-Omni | Two-video Ref2VA, 362 frames (~15.08s), 1344×768; regional compile | 784.394s model-stage mean | **At least $6.19** | Near-15s evidence; excludes some end-to-end overhead |

Sources: [SGLang cookbook](https://github.com/sgl-project/sglang/blob/main/docs/cookbook/diffusion/MiniMax/MiniMax-H3.mdx), [controlled H200 study](https://www.lmsys.org/blog/2026-08-27-minimax-h3-h200), [vLLM four-GPU recipe](https://github.com/vllm-project/vllm-omni/blob/main/recipes/MiniMaxAI/MiniMax-H3.md#validated-four-gpu-evidence).

The four-B300 case is a substantially heavier reference workload than text-only; it is not evidence that B300 is slower than H200. Its stage total is not complete HTTP latency. Regional compilation and the difference in reference inputs prevent calling it a verified quality-equivalent replacement. The recipe's supported reference combinations also do not cover Seed's full mixed-reference combination.

**I did not find a matched, full-quality 15-second sweep across 1/2/4/8 H100/H200/B200/B300 for Seed's workload.** Assigning precise generation times to those cells would invent evidence. Longer clips and reference videos expand attention work nonlinearly.

### Planning illustration only: extrapolation from the 10-second H200 result

Scaling the 112.44-second, eight-H200 T2VA measurement from 10 to 15 seconds with linear versus quadratic duration growth gives **169–253 seconds**, or **$1.70–$2.55 GPU-only**. This is a sensitivity illustration, not a benchmark, confidence interval or guaranteed bound; actual runtime can lie outside it. It does not price mixed references, loading, compilation, transport, idle time or CPU/RAM.

### Why the earlier very cheap eight-H200 number does not qualify

The approximately five-cent result came from a roughly **5.2-second output**, eight-step Turbo, FP8, SageAttention and Cache-DiT. It excludes acquisition and warm idle. It is neither a 15-second price nor no-quality-loss evidence. [Original operator results](https://github.com/whn09/minimax_h3_h200/blob/main/RESULTS_TURBO.md).

Similarly, [TongFlow's actual Modal B200 report](https://github.com/tong-io/tongflow-modal-minimax-h3) gives 684 seconds for a 15-second reference clip (~$1.19 GPU execution), but uses an INT8 diffusion model, NVFP4 encoder and 20-step graph. It does not establish equivalence to Seed HQ or the dense original. FastH3, VDN-H3, Sol-H3 and H3 Max results are separate recipes/models, even when an individual implementation uses BF16.

## Modal: cost per 15-second generation at different actual render times

The following prices are **conditional arithmetic**, not claimed runtimes. A row answers: “If this configuration produces our 15-second clip in this many minutes, what would GPU execution cost?”

| Configuration | 1-minute render | 3-minute render | 5-minute render | Each 10-minute review gap held ready | 3 hours held |
|---|---:|---:|---:|---:|---:|
| 1× H200 | $0.076 | $0.227 | $0.378 | $0.757 | $13.62 |
| 2× H200 | $0.151 | $0.454 | $0.757 | $1.513 | $27.24 |
| 4× H200 | $0.303 | $0.908 | $1.513 | $3.026 | $54.48 |
| 8× H200 | $0.605 | $1.816 | $3.026 | $6.053 | $108.95 |
| 1× B200 | $0.104 | $0.312 | $0.521 | $1.042 | $18.75 |
| 2× B200 | $0.208 | $0.625 | $1.042 | $2.083 | $37.50 |
| 4× B200 | $0.417 | $1.250 | $2.083 | $4.166 | $75.00 |
| 8× B200 | $0.833 | $2.500 | $4.166 | $8.333 | $149.99 |
| 1× B300 | $0.118 | $0.355 | $0.592 | $1.183 | $21.30 |
| 2× B300 | $0.237 | $0.710 | $1.183 | $2.366 | $42.60 |
| 4× B300 | $0.473 | $1.420 | $2.366 | $4.733 | $85.19 |
| 8× B300 | $0.947 | $2.840 | $4.733 | $9.466 | $170.38 |
| 4× H100 | $0.263 | $0.790 | $1.316 | $2.633 | $47.39 |
| 8× H100 | $0.527 | $1.580 | $2.633 | $5.266 | $94.78 |

Calculated from [Modal list prices](https://modal.com/pricing). GPU-only; startup/warmup billed while allocated, CPU/RAM, storage beyond allowances, egress and taxes are extra. As an illustration only, four physical CPU cores plus 96GiB RAM add about $0.956/hour per container; this is not a validated resource allocation. Monthly credits are excluded from recurring unit economics.

[Modal's hardware documentation](https://modal.com/docs/guide/gpu) supports up to eight H100/H200/B200/B300 GPUs per container and warns that requesting more than two usually increases waits. This is catalogue availability, not a live capacity check. B300 requires CUDA 13.1+; the current Seed image uses cu130 and needs compatibility work.

## Serverless provider comparison

Rates below apply to custom deployments, not a provider's per-video model API.

| Provider | RTX PRO 6000 / hour | H200 / hour | B200 / hour | B300 / hour | What it means for Seed |
|---|---:|---:|---:|---:|---|
| Modal | $3.0312 | $4.5396 | $6.2496 | $7.0992 | Flexible hardware/topology experiments; CPU/RAM extra |
| Runpod Serverless, public listed worker rates | $3.49 | $5.93 | $8.64 | $9.98 | Familiar worker image; confirm active-worker quote separately |
| fal custom compute, list | $2.99 | $4.50 | $6.25 | $8.50 | Custom deployment access via sales/support; terms need confirmation |
| Comfy Developer Platform | $3.49 | $5.93 | $8.64 | Not quoted | Managed workflow deployment; storage separately priced |

Sources: [Modal](https://modal.com/pricing), [Runpod](https://www.runpod.io/pricing), [fal custom compute](https://fal.ai/pricing), [Comfy](https://comfy.org/pricing). Do not use negotiated “as low as” rates as personal pay-as-you-go quotes. Host resources/billing terms are not identical across providers.

At an unchanged 1,376-second HQ runtime, execution alone would cost about **$1.16 Modal / $1.33 Runpod / $1.14 fal custom**, using the RTX PRO 6000 rates. These are same-runtime estimates, not service benchmarks; same GPU family does not guarantee the same clocks or performance. Holding those workers for three hours gives $9.09 / $10.47 / $8.97 before respective extras—roughly twice the recorded Vast session price.

### Three distinct operating modes

1. **Scale to zero after each generation:** no GPU reservation during review, but each restart may require allocation/loading/warmup. With a 20-minute restart, even a three-minute renderer allows only about five outputs within three hours with ten-minute gaps.
2. **Warm worker for the session:** pay through review; acquire and initialize once, then accept jobs. Shut down explicitly at session end. Use this until a measured cold path is acceptable. A warm instance can still fail; readiness is not a permanent capacity guarantee.
3. **Shared model API:** provider manages a shared serving fleet; the user pays for output and applicable reference inputs, without a personal GPU reservation bill while reviewing. Queueing/latency still need measurement.

[Modal documents paid idle GPU reservation](https://modal.com/docs/guide/cold-start), plus `min_containers` and configurable idle retention. Persistent model files help with downloads but are not already-loaded GPU weights.

## Hosted APIs: exact quoted output prices

Standard H3, 768p with audio. Quotes checked September 15; no claim that different providers expose the same internal precision, scheduler or preprocessing.

| Service | 5-second output | 10-second output | 15-second output | Fit |
|---|---:|---:|---:|---|
| fal standard H3 | $0.30 | $0.60 | **$0.90** | Base model; reference endpoint available |
| fal standard H3 with custom LoRA | $0.375 | $0.75 | **$1.125** | Adapter list and mixed references accepted |
| MiniMax official H3 | $0.40 | $0.80 | **$1.20** | Reference video inputs billed additionally |
| Replicate H3 | $0.40 | $0.80 | **$1.20** | Standard hosted H3; no custom adapter parameter verified |

Sources: [fal reference model](https://fal.ai/models/minimax/h3/reference-to-video), [fal LoRA pricing](https://fal.ai/models/minimax/h3/reference-to-video/lora), [MiniMax official rate sheet](https://platform.minimax.io/docs/guides/pricing-paygo), [Replicate H3](https://replicate.com/minimax/h3).

For the current three-second video reference, MiniMax adds $0.24, making a 15-second result **$1.44**. Its audio input is free and the first five reference images are free. fal's base reference page lists five free images and $0.08 per extra image; the inspected fal pages do not state a separate reference-video surcharge. The table gives listed output charges, not a verified invoice with these exact inputs.

At 2K, standard fal/official/Replicate output pricing is $1.95 for 15 seconds; fal's LoRA endpoint quotes $2.4375. This is not the native 768p workload. fal documents its 2K/4K modes as upscaling a 768p base, so higher advertised dimensions alone do not prove more native detail.

[fal's LoRA API schema](https://fal.ai/models/minimax/h3/reference-to-video/lora/api) accepts adapter paths/scales plus images, videos and separate audio together. It does not establish that Seed's current adapter format/composition works unchanged, permit an arbitrary ComfyUI graph, or disclose a lossless execution guarantee. Private adapter access and provider retention need a suitable supported mechanism; do not assume a public URL is acceptable.

H3 Max's current fal promotion is $0.60 per 15-second 768p output, versus $1.20 list. It is post-trained and is **excluded from the quality-equivalent recommendation**. [H3 Max pricing](https://fal.ai/models/minimax/h3-max/text-to-video).

## Subscriptions

### Hailuo: lower amortized price, annual commitment

The live [Hailuo subscription page](https://hailuoai.video/subscribe), read through the browser on September 15, showed these annual options for standard H3:

| Annual option | Up-front annual payment | Monthly credits | Advertised 768p price per output second | Approx. 15s output cost at full credit use |
|---|---:|---:|---:|---:|
| Standard | $100.80 | 1,000 | $0.059 | $0.88–$0.89 |
| Pro | $364.80 | 4,500 | $0.047 | $0.71 |

The displayed output allowances imply approximately 105 credits per 15-second 768p output: nine whole outputs/month on Standard or 42 on Pro, before chargeable reference inputs or other uses. Fully consumed fractional-credit economics differ slightly from dividing the plan by whole completed clips. Underuse raises effective cost; annual price is not a cancel-anytime monthly quote. The displayed Pro plan allows two simultaneous tasks. A private LoRA import path was not verified. H3 was metered, not covered by the older models' unlimited label.

### Comfy Cloud: closest subscription option for full workflows

[Creator is $35/month](https://comfy.org/pricing), with custom model/LoRA imports, three concurrent API workflows and a 30-minute run limit. Pro is $100/month, five concurrent workflows and a one-hour limit. Supported nodes and private model import still need checking.

The [current cloud GPU meter](https://docs.comfy.org/tutorials/partner-nodes/pricing#cloud-gpu) is 0.266 credits/second. Using Creator's equivalent 7,400 credits/month and **assuming the measured Seed runtimes carry over**, HQ costs about **366 credits / $1.73 per 15-second attempt**, Fast about **246 credits / $1.16**. These are full-credit-use estimates; a single HQ attempt in an otherwise unused month still entails the $35 subscription. Runtime is unmeasured on this service. Review time does not consume GPU credits.

This addresses management and concurrency more directly than single-generation speed; the listed GPU is the same 96GB family as the current worker. Keep subscription GPU credits separate from the Developer Platform rate.

## Session economics and larger scale

Human review consumes no API inference bill. For example, **14 attempts** cost $12.60 on fal base, $15.75 with LoRA, $16.80 official base, or $20.16 official with the current three-second video reference. Completing 14 in three hours requires average total request latency no more than about 3m34s, assuming ten-minute gaps, no initial setup and no final review. This is a requirement to verify, not a claim about API latency.

At today's five-HQ-output session volume, five fal LoRA attempts cost $5.625 versus roughly $4.60 for a fully billed current three-hour rental: about **$1.03 more / 22%**, before reference surcharges, and subject to quality equivalence. The benefit is worthwhile only if latency and compatibility pass.

A one-B300 warm deployment budgets $21.30 GPU-only for three hours; eight B300s budget $170.38. For human-paced single outputs, the ten-minute warm gap on eight B300s alone costs over eight fal LoRA outputs.

For a continuous queue, eight H200s must finish each 15-second output in **under 111.5 seconds**, eight B300s in **under 71.3 seconds**, or four B300s in **under 142.6 seconds**, just to beat fal's $1.125 LoRA output charge on GPU execution alone. These thresholds assume near-100% utilization and exclude all overhead. Reference-input API fees would alter the threshold.

More GPUs can mean either several independent jobs (throughput) or several GPUs cooperating on one clip (latency). Eight independent workers do not automatically accelerate one clip; one eight-GPU worker does not automatically produce eight concurrent clips. Seed's single-engine serialized dispatch requires changes for independent cloud jobs.

## Concrete next decision gate

The latest user preference supersedes the earlier API-first recommendation. Choose a custom Modal deployment if the exact Seed workflow meets a ten-minute 15-second render target at acceptable cost and initial readiness. Keep Seed's UI, local Library, graph and adapters; add asynchronous dispatch to independent cloud workers.

Benchmark one B300, then one B200/H200 with unchanged generation settings. Cache dependencies and weights, initialize before the session where practical, retain the worker through review, and time allocation, loading, warm rendering and save separately. Test the actual 15-second mixed-reference workload. The current 20+ minute rental acquisition does not prove Modal cold readiness will also take 20 minutes; equally, serverless does not prove readiness will be fast. Report first-result latency as well as warm rendering.

The Runpod sentence about a four-bit build on one B300 comes from its [MiniMax M3 guide](https://www.runpod.io/articles/guides/run-minimax-m3-on-runpod), a different model. It is not evidence for H3 quality or deployment economics. Under the present requirement, four-bit is not the default.

No option has yet demonstrated quality-equivalent, sub-ten-minute 15-second Seed output with the exact private adapters in this session. A single warm GPU is now the relevant cost comparison. The current HQ runtime needs approximately a 2.3x improvement to reach ten minutes; Fast needs about 1.54x.

## Updated ten-minute target: session budget

Assume a ten-minute render and ten minutes of review between attempts. Nine completed clips fit in three hours when the worker is ready at the start; eight fit if initial readiness consumes twenty minutes. No review after the last output is required to count it. These are scenario calculations, not benchmarked throughput.

The following estimates include one GPU, four physical CPU cores and 96GiB host RAM using Modal Function rates. The host allocation is illustrative and must be sized in validation. They exclude extra startup outside the session, storage/egress/tax and free account credits.

| Single-GPU worker | Ten-minute render cost | Three-hour allocation | Cost/clip with nine outputs | Cost/clip with eight outputs |
|---|---:|---:|---:|---:|
| H200 | $0.92 | $16.49 | $1.83 | $2.06 |
| B200 | $1.20 | $21.62 | $2.40 | $2.70 |
| B300 | $1.34 | $24.17 | $2.69 | $3.02 |

The full three-hour budget includes review time. If capacity queueing is unbilled, actual allocated time may be shorter. In comparison, the historical Vast session costs about $4.60 for five HQ clips. The B300 scenario is about 5.3x the total session bill, with 1.6–1.8x the completed attempts; effective cost per output is about 2.9–3.3x higher. None of this establishes that B300 reaches ten minutes.

Deploy dependencies once, retain model files in persistent storage, keep one worker initialized through review, and scale to zero after the session. Allow a second independent worker for parallel jobs with its own allocation cost. Use a B200/B300 fallback pool only after both hardware types pass the same quality, runtime and compatibility checks. The current cu130 container needs a tested CUDA 13.1+ update for B300.
