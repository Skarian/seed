# Seed: multi-provider GPU orchestration review

2026-09-10. Research and code inspection, not a deployment or benchmark. No orchestrator installed, provider accounts changed, or paid compute started in this review. User wants the overall architecture evaluated without preference for any compute provider. This proposal supersedes the research assumption that the next step must be R2 or Modal; it does not replace the working RunPod deployment yet.

## Recommendation

Evaluate **dstack first with a single session worker**, with **SkyPilot as the comparator** if the first proof exposes deployment or connectivity limitations. Both are credible open-source alternatives to writing provider adapters ourselves. Do not adopt both, build a universal provider SDK, or add a separate object-storage account before measuring the existing Hugging Face path.

This is a recommendation for a bounded experiment, not a claim that dstack is proven with our models. Its fit is the container/task/port-forwarding model and a controller that can run beside Seed. SkyPilot is stronger when explicit ordered placement, managed batch recovery, or broader cluster operations become the deciding requirement. Neither automatically solves file durability, slow model downloads, or the semantics of ComfyUI's asynchronous queue.

## Desired experience and ownership

User presses Generate. Seed saves inputs, obtains one compatible worker through the orchestrator, waits for required model preparation, submits the existing workflow, retrieves outputs durably, and releases compute after a short safe idle period. Capacity waiting is visible and cancellable; neither platform creates capacity guarantees.

| Responsibility | Owner |
|---|---|
| Forms, workflow compilation, LoRA modes, media library | Existing Seed application |
| Durable job identity, progress, uncertain submission, receipts | Existing Seed server/worker protocol |
| Provider credentials, offers, provisioning and capacity retries | One selected orchestrator |
| When a session is safe to stop | Seed, using job state and durable receipt evidence |
| Pinned model origin | Hugging Face; Civitai for owner LoRAs |
| Model cache | Worker disk; optional provider-local persistent cache when useful |
| Permanent inputs, results and history | PC filesystem and existing SQLite database |

Provisioning and execution retries are different. Retry a failed capacity request within a bounded window. Do not blindly resubmit an uncertain generation on a new machine: an output may already exist and a second attempt can duplicate work and billing. Require confirmed old-worker termination before provisioning a replacement under the one-GPU policy.

## Evidence-based comparison

| Concern | dstack | SkyPilot |
|---|---|---|
| Coverage | RunPod, Vast.ai, Nebius, major clouds and SSH fleets | RunPod, Vast.ai, Nebius, major clouds and Kubernetes among supported infrastructure |
| Deployment | Custom image plus commands; task ports forwarded through SSH | Unified YAML/Python task definitions; custom runtime images with backend-specific requirements |
| Placement | Backend/resource filters and maximum hourly instance price; configurable capacity retry | Optimizer-selected `any_of` or explicit `ordered` resource candidates |
| Local operation | Server supports WSL2/Docker on Windows; local SQLite state; CLI/HTTP API | WSL installation path and API/CLI; plain launches do not require SkyServe |
| Managed serving | Basic service proxy in server; gateway required for WebSockets and autoscaling | SkyServe normally adds a cloud controller VM and load balancer; controller consolidation is also documented |
| Storage | Network volumes remain bound to backend/region; instance-volume feature excludes RunPod/Vast | Cloud bucket mounts/copies and provider-specific storage, not a universal shared disk |
| Shutdown | Fleet idle settings are not a substitute for application idle; container backends have exceptions | Cluster/job/service lifecycle is not aware of Seed output receipts |
| Main fit | One container session controlled by our existing app | Broader placement policies and managed jobs |

Sources: [dstack backends](https://dstack.ai/docs/concepts/backends/), [tasks](https://dstack.ai/docs/concepts/tasks/), [installation](https://dstack.ai/docs/installation/), [presets](https://dstack.ai/docs/reference/dstack.yml/preset/), [SkyPilot repository](https://github.com/skypilot-org/skypilot), [YAML](https://docs.skypilot.ai/en/latest/reference/yaml-spec.html), [installation](https://docs.skypilot.ai/en/latest/getting-started/installation.html), [SkyServe](https://docs.skypilot.ai/en/latest/serving/sky-serve.html).

Both projects have live documentation and public source; no comparative reliability or support-quality measurement was performed. Neither reviewed backend list establishes native Modal or consumer Colab support. Supporting an arbitrary VM provider is not the same as wrapping every serverless platform. Provider accounts, quotas and billing remain separate.

## Findings that change the initial recommendation

1. **Avoid HTTP-traffic-driven scaling for the first integration.** Seed's prompt call returns before generation finishes. Low HTTP traffic does not imply an idle GPU; status polling can conversely keep a traffic-based service alive. Use a single task/session worker and explicit lifecycle calls. The job queue stays in Seed.
2. **dstack does not need a gateway for the proposed first proof.** Task port forwarding can carry the existing HTTP worker API. The basic service proxy has path-prefix and authentication considerations; its gateway is required for WebSockets/autoscaling. Seed currently polls its worker, so neither is a prerequisite. Test the forwarded route rather than assuming another proxy will fix uploads. [Services](https://dstack.ai/docs/concepts/services/)
3. **Do not trust generic idle defaults.** dstack fleet idle can default to three days, and service/run idle-duration settings do not apply to container-based RunPod/Vast backends. A running ComfyUI process is still an active task when its generation queue is empty. Stop the session explicitly and verify the provider resource is gone. A maximum run duration is useful as a disclosed backstop, but can interrupt work and excludes provisioning/pulling. [Fleets](https://dstack.ai/docs/concepts/fleets/), [preset limits](https://dstack.ai/docs/reference/dstack.yml/preset/)
4. **A controller is a real dependency.** Proposed local dstack uses WSL2 or Docker and its own persistent SQLite state. No Postgres, Kubernetes, cloud gateway, telemetry stack or public home endpoint is required for this experiment. PC shutdown also stops its local controller; that does not establish that remote billing stops. Test this failure explicitly. [Server deployment](https://dstack.ai/docs/guides/server-deployment/)
5. **Provider storage is still provider storage.** dstack network volumes currently support AWS/GCP/RunPod/Kubernetes; its instance-volume feature excludes RunPod/Vast. That does not mean containers have no writable disk, but means we cannot promise a portable persistent cache using that feature. [Volumes](https://dstack.ai/docs/concepts/volumes/), [SkyPilot cloud buckets](https://docs.skypilot.ai/en/latest/reference/storage.html)

## Current-code changes, if the proof succeeds

- `server/worker.ts`: endpoint validation currently permits only RunPod's port-8080 proxy host and a loopback test exception. Add a managed local-forward connection mode bound to an orchestrator run identity; do not simply allow arbitrary URLs. Keep worker authentication, engine sessions and output receipts. Automate credential establishment over the trusted forwarded route so managed sessions do not require manual pairing each launch.
- New small `server/compute.ts`: translate ensure/status/stop to the chosen orchestrator, persist its run ID, reconcile before creating, and expose pending/preparing/ready states. This is one orchestrator integration, not one adapter per GPU vendor. Do not treat listing an offer as reserving capacity or an hourly cap as a total-spend cap.
- `server/jobs.ts`: request compute when local work is queued; stop only after paused dispatch, no running/uncertain work and durable output receipt. Preserve existing job IDs and restart reconciliation. A second click must not create a second worker.
- `worker/run.py`: replace the unconditional mount requirement with an explicit writable local-cache mode; retain the existing network-volume mode for rollback. Keep pinned dependencies and invoke the Python supervisor explicitly from the orchestrator configuration. Verify the image's shell/SSH/CUDA compatibility instead of assuming its Docker CMD is sufficient.
- `worker/prepare.py` / manifest: retain pinned authenticated HF downloads and verification; prepare the selected workflow dependency set instead of blocking on all 99.62 GB. Use bounded concurrency with the current HF/Xet client and honor retry delays. No new home-hosted artifact service.
- `worker/preset.py` and setup: replay owner LoRA configuration on replacement workers. Do not strand the only authoritative preset on the old network volume.
- Shutdown/spool: a disposable cache cannot preserve unsaved results after provider termination. During a live session keep pending results until the PC confirms receipt. If the PC disappears, retain them and report the cost/durability tradeoff; a finite timeout cannot promise indefinite recovery. This owner-visible policy must be settled before unattended shutdown is shipped.
- `server/cli.ts` / setup: optional orchestrator installation/configuration and startup integration. Keep npm-delivered Seed and PC media locations. Jupyter remains optional administration, not an authentication dependency or a reason to add a public gateway.

No new frontend workflow engine, media database, distributed lock service, Terraform, container registry, model mirror, or AI-agent runtime is needed.

## Cost and performance experiment

Total session cost = billed provisioning/setup + model transfer/verification/loading + generation + retained idle compute + storage/egress/controller charges. Cheapest hourly GPU is not necessarily cheapest completed session. For each run record these durations separately and the provider-reported charges where available. Catalog-derived estimates must be labelled estimates.

Use one verified compatible GPU at a time. Prefer the 96 GB RTX PRO 6000 class; H200 is another candidate; H100 is eligible only after the chosen workflow is validated within its 80 GB and supported kernels. Catalog names differ by provider and orchestrator, so resolve actual offers before writing final configs. Start with on-demand offers and two owner-enabled providers, not every backend at once. No fabricated availability or throughput targets.

1. **Local proof, no compute:** install one pinned dstack release in an isolated WSL2/Docker environment; test authenticated API access, restarts, persistent state and control from Windows Seed. Check the corresponding pinned schema for price/resource/retry controls. Do not expose the controller on the LAN.
2. **Small connectivity proof:** deploy a tiny pinned container on one approved provider; prove request/response, realistic large upload and interrupted Range download over the forwarded route. Stop and verify deletion. If this fails, investigate before downloading models. This is particularly important after the inconclusive home-to-RunPod benchmark.
3. **Real image proof:** launch the existing worker with local-cache mode, fetch only image dependencies, submit one existing workflow, save/acknowledge output and terminate. Measure cold and reused-session behavior. No new UI yet.
4. **Cross-provider proof:** run the same configuration on a second enabled provider; test a controlled unavailable candidate to demonstrate bounded fallback. At least three fresh launches per provider, spread across two times, one active GPU total. Report samples, not an availability percentage. If blocked by a dstack limitation, compare the same bounded case in SkyPilot rather than deploy both permanently.
5. **Video and failure proof:** validate the larger reference-video workflow, LoRA mode, progress, interrupted PC transfer, controller restart and pending-output recovery while the worker still exists. Do not claim recovery after disposable storage destruction. Verify stopped resources and charges.
6. **Owner checkpoint:** show click-to-result time, complete-session cost, added local processes, setup steps and recovery behavior. Only then choose the orchestrator and update the application deployment path.

Before paid work: confirm provider credentials/billing for the selected pair, HF gated access, existing Civitai credentials, a numerical hourly and experiment-total budget, and the pending-output shutdown policy. Existing RunPod access alone is insufficient for a two-provider proof. This research does not start that deployment or ask the owner to fund every provider.

## Decision status

High confidence that existing orchestration software can replace bespoke vendor provisioning. Moderate confidence that dstack's session-task model is the leanest fit for Seed, pending transport and lifecycle proof. No measured confidence claim about GPU availability, sub-two-minute startup, or cost savings. Keep the current operational path until the proof passes; do not delete the network volume or migrate all models merely because the architecture is promising.
