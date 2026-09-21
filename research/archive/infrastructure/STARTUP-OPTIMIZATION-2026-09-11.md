# Seed startup optimization review

Implementation follow-up: bounded overlap and the Civitai User-Agent fix are now
implemented. Local credential and request comparison ruled out the owner's key
type/permissions and reproduced the default Python-header rejection. See the
latest [validation](../../studio/VALIDATION.md). Performance estimates below remain
unverified until a new authorized live run.

Live follow-up now passed: all three LoRAs downloaded directly during the first
base-model download; no fallback. Full boot preparation fell from 7m57s to 4m07s
on the same host. Ready was confirmed 5m42s after the user message. Container
cache differences substantially improved startup independently; see validation
for the evidence and attribution limits.

Research and three independent reviewer passes; no GPU rented and no runtime code
changed for this review. Scope: shorten the user's complete wait without adding
storage services, orchestration infrastructure, or weakening verification.

## Baseline and measurement

The primary metric is **user message to final report**, including acquisition,
tool delays, verification, test cleanup and documentation: **16m 36s** in the
Japan cold-start test. Ready was confirmed at **14m 37s**. Both matter; do not
substitute rental-to-Ready for the user's elapsed time.

| Phase | Observed duration |
| --- | ---: |
| Message, inspection, offer selection, rental, start wait | 50s |
| Container pull/setup and authenticated SSH readiness | 4m 42s |
| Dispatch preparation and check models | 28s |
| Download/verify 99.6248 GB base models | 4m 11s |
| Civitai failures, 1.8552 GB PC fallback, activation, worker start | 3m 32s |
| Pair and confirm Ready | 54s |
| Logs, cleanup, billing and absence confirmation | 59s |
| Documentation, commit, push and final report | 1m |

Evidence: local `vast-cold-*` logs and [validation](../../studio/VALIDATION.md).
Observed boundaries include polling/dispatch. The base-model metric is measured
by worker receipts; 397.38 MB/s is effective verified bytes per elapsed second,
not a direct measurement of network traffic. The fallback bucket includes engine
startup. The 54s pairing bucket includes real work and agent delay; it is not all
avoidable overhead.

## Agreed priorities

### 1. Overlap base models and user LoRAs

`server/model-cache.ts` appends presets after the base manifest, and
`operations/model-transfer.mjs` processes that entire list serially. The three
Civitai HTTP 403 failures took 0.10, 0.07 and 0.07 seconds. The long tail was the
PC upload: the largest LoRA alone logged more than 150 seconds of transfer.

Use two bounded paths: one sequential base-model download loop and one sequential
user-LoRA direct/fallback loop. Upload the receiver and probe once, then await both
before activating presets and starting the worker. This could hide roughly
2.5–3 minutes of the tail inside the existing 4m 11s base preparation. This is an
estimate, not a measured improvement, and is not additive with fixing Civitai.

Keep atomic promotion, hashes, resumability and credential handling. Serialize
identical SHA256 assets across paths because staging is hash-addressed. Join or
cancel outstanding work on failure before teardown. Do not start the worker while
files are arriving: its own preparation path can rehash files and compete with
the receiver. Do not launch 14 simultaneous downloads; HF already parallelizes.

### 2. Remove pauses between existing CLI commands

After selecting an offer, execute `wait`, `boot`, `connect`, and `status`
consecutively in one invocation, stopping on failure and collecting diagnostics.
The existing commands already handle bounded polling. No new scheduler, service,
or launch-command abstraction is required initially.
Retain a bounded check for the actual worker `ready` state: `connect` confirms
pairing, and one `status` response alone is not a wait for engine readiness.

Preplan the benchmark record and cleanup checks. Independent read-only diagnostics
can overlap; destruction and absence verification remain sequential. Keep logs
and required evidence. Likely savings are tens of seconds, potentially around a
minute across execution and wrap-up; do not claim the entire 54s pairing bucket.
The current five-second readiness polling is already adequate.

### 3. Audit the inherited runtime image

Read-only inspection of the pinned published image found:

- 8,857,201,867 bytes compressed across 42 manifest layers.
- 16,328,294,434 bytes uncompressed image size.
- An inherited CUDA development-tools layer around 4.86 GB uncompressed and
  2.323 GB compressed; a Torch installation layer around 4.94 GB uncompressed.
- Seed's added SSH/application content is only approximately 9.46 MB uncompressed.

Trimming Seed files will not materially improve this. Compare a reproducible
runtime/multi-stage image with the existing development-heavy base, preserving
the pinned Torch/CUDA/ComfyUI versions. Check custom nodes and runtime compilation
before removing compiler/header dependencies. Keep Jupyter unless measurement
identifies it as significant; removing an agreed feature is not a first step.

[Docker recommends multi-stage builds](https://docs.docker.com/build/building/best-practices/)
to separate build dependencies from the runtime image. [Vast documents frequently
cached base images](https://docs.vast.ai/guides/templates/introduction); these are
another comparison candidate, not a cache guarantee or a reason to add a second
provider-specific runtime immediately. Repeated-host image caching may help but
must not become a capacity requirement.

We cannot promise minutes saved: the 4m 42s combines registry download, extraction,
Vast's wrapper setup and SSH readiness. The current logs do not isolate those.
Compressed size alone does not predict the resulting startup time.

### 4. Diagnose Civitai, then repair the demonstrated cause

Both clients use Bearer authentication, which [Civitai documents as preferred](https://github.com/civitai/civitai-developer-docs/blob/main/site/guide/authentication.md).
The GPU uses Python urllib; the PC uses Node fetch with bounded Range requests.
Their user agents and fresh-file Range behavior differ. Existing cached-file
fallback success does not prove a new authenticated PC download would succeed.

Record the rejection hostname, redirect count, HTTP status and content type without
tokens, signed URLs or raw exception bodies. Compare bounded equivalent PC/VM
requests on the next authorized test. A [Civitai issue](https://github.com/civitai/civitai/issues/2113)
reports a redirected CDN returning 403, but that is only a possible explanation
for our result. Do not assume an invalid token, IP block or user-agent rejection.
Keep automatic fallback even after fixing the cause.
Collect these diagnostics on the next authorized run; they need not wait for an
image rebuild. Image size analysis can continue independently without paid compute.

### 5. Leave broad HF tuning until the larger delays are addressed

99.6 GB in 4m 11s is already a good observed result. Our downloader uses
`hf_hub_download`; [Hugging Face's Xet guidance](https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables)
offers high-performance settings, but tuning should match the installed hf_xet
version and available memory. First separate transfer and verification timing.
Do not indiscriminately increase concurrency or remove integrity checks.

## Next validation and exclusions

First implement bounded overlap and eliminate agent dispatch gaps. Use the same
full manifest and readiness definition in a future authorized run. Record message
time, rental confirmation, image/SSH readiness, per-file transfer/verification,
fallback completion, engine readiness, pairing, deletion confirmation and report.
Use a small per-run record; this does not need a telemetry platform. Preserve logs
before teardown on every failure. Stop and confirm no active transfer processes
before deletion. Report host/cache differences and posted versus settled costs.

A roughly **13–14 minute message-to-report** result is a plausible first target
on comparable hardware after overlap and dispatch improvements, not a guarantee.
Further image gains require measurement. Do not add estimated Civitai savings to
the same fallback time already hidden by overlap.

Defer new registries, persistent paid storage, warm GPU pools, multi-provider
orchestration, workflow-specific readiness and rewriting the transfer stack.
These either change the cost/product contract or add machinery before the simple
opportunities have been tested. All three reviewers agree on this order.
