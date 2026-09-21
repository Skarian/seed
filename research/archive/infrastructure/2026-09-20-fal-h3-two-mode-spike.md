> Historical experiment notes. Executable spikes have been retired; the current
> application uses fal directly. See [current architecture](../../studio/ARCHITECTURE.md).

# fal H3: HQ and Fast spike

September 20, 2026. Active experiment design following the owner's choice of fal
Model APIs. Supersedes the Modal four-B300 experiment for this task. The standalone
runner is implemented; see [usage and recovery](../../scripts/fal-h3-spike.md).
The initial live test is complete: three real references uploaded once, one HQ
generation and one Fast generation, with verified local outputs and matched fal
billing events. Seventeen simulated API/recovery tests also pass. Application
integration and paid LoRA/batch testing remain deferred.

**Owner decision after reviewing outputs:** defer Fast / H3 Max completely. The
owner disliked its output; its measured speed improvement did not justify its
premium. Future application work should use standard H3 with optional compatible
LoRAs. The two-mode design below is retained as the historical experiment, not
the current integration target. The next investigation is [Krea 2 on fal](2026-09-20-fal-krea2-replacement-spike.md).

## Measured first run

September 20, 2026, approximately 18:32–18:34 UTC. Both requests used 15 seconds,
768P, 16:9, generated audio, seed 424242, disabled prompt expansion, and no LoRAs.
The same portrait, three-second video with soundtrack, and three-second WAV were
uploaded once and reused. The requests ran sequentially, with no warmup or retries.

| Stage | HQ | Fast / H3 Max |
| --- | ---: | ---: |
| Submit acknowledgment | 0.19 s | 0.11 s |
| Observed queue/startup | 4.24 s | 0.04 s |
| Observed processing | 30.39 s | 27.21 s |
| Result lookup | 0.03 s | 0.03 s |
| Download | 5.17 s | 2.23 s |
| Verify/save | 1.28 s | 1.11 s |
| Submission to verified local file | **41.31 s** | **30.74 s** |
| Matched request charge | **$1.08000** | **$1.50208** |

Shared preparation took 2.94 seconds and the three uploads took 2.93 seconds.
Adding that 5.87-second setup to each per-request total gives approximately
47.17 seconds for an isolated HQ run and 36.61 seconds for an isolated Fast run.
Setup was actually done once; these isolated totals are computed from measured
stages, not additional paid trials.

**Total observed request charges: $2.58208.** Both clips met the owner's targets
of under $2 and five minutes. Billing was retrieved with an Admin key after the
inference key returned 403; neither generation was repeated. Published output
subtotals were $0.90 and $1.20, so the observed excess was $0.18 and $0.30208.
These differences are not separately itemized reference charges in the receipt.
Fal bills complete requests; no per-stage GPU cost is inferred. Standalone
storage/transfer fees, if any, are outside these matched request events.

The pricing API returned $0.05 per base billing second for both routes. Its
weighted quantities were 21.6 and 30.0416, producing the actual totals above.
These are billing units, not video length or inference wall time. The model pages
still specified 768P output rates of $0.06 and $0.08 per second. The runner now
records the catalog base rate and selected-resolution estimate separately.

Fal's runner metrics were 30.723 seconds (HQ) and 26.938 seconds (Fast); Fast
additionally reported 21.206 seconds of DiT denoising. HQ did not expose that
subspan. The 10.57-second end-to-end advantage includes queue and download
differences; it is not a 10.57-second model-execution advantage. One observation
per route does not establish average or p95 latency, or cold-start behavior.

Both downloaded MP4s decode and report 1344×768, 24 fps, 362 frames, 15.104 seconds,
and 32 kHz stereo AAC. Neither output is silent or clipped by the peak-level
check. This does not establish dialogue intelligibility or lip-sync quality.
Sampled frames suggest HQ initially follows the video-reference woman's identity
before using the portrait subject; Fast's sampled frames follow the portrait
subject consistently. Treat this as a visual review finding to check in playback,
not a general quality ranking. Audio quality still needs listening review.

Private outputs and receipts are in `.local/fal-h3-spike/cafe-v1/`, including
`index.html`, `HQ-S.mp4`, `FAST-S.mp4`, `state.json`, `billing.json`, `jobs.csv`,
`stages.csv`, and contact sheets. No model weights or GPU workers were deployed.

## Original two-mode experiment design (superseded by HQ-only decision)

One application generation API, two selectable video modes. Both are served
through fal; “normal MiniMax API” here means standard H3 accessed through fal,
not a second direct MiniMax integration. “M3 Max” means H3 Max.

| UI mode | Existing request quality | Adapter selection | Ref-to-video endpoint |
|---|---|---|---|
| HQ | `high` | None | `minimax/h3/reference-to-video` |
| HQ | `high` | One to three compatible LoRAs | `minimax/h3/reference-to-video/lora` |
| Fast | `fast` | Unavailable | `minimax/h3-max/reference-to-video` |

Fast selects regular H3 Max, not H3 Max Turbo. Disable the LoRA selector in Fast
and reject nonempty adapter lists on the server before any upload or submission;
never silently drop adapters or switch models. Preserve the HQ selection as a
draft so switching back restores it; Fast requests themselves contain no LoRAs.
HQ starts with an empty selection. LoRAs are explicit choices, not automatically
enabled by the existing Standard/Spicy control.

HQ and Fast describe product choices, not a verified quality ranking. Compare
faces, motion, reference fidelity and audio rather than assuming HQ wins. Fal's
public contracts do not establish numerical precision or a full native denoising
schedule. This experiment measures hosted outputs; it does not establish a
BF16 reference or isolate why Seed's current audio sometimes sounds poor.

Sources: [standard H3 contract](https://fal.ai/models/minimax/h3/reference-to-video/api),
[LoRA contract](https://fal.ai/models/minimax/h3/reference-to-video/lora/api),
[LoRA schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/reference-to-video/lora),
[H3 Max contract](https://fal.ai/models/minimax/h3-max/reference-to-video/api).

## Shared request and provider boundary

Keep the eventual `POST /api/v1/jobs`, job polling, cancellation, submission
grouping and local Library flow. The application supplies quality, prompt,
references, output settings, seeds and count. A server-side fal adapter selects
the endpoint and normalizes status/results. Browser code never receives FAL_KEY
or chooses an endpoint URL.

Reuse the existing request shape and add an optional `loras` array containing
`{id, revision, scale}`. The server resolves those identifiers from a catalog:
display name, task variant, pinned source URL/revision, optional weight filename,
checksum when available, default/allowed strength and compatibility-test status.
Snapshot the resolved adapter versions and strengths on each job. List only
adapters compatible with the selected task; existing ComfyUI filenames alone
do not establish fal compatibility. No adapter training is included.

The spike uses a small local runner with this request shape and adapter boundary;
it need not alter the running app or its database. Normalize operations as
prepare/upload, submit, status, result/download, and cancel. Persist provider,
endpoint, local job ID, fal request ID, exact sanitized payload, settings revision,
reference hashes, resolved seeds, timestamps and returned usage for recovery.

### Concrete build scope

Build a command-line experiment in this repository, separate from the running
studio. Proposed files and outputs:

- `scripts/fal-h3-spike.mjs`: prepare/validate the selected real media, upload
  once, run HQ then Fast, collect timings, download results, and resume an
  existing run by its saved request IDs. A dry-run path prints sanitized request
  settings and cost assumptions without upload or generation.
- `scripts/lib/fal-video.mjs`: a small reusable server-side adapter handling
  HQ/Fast endpoint routing, optional catalog-resolved HQ LoRAs, queue polling,
  result retrieval and errors. Keep experiment-specific paths and reports out
  of this module so the app can adopt the same logic later.
- A pinned fixture configuration and compatible-LoRA catalog format. Initial
  requests use no LoRA; do not invent a verified adapter list or add training.
- `.local/fal-h3-spike/<run-id>/`: the two MP4s, reference/request manifests,
  recovery state, timing CSV, billing evidence and a simple static HTML comparison
  with both videos and the measured numbers. This directory is already gitignored.

FAL_KEY is read only in the local process, never embedded in the report or
browser. No new hosted service, app UI, database migration, or GPU deployment is
part of this build. Paid execution is separate from creating/verifying the runner.
The initial runner admits at most one generation per mode, with no automatic paid
reruns. A four-request burst is deferred rather than built into the first run.

Current integration work discovered in the repo:

- `server/workflows.ts` already has `quality: high | fast`, count and seeds but
  no adapter-list field; `server/video.ts` strictly rejects unknown settings.
- `server/jobs.ts` depends directly on `WorkerConnection`, a ComfyUI graph,
  worker capabilities and workspace/session IDs. Introduce a provider-specific
  execution record/adapter here; do not pretend a fal job has a ComfyUI graph.
- `server/http.ts` derives availability from a connected worker. Fal video
  readiness must instead use configured credentials and route capabilities.
- `shared/reference-labels.ts` numbers video soundtracks before standalone audio.
  Provider prompt translation must preserve input identity, not merely replace
  all occurrences of Picture with Image.
- `server/media.ts` prepares silent MP4s and separate soundtrack WAVs for ComfyUI.
  Reusing that output blindly would lose or duplicate audio on fal. Add a
  provider-aware preparation recipe while retaining local source files.
- Existing job replay must preserve the original provider and resolved endpoint;
  historical worker results must not be relabeled as fal outputs. Generate,
  Chat and Repeat should eventually consume the same capability/catalog data.

For this spike, restrict output to `size: native` mapped explicitly to fal
`resolution: 768P`, 16:9, 15 seconds, MP4 with generated audio. Probe actual output
dimensions, frame rate, duration and channels. Later app integration must decide
720p export, frame export, mute, first/last-frame and text-to-video support from
their own capabilities; do not advertise untested workflows as ready.

## Reference fixture and preparation

Retain the owner's selected three real references: one portrait, the first three
seconds of the cafe video including its soundtrack, and the separate three-second
audio clip. The earlier audit confirmed these sources exist and decode:

- Image: `C:/projects/runpod/.local/hq/studio/data/media/outputs/16e5e4fb-9642-4d7f-be9a-19996eab21f2-0.png`
- Video: `C:/projects/runpod/.local/hq/studio/data/media/outputs/bd810ef0-4de8-4f75-b9de-3075cdd7bcf0-0.mp4`
- Audio: `C:/projects/runpod/.local/hq/reference.wav`

These are generated media; the WAV was extracted from the same cafe video.
It is quiet (about -51.6 dBFS RMS). Inspect frames and audition both audio streams
before freezing the fixture; nonempty files alone are insufficient. Do not
substitute placeholders, normalize only one mode, or silently replace an asset.
Record original and prepared hashes, dimensions, frame count, sample rate,
channels, trims and any common preprocessing. Keep source aspect ratios.

Prepare a three-second MP4 retaining its soundtrack and the separate WAV. Upload
exactly these three prepared files once to fal storage and reuse their URLs
across all cases. Record URL expiry/availability and recover upload failures
before any generation. This is reference staging, not model staging: fal manages
the base checkpoint, GPU loading and retention. No 144 GB download, model volume,
SGLang deployment or GPU idle window is needed in this design.

Freeze the earlier cafe scene and dialogue (“I thought you had forgotten”). Bind
appearance to the image, setting/motion to the video, and voice to the standalone
audio. The fal schema documents Image 1 / Video 1 / Audio 1 list references;
record the exact provider prompt and mapping. Explicitly distinguish the video's
soundtrack from the separate audio and verify the mapping in the single case.
Do not copy the ComfyUI `<Audio 2>` label without establishing fal's semantics.

## Run matrix

First phase preserves the earlier decision to test without LoRAs. The selectable
LoRA list belongs in the interface design; a paid adapter test remains a later,
separately scoped phase after choosing and pinning a compatible adapter.

| Case | Mode | Count | Seeds | Submission pattern |
|---|---|---:|---|---|
| HQ-S | HQ, no LoRA | 1 | 424242 | One request |
| FAST-S | Fast, no LoRA | 1 | 424242 | One request |

**Initial scope: two videos total, one per mode**, as agreed after reviewing the
ten-video cost. Check playable outputs, references, audio and actual charges.
Stop after these two and review whether any batch testing is useful. Reuse the
same prepared media, semantic prompt, 768P/15-second settings and disabled prompt
expansion. Keep the exact translated prompts in the report. Matching seeds makes
the protocol consistent, not outputs numerically comparable across models.

Optional later batch cases, not part of the initial run: HQ-B4 and FAST-B4, each
four independent concurrent requests with seeds 424242–424245. Run the groups
separately to avoid deliberate cross-mode queue interference. A batch would be
an application group of four fal jobs, not a native batch payload or a discount.
Record concurrency restrictions, rate limiting and first/last-result times if
that phase is requested. Do not automatically proceed from singles to batches.

We cannot force or verify a cold fal worker. Call these isolated single requests
and, if tested later, four-request bursts, not cold/warm measurements. No extra
warmup generations. One observation per mode is a smoke comparison, not an
average, p95, latency guarantee or reliable quality ranking.

Follow-up LoRA phase: repeat one HQ request with one selected compatible adapter,
same fixture and seed; compare against HQ-S and confirm its visible intended
effect, fidelity, charge and latency. Expand to a four-request LoRA burst only
if needed. Do not claim the catalog is verified from the no-LoRA phase.

## Measurements and billing

| Stage | Measurement | Cost treatment |
|---|---|---|
| Local preparation | Trim/probe/hash start and finish; bytes | Local work, separate from fal generation |
| Reference upload | Per-file duration/bytes; fresh vs reused | Record any actual transfer/storage charge separately |
| Submit | POST start to acknowledged request ID | No fabricated separate fee |
| Queue/startup | Acknowledgment to first observed IN_PROGRESS | Includes any unobservable provider startup |
| Processing | IN_PROGRESS to completion/result ready | Includes encoding, LoRA loading, denoising and mux unless fal reports subspans |
| Provider subspans | Raw returned metrics when present | Diagnostic, not additive to enclosing processing time |
| Retrieval | Result lookup, download, local verification/save | Record any separately billed transfer; otherwise bundled/unknown |
| Total | Request start to playable, durably saved local MP4 | Reconcile actual fal request charge |

Use monotonic durations plus UTC timestamps. Poll at a recorded cadence (initially
one second) respecting throttling; observed state transitions have polling error.
Prefer provider timestamps where available. A request that skips an observed
state has unknown queue/processing split, not zero time. H3 Max documents
`timings.inference` as DiT denoising only; retain it separately from wall time.
The standard/LoRA schemas do not promise the same field. Unknown internal model
loading, encoding, decode and mux timings stay null. No invented per-stage GPU
cost allocation: these are per-output API charges, not metered GPU rentals.

Published output prices checked September 20:

| Route | Per output second at 768P | 15-second output |
|---|---:|---:|
| HQ without LoRA | $0.06 | $0.90 |
| HQ with LoRA (later phase) | $0.075 | $1.125 |
| Fast / H3 Max | $0.08 | $1.20 |

Initial two-video output subtotal: **$2.10, plus references/other actual fees**.
Fast is a latency option, not a cheaper-price promise. H3 Max adds reference
processing fees above a pooled 4,096-token allowance at $0.02/1,000 excess tokens.
Image geometry and aligned video frames affect the token count. Use the actual
media estimate and usage; do not use an old fixed tokens-per-video-second formula.
Standard and LoRA endpoint pages do not fully specify mixed video/audio reference
charges, so resolve them from a quote and the first request's billing before
admitting four jobs. Upload URL reuse does not imply reference processing is free.

The earlier proposed $20 ten-request allowance is withdrawn with that scope.
The runner must expose a spending ceiling and show its current cost assumptions
before execution; two requests is the initial run limit, not an all-in $2.10
promise. Record an unresolved quote as unknown rather than claiming a guaranteed
ceiling from output rates alone. Report any changed price rather than silently
reducing resolution/duration or ignoring reference fees.
The owner's targets remain under $2 per video and five minutes end to end; report
misses rather than canceling solely because a target is missed.

Sources: [HQ pricing](https://fal.ai/models/minimax/h3/reference-to-video),
[HQ LoRA pricing](https://fal.ai/models/minimax/h3/reference-to-video/lora),
[Fast pricing and reference accounting](https://fal.ai/models/minimax/h3-max/reference-to-video).

## Recovery, output review and exit criteria

Persist each local attempt before submission and the fal request ID immediately
on acknowledgment. Resume polling/downloading the same request after a restart.
Never automatically resubmit an ambiguously accepted generation; local idempotency
does not prove provider-side exactly-once behavior. Retry bounded read/download
operations separately from paid generation. Record all failures and charges.
Cancellation is best effort; a client timeout or local cancel does not prove the
provider stopped or refunded the job. Preserve remote IDs for reconciliation.

Save results locally via temporary files and atomic rename; verify decoding,
size/hash and media properties before marking complete. Keep the originals,
provider payloads and receipts private. A remote URL alone is not durable output.
For production, import verified files through the normal Library path.

Produce a request manifest, events JSONL, per-job CSV, stage CSV, downloaded MP4s
and a short comparison. Include actual charge and quote separately, cost per
usable output, each job's total time, failures and billing still pending. Add
first/last batch results and aggregate batch charges only if that phase runs.
No claimed final cost while unsettled.
Blind-label HQ and Fast outputs for viewing/listening: intelligible dialogue,
voice/identity fidelity, sync, clipping/hiss, motion and temporal artifacts matter
more than a non-silent waveform. This small fixture does not establish broad
quality or adapter compatibility.

Before paid execution, exercise routing, Fast+LoRA rejection, reference/audio
mapping, the two-request limit, restart recovery and ambiguous-submit handling with fake
responses. Successful phase one means both modes accept the real fixture through
one normalized runner and yield verified local outputs with measured cost/time.
LoRA capability is a separate completion item, not implied by phase one.
Production UI/backend integration follows the findings; this design changes no
active worker, generation path, credential configuration or existing Library.
