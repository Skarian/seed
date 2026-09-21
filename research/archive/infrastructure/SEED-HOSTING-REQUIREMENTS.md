# Seed hosting: implementation and procurement requirements

Reviewed 2026-09-10 against the current repository, live read-only RunPod template, and public API contract. No compute, storage, account, or application changes made in this review.

## What we actually need

Seed is a Windows Node application that keeps permanent media and job history on the PC. The remote component is a Linux AMD64 container running a Python supervisor, private ComfyUI, and Jupyter. It is a long-lived asynchronous job worker, not a synchronous inference endpoint. Only one GPU and one generation run at a time are needed.

| Requirement | Evidence and qualification |
|---|---|
| One full NVIDIA GPU | Current tested hardware is RTX PRO 6000 Blackwell 96 GB. H100 80 GB and H200 are candidates, not benchmark-equivalent substitutes. Do not buy an eight-GPU node or a fractional 24/48 GB instance by confusing family name with instance configuration. |
| CUDA-compatible host | `worker/Dockerfile` pins PyTorch 2.11.0+cu130. CUDA 13.x normally needs driver branch 580 or later; verify actual model kernels on the selected GPU. No evidence requires specifically CUDA 13.2. |
| CPU/RAM | Code sets no minimum CPU/RAM and we have no measured host-memory peak yet. Previously working pod had approximately 188 GB host RAM. A proposed 80 GB RAM machine is unproven, not automatically insufficient. Disk model size cannot be used as RAM requirement. |
| Model disk | Eleven pinned manifest files total **99,624,767,830 bytes (99.625 GB / 92.78 GiB)**, plus selected content LoRAs, metadata, temporary inputs/outputs and working headroom. Current 150 GB model volume is a useful baseline. Container image storage is separate. |
| Container filesystem | `/opt/venv`, `/ComfyUI`, `/opt/seed`; writable workspace defaults `/workspace`. `worker/run.py` currently refuses to start preparation unless workspace is a mount. |
| Connectivity | PC initiates authenticated HTTPS requests to worker 8080. Comfy 8188 stays loopback. Jupyter 8888 is administrative, with separate token. Worker status, uploads and resumable output downloads must work—not just a health check. |
| Secrets | Pairing secret, HF token, Jupyter token; Civitai token for selected presets. Runtime injection only. No credentials in published image. |
| Model sources | Current boot sequentially prepares **all 11 files**, even for an image-only job. Uses pinned HF revisions, size and SHA256 verification, resumable staging and warm receipts. Content preset activation is separate; must preserve/replay it if storage changes. |
| Data safety | PC permanently owns inputs/results/history. Remote spool retains outputs until durable PC receipt. Destroying disposable worker storage can lose unreceived outputs, even when model storage itself is reproducible. |

Sources: [worker image](../../worker/Dockerfile), [supervisor](../../worker/run.py), [manifest](../../worker/models.json), [preparation](../../worker/prepare.py), [preset acquisition](../../worker/preset.py), [worker connection](../../server/worker.ts), [NVIDIA CUDA compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html).

## Existing workload evidence, not guesses

The execution journal records successful runs on the 96 GB RTX PRO 6000:

- Image: first generation 41.73 s, warm adapter generation 2.67 s. 18,325 MiB observed after execution was resident memory, **not peak**.
- Video: 5 s text-only 183.70 s including loading; 5 s mixed-reference 265.82 s; 15 s portrait 476.51 s.
- Mixed-reference proof used image, video with paired audio, and standalone audio. 15 s proof was text-only. **Maximum references combined with 15 s is not validated.**

The newer native Comfy measurements are implemented but the requested two-job live test is still blocked. Consequently no trustworthy minimum VRAM, host-RAM peak or comparative H100 performance can be asserted yet. See [execution journal](../development/HISTORICAL-EXECUTION-PLAN.md) and [measurement semantics](../../studio/JOB-MEASUREMENTS.md).

## Audit of failed RunPod allocations

The journal records failed existing-pod start and replacement in EUR-IS-1, then constrained creation failures for RTX PRO 6000 in EU-RO-1 and US-NC-2 and H100SXM in EU-NL-1. These were not exhaustive GPU/region tests. The latest attempts included CUDA 13.x constraints and region-specific storage; reported capacity for a broad GPU name does not establish eligibility for that exact request.

Read-only `get_template(tt0cmuwu3t)` on 2026-09-10 returned a 10 GB **persistent** mount at `/workspace`, not the original network-volume ID; disk 30 GB and allowed CUDA 13.0/13.2/13.3. Thus the hypothesis that the template secretly kept the original network volume has no evidence.

The freshly fetched [REST v2 OpenAPI](https://api.runpod.io/v2/openapi.json), `CreatePodRequest.templateId`, says explicit body fields override template fields and identifies `env` as the per-key merge exception. This implies an explicit network `mounts` replaces the template mount. `Mounts` says persistent and network are mutually exclusive, with 400 on both. The public contract does **not** explicitly demonstrate nested merge implementation; a live backend defect cannot be excluded through schema inspection alone. No successful pod readback from these failed calls exists.

The same API documentation warns that 400 includes both capacity and cross-field errors. Repeated 400s should prompt request inspection rather than blanket claims that every GPU is occupied. This is a reason to tighten the next probe, not evidence that past failures definitely were a mount bug.

For the next approved RunPod diagnostic, flatten the template into explicit image/args/ports/env fields, supply only the desired network mount, and use minimum CUDA 13.0 instead of exactly 13.2. Do not print the environment. Capture sanitized request, exact response detail, timestamp and catalog candidate; on success read back GPU, region and mount. This removes inheritance ambiguity without permanently modifying the user's template. Stop after one successful allocation.

## Minimal portability work

For an ordinary GPU VM/container provider, retain Seed, ComfyUI, models, jobs and pairing. Necessary changes are small but real:

1. Add an explicitly configured trusted worker endpoint to `server/worker.ts`; today validation only accepts `*-8080.proxy.runpod.net`. Do not replace that protection with unrestricted arbitrary-URL fetching. HTTPS host allowlisting or a managed local tunnel are candidate transports.
2. Set the already-supported `SEED_PUBLIC_URL` and `SEED_WORKSPACE`. Supply a real disk mount, or add an explicit ephemeral-workspace mode. Do not weaken durable-spool assumptions silently.
3. Run the existing container with GPU access and private secrets. Provide one provider-specific launch recipe first. No Terraform, Kubernetes, universal SDK or second registry is needed to prove the replacement.
4. Preserve/copy `.seed/presets` and selected LoRAs, or replay their pinned definitions. Rebuilding base models alone does not recreate the active content modes.
5. Verify uploads, Range retrieval, pairing and durable acknowledgement using the actual route. A new proxy's homepage loading is insufficient proof.

Preparing only the selected workflow's dependency set is a valuable second change: image-only cold preparation need not wait for the entire 99.6 GB manifest. It should not be mixed into the first provider comparison, which should keep software/configuration constant.

## Serverless is a separate integration decision

Google Cloud Run now explicitly lists a 96 GB RTX PRO 6000, driver 580/CUDA 13.0, and a minimum 20 CPU/80 GiB RAM, so it is not disqualified by GPU size or the current CUDA image. [Official GPU configuration](https://docs.cloud.google.com/run/docs/configuring/services/gpu).

But Seed submits a job and immediately returns, then polls. HTTP scale-to-zero does not understand whether Comfy is still generating or awaiting output receipt. Native Cloud Run background work, instance lifetime, spool durability, storage and request routing must be reconciled before calling it a drop-in replacement. Instance-based billing alone does not solve lifecycle ownership. Avoid adopting a serverless platform based solely on five-second instance-start marketing: model downloads, hashes, loading and transfer remain additional work. 80 GiB host-RAM suitability also needs measurement.

An ordinary single-GPU VM is the smaller integration; serverless may be the better final experience only if its lifecycle proof passes. This is an implementation-risk distinction, not a provider ranking.

## Procurement gates and bounded proof

Research should produce an exact purchasable SKU/region/rate and account-quota path—not a provider logo or global fleet size. Existing GPUs, announced GPUs and capacity contractually committed to other customers are different things.

Before selection, record GPU model/count/VRAM, CPU/RAM, driver, image support, local versus durable disk, startup quota, contract/minimum commitment, metering increments, public IPv4/egress/storage fees, refund/capacity support, and acceptable-use/model-license fit for the owner's intended SFW and NSFW workflows. Do not assume generic GPU rental permits every workload.

Proposed first proof (requires choosing the account and agreeing its actual spending rate):

1. Free/read-only: verify billing access, one-GPU quota, exact deployable SKU, image architecture/driver, and complete price. Validate template/request shape.
2. One GPU, first checkpoint: start the worker and verify actual allocation, driver and mount. If healthy service is not reached within a disclosed bounded startup window, report the failure before buying more attempts. Separate capacity rejection from image/bootstrap failure.
3. Run one text-to-image and one reference-to-video using the image result. Save files and measured statistics locally. Then test representative 15 s/multiple-reference demand as a separate maximum-envelope case, not an unannounced expansion of the two-job request.
4. Terminate/relaunch with warm models; repeat successful allocation at three different times before claiming the new provider feels dependable. These are samples, not a statistically sound availability percentage.
5. Exercise PC disconnection during output retrieval, reconnect and finish saving; confirm safe termination and actual zero active compute. Reconcile billed compute plus persistent charges.

Suggested experiment ceiling is **two billed GPU-hours for the first candidate**, then review results; it is a proposal, not new authorization or a promise cold setup fits that time. At hourly rate R, compute ceiling is 2R, plus explicitly quoted storage/egress charges. Avoid reservation/annual commitments until these gates pass. If capacity is assured only through paid reservation, show the full 24/7 idle cost alongside the pay-as-you-go tradeoff.

Decision output must show: successful allocation rate samples, cold and warm time-to-first-result, image/video generation duration, sampled VRAM/RAM and missing-sample count, transfer and save durations, total session cost, stopped-state charges, remaining limits, and operational steps the user must perform. This evidence decides the next build.
