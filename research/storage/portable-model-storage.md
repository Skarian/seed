# Portable ComfyUI model storage — 2026-09-10

Research only. No storage resources changed or paid benchmarks run. GHCR public application image and account-private seed template remain agreed. GPU scarcity and registry hosting are separate issues.

## Finding and recommendation

Make the RunPod network volume optional. Use a pod-local model cache hydrated from a remote source. This removes the volume's datacenter attachment constraint, not GPU scarcity or hardware compatibility. Recommend R2 Standard as a private model mirror if the owner wants one controlled origin. The smallest experiment is the existing pinned Hugging Face downloader targeting local disk, before adding an R2 account dependency. Keep the current volume until replacement boot, LoRA recovery and output receipt safety have passed.

R2 is object storage, not a local ComfyUI filesystem. Download complete verified files to local disk before loading; avoid FUSE/rclone mount as the default runtime model path. Use rclone copy (not destructive sync) or an S3 client for mirroring; download to partial files, verify pinned hashes and atomically publish. Resume interrupted transfers. No weights in the public container. Keep mirrors private and check each model's redistribution terms before any shared/public mirroring.

## Current local evidence

worker/models.json totals 99,624,767,830 bytes across 11 files (99.62 decimal GB), before owner content LoRAs. Text-to-image base dependencies total about 19 GB. One H3 route plus shared encoders/VAEs/turbo is about 56 GB. Boot currently waits for the entire manifest. Dependency-based preparation could make an image workflow ready before all video weights download, but requires capability/readiness changes.

worker/run.py currently requires /workspace to be a mount; setup requires a network volume; worker/prepare.py only accepts pinned HF origins; preset state and pending output spools are on that volume. Portability is therefore more than changing a URL. A local volume disk can preserve caches on the same pod across stops but is host-bound and deleted on termination. Container disk is lost on stop/restart. Unsaved outputs on disposable storage cannot survive its destruction; preserve the existing safe-to-terminate rule and never imply full recovery after deletion without a durable remote spool.

## Options

- R2 Standard: $0.015/GB-month, first 10 GB-month free, free direct egress, request charges with generous free allowances. Approximately $1.35/month for 100 GB stored or $2.10/month for 150 GB, if free storage allowance unused elsewhere. GPU-local disk and download-time compute are additional. Avoid Infrequent Access for frequent full downloads ($0.01/GB retrieval).
- Existing RunPod network volume: 150 GB provisioned at $0.07/GB-month = $10.50/month. Two such volumes = $21/month; independent caches, no automatic sync. Low startup download overhead but each mounted volume restricts datacenter.
- HF origins: already implemented and no extra owned model-storage service. Downloads and gated access still depend on upstream availability. Exact owner LoRAs/preset settings must also be reproducible, not silently left behind on the old volume.
- PC model endpoint: feasible authenticated HTTPS range downloads. Requires actual home UPLOAD bandwidth, reachable tunnel, PC online and ~100 GB local storage. A gigabit subscription does not establish gigabit upload or cloud throughput. HTTP model files need no container registry protocol.
- Existing RunPod volume as download origin: EUR-IS-1 supports S3 API, so a remote pod could copy files from it without mounting it. Useful bridge, still pays old storage and needs a separate RunPod S3 credential. No throughput claim tested.
- Models baked into image: established pattern, shifts model transfer into image pull. A cold host still must fetch those bytes; not an instant-start guarantee. Heavy builds/updates and model distribution rights make it unattractive for our full 100 GB set.

## Download budget, not measured performance

100 GB at sustained 250 Mbps: ~53 min; 1 Gbps: ~13.3 min; 5 Gbps: ~2.7 min. At illustrative $2/GPU-hour, download wait alone is ~$1.78/$0.44/$0.09 per fresh cache. TLS, disk writes, verification, contention and model loading add time. Neither R2 nor HF throughput to a particular pod is established by this research.

## What others do

AI-Dock ComfyUI uses provisioning scripts rather than bundled models. RunPod's maintained ComfyUI serverless worker supplies both base and model-bundled images and documents network-volume customization. Vast's migration guide recommends object-storage downloads on boot for cross-host portability. A community 80 GB baked-image example demonstrates feasibility, not broad adoption or benchmark evidence. Community reports of region-locked storage echo this user's experience, but are not availability measurements.

RunPod serverless cached models are interesting separately: documented downloads before billed worker start, but one cached HF repo per endpoint and all quantizations in the repo. Not a drop-in solution for this multi-repo, manually managed pod setup.

## Sources

- https://docs.runpod.io/storage/network-volumes — datacenter constraints, pricing, independent regional copies.
- https://docs.runpod.io/pods/storage/types — local disk persistence and pricing.
- https://docs.runpod.io/storage/s3-api — EUR-IS-1 endpoint and separate credentials.
- https://developers.cloudflare.com/r2/pricing/ — storage, requests, egress, retrieval.
- https://developers.cloudflare.com/r2/platform/limits/ — large objects supported, multipart over 5 GiB.
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/ — private timed downloads; do not put expiring URLs permanently into a template.
- https://rclone.org/s3/#cloudflare-r2 — off-the-shelf R2 support.
- https://github.com/ai-dock/comfyui — provisioning approach.
- https://github.com/ai-dock/comfyui/blob/main/config/provisioning/default.sh — implementation evidence.
- https://github.com/runpod-workers/worker-comfyui — base/bundled models and network volume options (serverless).
- https://docs.vast.ai/examples/migrations/runpod-to-vast — object-storage-on-boot recommendation.
- https://github.com/unorouter/comfyui-models — community model-bundled image example.
- https://docs.runpod.io/serverless/endpoints/model-caching — serverless cache scope and limitations.

## Proposed next decision

Choose whether a fresh-session download of roughly 56–100 GB is acceptable. Then measure one representative large model on one authorized available GPU before removing the current volume. Implement optional local-cache storage, resumable verified fetching, reproducible LoRA presets, per-workflow readiness and clear transient-output semantics. Do not add automatic GPU shopping, Terraform, multi-provider routing, or a new registry to solve this storage question.

Owner clarification: home connection is "10 GB", interpreted as 10 Gbps service, not the previously discussed 1 Gbps. Symmetric upload speed is not yet established. At sustained 10 Gbps, 100 GB has a theoretical ~80-second transfer floor and one ~56 GB H3 dependency set ~45 seconds. This makes a PC-hosted authenticated model endpoint a strong first candidate. Actual end-to-end throughput remains bounded by home upload, tunnel/relay, pod ingress, disks and verification. Prefer evaluating that path before adding R2 if the PC will already remain online for Seed. No bandwidth benchmark was run.
