# Modal vs fal Serverless for the personal Seed studio

> **Historical research:** retained as a September 2026 snapshot. For the latest
> direction, see the [RTX worker-pool analysis](2026-09-20-rtx6000-worker-pool.md)
> and [measured B200 findings](../development/2026-09-20-b200-live-validation.md).
> Prices, assumptions and recommendations below reflect the research dates.

September 19, 2026. Research and recommendation only. No deployments or paid requests performed.

## Decision

Start with Modal for a personal studio used for 3–4 hours a few times weekly. fal Serverless is a credible alternative for the same private workflows, not merely a marketplace API. The decisive advantages for Modal today are self-service access, published small-GPU choices, and a clear low-volume plan. There is no matched benchmark establishing that Modal starts or renders Seed faster.

fal's documentation labels custom Serverless an enterprise feature with an access-request step. Its advertised low rates are not a quote for this account; minimum spend, discounts, storage, transfer and hardware entitlement remain unverified. A competitive low-volume offer plus demonstrably faster startup could change the recommendation. [fal access and deployment](https://fal.ai/docs/documentation/serverless), [Modal billing](https://modal.com/docs/guide/billing).

## Fit for the application

Both can host custom code and weights. Use one private worker pool per model family/compatible runtime: Krea 2 images, MiniMax H3 video, YuE2 music. LoRAs remain versioned inputs to jobs; avoid permanently reserving a GPU for every adapter. Keep the editor, project database, job ledger, original media and model recipes under the app's control.

fal provides custom containers and an official ComfyUI endpoint example. Its queue, client SDK, runner lifecycle controls and media handling make it a strong inference backend. This does not validate Seed's current kernels, private adapters or YuE2 extensions automatically. [ComfyUI example](https://fal.ai/docs/examples/image-generation/deploy-comfyui-server), [custom Serverless](https://fal.ai/docs/documentation/serverless).

Modal provides general Python functions and independent GPU/CPU execution, suited to the render workers plus CPU preview/export jobs. Its documented hardware choices include L4, A10 and L40S as candidates for smaller models, as well as H200/B200/B300 for H3. Hardware choice still requires compatibility and timing tests. [GPU guide](https://modal.com/docs/guide/gpu).

fal has a useful best-effort routing-hint facility: a request can prefer a runner with a matching model/cache state. A model-and-adapter key could exploit this after safe adapter caching is implemented. It is not guaranteed affinity or an automatic LoRA loader. [Routing hints](https://fal.ai/docs/documentation/development/advanced/optimize-routing-behavior).

Both need changes to Seed's current single-worker architecture. `server/worker.ts` restricts the production connection to the SSH loopback endpoint, and the queue dispatches through one engine. A fal Comfy tutorial does not remove the need for a cloud execution adapter, independent job claims, durable output storage and the director's shot/take/dependency logic.

## Published rates and conditional budget

USD, no negotiated discounts. Modal column is GPU only; fal publishes a machine-type rate with CPU/RAM specifications. Its billing documentation describes machine-time billing, not separate CPU/RAM metering. Confirm the package and extra charges in an account-specific offer.

| Hardware | Modal GPU/hour | fal listed/hour |
|---|---:|---:|
| RTX PRO 6000 | $3.03 | $2.99 |
| H200 | $4.54 | $4.50 |
| B200 | $6.25 | $6.25 |
| B300 | $7.10 | $8.50 |

Modal separately meters CPU and RAM. Four physical cores plus 96 GiB add approximately $0.956/hour; these are illustrative allocations, not measured requirements. fal lists B200 host resources as 19 CPUs and 210 GB RAM, so these examples are costed configurations, not identical host-resource benchmarks. [Modal rates](https://modal.com/pricing), [fal rates](https://fal.ai/pricing), [fal machine specifications](https://fal.ai/docs/documentation/deployment/machine-types), [fal billing](https://fal.ai/docs/documentation/serverless/pricing).

**Assume each 15-second clip takes ten minutes on one B200. This is a planning target, not a verified runtime on either provider.**

| H3 scenario | Modal with example host | fal at listed machine rate |
|---|---:|---:|
| One clip's execution | $1.20 | $1.04 |
| Eight clips' execution | $9.61 | $8.33 |
| One worker retained for 3 hours | $21.62 | $18.75 |
| One worker retained for 4 hours | $28.82 | $25.00 |

Execution rows exclude startup and idle; session rows include review/prompting idle inside that reservation. All exclude image/music generation, storage, transfer, control services, retries, tax and any contract fees. Startup outside the session adds time. Multiply running-worker time, not editor time: a second H3 worker kept alive for the whole session doubles its compute reservation.

For 12 eight-clip batches per month, video execution is roughly $115 Modal / $100 fal before credits and overhead. Modal currently includes $30 monthly compute on Starter: allocating that entire credit here produces about $85. It is one shared credit across all models, not $30 for each pool. [Modal plan](https://modal.com/pricing).

One worker can finish eight ten-minute jobs in 80 minutes; two independent workers can finish in about 40 minutes once ready, with the same 80 GPU-minutes of useful execution. Startup, idle and shared bottlenecks can increase the actual cost. Two independent jobs are a different design from splitting one inference across two GPUs.

## Review time and cold starts

Both bill retained GPU capacity during review. fal bills setup, idle, processing, draining and teardown; pending allocation and image pulling are unbilled. Modal bills reserved GPUs and occupied/requested resources while idle. Thus serverless does not mean keeping a loaded model available for free. [fal billing states](https://fal.ai/docs/documentation/serverless/pricing), [Modal warm containers](https://modal.com/docs/guide/cold-start).

For this personal studio, drain ready batches while reviewing completed takes. Retain one worker for the model being actively iterated only when its startup delay justifies that cost. Release burst workers when their queues empty and all warm floors at session end. Configure bounded retries; don't run an entire session as one all-or-nothing inference request.

Neither provider establishes a guaranteed replacement for the current 20+ minute acquisition process. Prebuild dependencies and stage weights before the session; then measure allocation, model loading, inference and upload separately.

- fal's optimized WAN 2.1 example measured about 96 seconds of repeat setup and 115–267 seconds from spawn to healthy, with allocation contention affecting the spread. Its first version preparation took roughly nine minutes using a warm platform download cache. These are vendor measurements for WAN, not a prediction for H3 or Seed. [Measured example](https://fal.ai/docs/examples/serverless/cut-cold-starts).
- Modal's GPU snapshots are alpha, generally incompatible with multi-GPU code, and do not remove storage-bandwidth-bound model loading. They should not be used to promise instant loading of Seed's models. [Snapshot limitations](https://modal.com/docs/guide/memory-snapshots).
- fal persists weights in account-wide `/data`; Modal uses persistent Volumes. Files on disk are distinct from loaded model state. [fal storage](https://fal.ai/docs/documentation/development/use-persistent-storage), [Modal Volumes](https://modal.com/docs/guide/volumes).

Modal GPU Functions can be preempted and restarted; its non-preemptible option is not supported for GPUs. This is a reason to persist individual outputs and make retries safe. No comparative interruption rate was established for fal. [Modal preemption](https://modal.com/docs/guide/preemption).

## Quality and larger GPU combinations

Provider choice does not inherently require a quality compromise. Preserve accepted weight hashes, precision, private adapters, reference handling, frame count/resolution, sampler and step counts. Current Seed already uses an INT8-based recipe and sparse-attention HQ settings; preserving that accepted recipe is different from claiming full dense BF16 equivalence. Hardware/runtime changes still need output review.

Both offer multi-GPU execution. Modal explicitly supports up to eight of the relevant datacenter GPUs per container and notes that requests above two usually wait longer. fal exposes `num_gpus` and distributed workers, but this review did not establish an account-specific H3 allocation or topology. Extra GPUs alone do not make the current Comfy graph distribute itself. [Modal GPU allocation](https://modal.com/docs/guide/gpu), [fal distributed execution](https://fal.ai/docs/documentation/serverless/distributed/overview).

Keep the proposed initial ceilings: one Krea worker, two independent H3 workers, one YuE2 worker. Test one H3 worker first. The ten-minute target and no added quality compromise determine acceptable configurations; measured cost per completed take chooses among them.

## What would change the decision

Choose fal if it grants access on terms suitable for intermittent personal use and demonstrates materially better time to first take or total cost using the same recipe. Its media-focused queue, telemetry and cache-aware routing are useful even with private models.

The concrete comparison should freeze a representative 15-second mixed-reference H3 request with the private LoRA, run cold and warm jobs, test two independent jobs, then repeat after a ten-minute review gap. Measure time to usable output and billed worker seconds across the entire batch. A faster marketplace H3/Max endpoint is not evidence for the same speed in an unchanged custom deployment.

The provider-neutral worker contract in the director architecture keeps this choice reversible. Implement one provider first; do not operate two complete platforms merely to chase a small published hourly-price difference.
