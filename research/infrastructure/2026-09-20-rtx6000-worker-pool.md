# RTX PRO 6000 pool for Seed

Research date: September 20, 2026. No rentals, deployments, generation requests,
or changes to the existing GPU/app were made for this research. Marketplace
discovery was read-only. All dollar amounts are USD before tax.

Archive note: the B200 experiment is preserved at
`archive/b200-experiment-2026-09-20` (commit `5c9e6e0`). Its runtime changes were
not merged into `main`; this report is retained to guide future RTX pool work.
The separate RTX rental used for the quoted rate was subsequently destroyed
with its disposable disk at the owner's request. References to that rental
below describe the research-time snapshot, not a currently active instance.

## Recommendation

Use independent, single-GPU H3 workers, initially capped at two, with a four-worker
burst option for prepared batches. Preserve the existing pinned Comfy workflow,
INT8 ConvRot weights, selected LoRAs, 30-step HQ schedule and output dimensions.
Keep image work separately schedulable. A pool makes several takes available
sooner without adding an inference approximation. Each individual video still
takes its own full generation time.

For the current app, a small Vast worker pool is the closest implementation path.
For a managed autoscaler, evaluate Vast Serverless first on price; retain Modal as
the alternative if its measured startup/reliability and simpler operations justify
the premium. Neither is already integrated. The existing personal studio should
not keep four GPUs idle throughout review just because four are available.

This is a research recommendation, not an approved implementation or spending plan.

## Definitions and measured baseline

- **Independent pool:** each GPU owns a full model and renders a different take.
  Workers can live on different hosts; only references and output files move
  between them and Seed. Their VRAM does not combine for one job.
- **Several GPUs for one take:** tensor/sequence parallelism divides inference
  across devices and repeatedly exchanges intermediate tensors. This needs a
  compatible inference runtime and a suitable interconnect/topology. Arbitrary
  Internet-connected marketplace rentals are suitable for independent jobs,
  not the first choice for that tightly coupled computation.

Use the measured RTX PRO 6000 HQ + adapter mixed-reference case: **1,377.525 seconds
(22m 58s)** for a 15-second native 1344 x 768 clip with audio. It used a 440 W
Workstation card. The newly connected 600 W card has not been benchmarked; no
speed improvement is assumed. The planning rate is the current rental's
**$1.533333/hour including 180 GB disk**. See the
[live validation and configuration caveats](../development/2026-09-20-b200-live-validation.md).

Today's CLI search returned 21 verified one-GPU offers, 20 at or below $2/hour
including the requested disk; 14 of those advertised at least 500 W. Examples:
Idaho $1.30/hour at 575 W, Minnesota $1.3667 at 600 W, Michigan $1.55 at 600 W.
These differ in download speed, power limit and reliability and are not guaranteed
future inventory or proof that a same-host multi-GPU bundle is available. Private
snapshot: `.local/rtx-pool-research/offers.json`.

## Independent pool economics

Assume eight independent takes are ready to submit, every worker matches the
measured runtime, and workers have already started. This is calculated scaling,
not a measured multi-worker run.

| H3 workers | Pool hourly rate | Time for eight 15s takes | Generation cost for eight | Per take |
|---|---:|---:|---:|---:|
| 1 | $1.53 | 3h 04m | $4.69 | $0.59 |
| 2 | $3.07 | 1h 32m | $4.69 | $0.59 |
| 4 | $6.13 | 46m | $4.69 | $0.59 |

Cost = total executed GPU-seconds x rate / 3600. Startup, transfers, idle time,
failed/repeated attempts and any separate image worker are additional. A failed
take still costs money; these are costs per generated attempt, not approved shot.

For context, eight serial warm B200 jobs at the tested configuration and rate
would take about 2h 16m and cost $14.24. Four RTX workers have approximately the
same combined hourly price as that B200 and roughly three times its aggregate
throughput on these measurements. This is not a claim about an optimized B200.

### Holding the whole pool through a studio session

| Workers retained | 3 hours | 4 hours | Ten idle minutes |
|---|---:|---:|---:|
| 1 | $4.60 | $6.13 | $0.26 |
| 2 | $9.20 | $12.27 | $0.51 |
| 4 | $18.40 | $24.53 | $1.02 |

These fixed-session prices already include any review inside those hours. Do not
add review time a second time. At twelve four-hour sessions/month, retaining one,
two or four workers for every session would cost about $74, $147 or $294 before
transfers/startup outside the session. Scaling extra workers down reduces this.

## Ten minutes of review and prompting per attempt

Two different creative patterns need different capacity:

1. **Each next prompt depends on the previous result.** One iterative chain takes
   about 33 minutes per attempt: 23 rendering plus 10 reviewing/prompting. A second
   independent worker helps only when there is another shot/take ready to render.
   One rented GPU costs about $0.84-$0.85 per such cycle before startup/transfers.
2. **Independent shots let human work overlap rendering.** Ten minutes of attention
   per attempt gives an ideal ceiling of six processed attempts/hour. One H3 GPU
   produces about 2.61/hour; two produce 5.23/hour; four produce 10.45/hour.
   Two workers are close to balanced. A third can remove residual GPU waiting in
   a well-fed pipeline, but four need an existing backlog or less attention per take.
   These are steady-state bounds, not promises of completed work within a finite
   session; startup, first-result delay and editing reduce output.

For example, rendering four takes together uses about $2.35 of generation.
Reviewing those four for 40 minutes while all four GPUs remain idle adds $4.09,
making the total $6.44, or $1.61/attempt. Releasing those extra workers before
review avoids that GPU idle charge. If useful queued work continues while review
happens, it is productive render time rather than idle overhead.

## Startup is still part of the bill and the wait

A four-worker pool can repeat image pulls, model downloads and initialization four
times. Parallel recruitment is not a guarantee of parallel readiness. A pool alone
does not eliminate the user's acquisition complaint.

At the planning rate, five paid startup minutes add $0.13 per worker. If a fresh
worker also downloads the full 101.48 GB at the current host's $0.00390625/GB,
that adds about $0.40, excluding the container image and outputs. This illustrative
cold overhead is about $0.52/worker. For eight takes it makes the 1/2/4-worker totals
approximately **$5.22/$5.74/$6.79**, before other costs. Five minutes is an assumption,
not a measured readiness guarantee; at twenty paid minutes the startup compute
alone is $0.51/worker. Providers differ in when compute billing starts.

Reduce unnecessary preparation: the repository manifest contains about 19 GB of
Krea base components and about 54 GB for one H3 route plus its encoder and VAEs.
An H3 Ref worker need not fetch Krea, the H3 FL checkpoint or unused acceleration
adapters. Keep requested LoRAs versioned and cached. This changes preparation,
not generation quality. Both routes remain available through separate workers
or deliberate loading when requested.

## Serverless provider comparison

Same 1,377.525-second inference time assumed everywhere, solely to compare rates.
No Modal or RunPod speed/cold-start benchmark was performed with this setup.

| Option | Compute rate per worker | One 15s HQ attempt, execution only | Eight attempts |
|---|---:|---:|---:|
| Vast dedicated, current quote | $1.53/h including disk | $0.59 | $4.69 |
| Vast Serverless, if recruited at that same total rate | Marketplace-dependent | ~$0.59 | ~$4.69 |
| Modal RTX PRO 6000, GPU only | $3.0312/h | $1.16 | $9.28 |
| Modal, GPU + illustrative 4 physical CPU cores/96 GiB RAM | $3.9871/h | $1.53 | $12.21 |
| RunPod Flex RTX PRO 6000 96 GB | $3.49/h, storage additional | $1.34 | $10.68 |

The Modal host allocation is an example, not a measured requirement; actual
requested/used CPU and RAM affect billing. Quotes exclude plan credits. Sources:
[Modal prices](https://modal.com/pricing), [RunPod prices](https://www.runpod.io/pricing).

Vast says its serverless GPU rates match its marketplace instance rates. Ready
and Loading workers incur compute/storage/bandwidth charges; Inactive workers
incur storage/bandwidth but no GPU compute charge. Therefore a ready but idle pool
still costs money. The example above assumes the same recruited rate, not a fixed
serverless SKU or reservation. [Vast billing states](https://docs.vast.ai/guides/serverless/pricing).

Vast already documents a ComfyUI JSON worker, including a model-specific startup
benchmark. Its published example is Wan, so Seed's H3 graphs, private adapters,
provisioning and representative performance score need a custom integration.
[ComfyUI worker](https://docs.vast.ai/guides/serverless/comfyui-wan-2.2).

RunPod Flex scales to zero, but bills initialization/model loading, execution and
the idle timeout (default five seconds). It also charges for container/network
storage. [RunPod billing](https://docs.runpod.io/serverless/pricing).

Modal supports RTX PRO 6000 and independent function replicas with maximum/minimum
counts and a scale-down window. Its multi-GPU-count documentation does not list
RTX PRO 6000 among the types with a confirmed maximum count; do not assume an
eight-RTX single container is available. Independent one-GPU replicas are the
pool under discussion. [GPU support](https://modal.com/docs/guide/gpu),
[scaling controls](https://modal.com/docs/guide/scale).
Retained idle GPU resources are billed. GPU snapshots are alpha, generally
incompatible with multi-GPU programs, and do not remove storage-bandwidth-limited
model loading. They are a possible initialization optimization, not evidence of
instant H3 startup. [Cold starts](https://modal.com/docs/guide/cold-start),
[snapshot limits](https://modal.com/docs/guide/memory-snapshots).

With only ten minutes of idle review per 23-minute generation, the cheap dedicated
RTX cycle (~$0.84) is still below Modal's execution-only GPU charge (~$1.16) and
RunPod Flex (~$1.34). At equal inference speed, Modal GPU-only reaches cost parity
after about 22 minutes of dedicated idle time per clip; the illustrated Modal
host allocation raises that to about 37 minutes, and RunPod Flex to about 29.
Serverless startup/storage raise those thresholds. This comparison assumes the
rented GPU would otherwise remain billed through the gap; shutting it down changes
the comparison. Serverless can still earn its premium through provisioning and
operational benefits or better measured performance.

## Published multi-GPU evidence: useful, but different workloads

### SGLang: RTX scaling has diminishing returns

SGLang publishes VDN-H3 results on 1/2/4/8 RTX PRO 6000 Blackwell Server cards:

| GPUs | Denoise + decode |
|---|---:|
| 1 | 180.6 s |
| 2 | 118.0 s |
| 4 | 68.6 s |
| 8 | 46.6 s |

This is a **different VDN checkpoint, MXFP8, 345 frames (14.375s), eight forwards**,
not our HQ recipe; these sums exclude other request stages. Their eight-card run
spends 54% of GPU time in all-to-all communication, and a same-switch pair performs
better than a pair crossing the CPU root complex. It demonstrates topology and
communication costs, not a forecast for our clips. At equal per-GPU rates, the
listed stages use approximately 1.0/1.31/1.52/2.06 times the one-GPU cost.
[SGLang benchmark](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3#vdn-h3-on-rtx-pro-6000).

### RunningHub: fast headlines include a changed recipe

RunningHub reports 15-second text-to-video in 48.2s and two-image reference video
in 73.0s on eight RTX 6000D cards. These use four steps and its internal acceleration
weights; those weights are not public. Its published recipe combines tensor/sequence
parallelism, reduced-step models, SageAttention, Cache-DiT and compilation. Their
five-second BF16 50-step baseline already uses eight GPUs and takes 348.8s, so the
headline 12.2x result is not the gain from changing one GPU to eight. This evidence
does not meet the requirement to preserve Seed's current HQ workflow and quality.
[RunningHub methodology](https://github.com/RH-RunningHub/MiniMax-H3-MultiGPU-Lightning).

No matched public 15-second, mixed image/video/audio reference, existing LoRA,
30-step INT8 ConvRot/Sol benchmark on 2/4 RTX cards was found in this search.

For one distributed clip to equal our $0.59 generation cost at equal card rates,
two GPUs must finish in at most **11m 29s**, four in **5m 44s**, and eight in
**2m 52s**, before extra startup/communication/idle overhead. A sub-ten-minute clip
could justify some premium, but it requires measuring the same accepted recipe.

## Minimum app work

The present app has one saved worker connection; operations reserve one tunnel
at port 18080 and reject a second active Vast allocation. The B200 branch adds
two engines inside one rental, not a pool of remote RTX workers. See
`operations/connection.mjs`, `operations/vast.mjs`, `server/worker.ts`,
and `server/jobs.ts` on `main`; the B200-specific `worker/engines.py` is retained
only in the archived experiment.

For a small dedicated pool, keep local SQLite and add a worker registry, distinct
tunnel endpoints, per-worker capabilities and a durable assignment per job attempt.
Reuse existing request snapshots, idempotency, output verification and recovery.
Submit compatible work to each free worker; bind cancellation and recovery to
that job's worker. One worker's disconnect must not pause all others. Do not run
several app processes against the same Library database.

A serverless adapter additionally needs durable batch acceptance while no worker
exists, provider call IDs, private reference/output storage and result syncing.
Saving verified outputs must precede releasing a worker. The local editor can own
projects and selections; a cloud ledger is needed only if orchestration should
continue independently of the PC. No managed database is required merely to test
two local-controlled dedicated workers.

Initial operating policy:

- Two H3 slots for normal batch work; burst to four only for a prepared backlog.
- Preserve one image worker when immediate image generation is needed alongside
  fully occupied H3 workers. It is additional capacity and cost, not hidden in the
  video tables. Otherwise schedule image bursts between video batches.
- Group by base route and LoRA combination, with an interactive priority queue.
  Apply adapters per job or reuse a verified patched-model cache; do not share
  mutable adapter state between simultaneous generations.
- Cache only relevant verified weights. Reuse busy workers for compatible queued
  jobs; release extra workers when their queue drains and outputs are safe.
- Measure acquisition, preparation, first inference and warm inference separately.
  Cap total workers and spending across model families. Consider session retention
  only with explicit user-visible billing; a worker waiting for review is not free.

**Decision:** independent RTX workers have credible batch economics now. Start
with two render slots in the design; four is a burst capacity. Splitting a single
clip across GPUs remains a separate benchmark and integration question.
