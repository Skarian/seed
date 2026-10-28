# Native local GPU worker

Seed can run its managed image/video engine on Windows alongside the cloud pool.
Local processing is off by default. Opening Seed does not install Python,
download models, start an engine, or rent a GPU.

## Setup and use

1. Open **GPU workers → Workers → This PC** and choose **Set up local GPU**.
2. Allow about 91 GiB for the pinned models and 127 GiB free for the first setup.
   Seed checks available disk space, verifies downloaded hashes, and resumes
   partial downloads when setup is retried.
3. Choose **Enable This PC** after setup. The card shows the GPU and its state.
4. Choose **Auto**, **This PC**, or **Cloud** on a generation request.

Auto uses an idle compatible rental first, then the local worker. It never rents
a replacement automatically. This PC excludes rentals; Cloud excludes local
execution. Unsupported local settings remain queued with an explanation. Seed
does not silently reduce dimensions, duration, steps, references, or precision.

One local output owns the GPU through generation, saving, and acknowledgement.
The oldest eligible queued output runs next, including across image/video roles.
Switching roles closes the previous engine before starting the next environment.
After the final output is saved and acknowledged, the engine exits after 20
minutes without another assignment. **Pause after current** and **Turn off after
current** preserve the running output. **Cancel current and stop** requests
engine cancellation, fences further submissions, and waits for the prompt worker
to finish cleanup and park before terminating the process tree. All observed
process members must confirm exit before GPU ownership is released.

The selected executor and execution profile are recorded with the job and saved
asset. Library file information shows where an output was generated.

Local video uses the official Comfy-Org model choices: pruned INT8 ConvRot H3,
NVFP4 AWQ Qwen3-VL-32B, INT8 ConvRot video VAE, and FP32 audio VAE. The local
baseline uses ordinary dense `res_multistep` / `simple` sampling without sparse
attention or acceleration adapters. `worker/models-local-video.json` pins these
files separately from the cloud model inventory.

Video requests offer 10, 15, 20, or 30 sampling steps. New Generate and Chat
requests default to 20; saved requests without an explicit setting retain 30.
Fewer steps can reduce detail, motion consistency, or audio clarity. Distilled
eight-step recipes require a separate adapter and are not represented by this
control. Each local step profile requires its own qualification evidence.

Local image generation and editing are enabled on the RTX 5090 using the normal
image settings. Local video remains unavailable while the graphics-kernel
failures observed on October 25, 2026 are investigated. Image availability does
not claim that the repeated hardware reliability campaign has been completed.

Text-to-image supports up to three selected LoRAs using the same ComfyUI graph
and pinned-source downloader as cloud image workers. Add LoRAs in Admin before
or after local setup. On first use, Seed downloads only the selected files,
checks their SHA-256, size and safetensors layout, and registers them with ComfyUI.
Later requests reuse those files, including after restart. New adapters can be
added while the image engine is warm. Qwen image editing does not accept LoRAs.

The This PC card displays download progress. **Retry LoRA download** resumes
preparation for the same waiting request after a source, credential, or network
failure; it does not generate another attempt. Cancelling during download stops
the transfer before releasing the reservation. Verified files and resumable
partial downloads are retained.

## Support and qualification

The first hardware target is one NVIDIA GeForce RTX 5090 on native Windows.
`worker/local-runtime.json` pins Python, ComfyUI, PyTorch, native kernels, and
runtime flags. `worker/requirements-local-*.lock` pins the complete Python
dependency sets with hashes. Image and video environments are independent and
reuse the persistent model directory.

`worker/local-qualified.json` enables image workflows separately from the video
qualification boundaries. Enabled image workflows use the normal image request
validation and installed-model checks. For qualified boundaries, a GPU name alone is
not sufficient: workflow, route, resolution, orientation, duration, reference
types/counts, and any source dimensions must also match. Settings absent from
that list are unqualified. Image LoRA availability follows normal source and
model validation; it is independent of video benchmark boundaries.

Hardware evidence is retained under `.local/local-worker/qualification` during
development. A successful single render establishes feasibility, not repeated
reliability. Validation should cover startup, completion, cooperative cancellation,
idle shutdown, and relevant mixed-role/resolution recovery. Repetition counts
alone do not establish hardware reliability. The initial
memory measurements describe the workload; they do not impose a fixed free-RAM
or commit-headroom cutoff. Windows can change its commit limit while running.
Acceptance requires correct completed outputs, no OOM or loader crash, usable
system responsiveness, reliable recovery, and process/GPU cleanup. Measurements
are sampled every two seconds, so they are not allocator high-water marks. GPU
usage includes the desktop and other applications.

## Recovery and storage

Seed uses authenticated loopback connections on independent ports. The local
gateway and GPU engine are contained in Windows Job Objects tied to both their
supervisor and the Seed coordinator. A physical GPU has one durable worker ID;
named ownership prevents two Seed profiles from starting it simultaneously.

After a crash, Seed automatically checks durable receipts and recovers saved
output. It never restarts GPU generation automatically. **Retry on This PC**
starts a new attempt only after the previous executor is confirmed dead and no
completed output can be recovered. It keeps the same logical job and seed.
An orphan output without its terminal receipt blocks retry and is preserved.
An engine-cancelled receipt without a user cancellation request also remains
available for explicit retry; Seed does not acknowledge or erase that attempt.

**Retry recovery** rechecks the worker after a startup or connection failure.
If Seed reports unknown ownership, close the previous Seed instance. If the
check stays blocked, restart Windows. A timeout alone does not prove an executor
is dead.

Recovery compares process IDs and creation times, so an unrelated process reusing
an old PID does not hold the reservation. Each new incarnation also records the
read-only Windows `BootId` counter. Exact live identities always retain ownership;
an increased counter resolves identities that cannot be checked directly.
Legacy records without that counter establish a baseline when first checked.
Missing or reset counters do not release ownership. Automatic pending checks
back off to once every 30 seconds; explicit recovery runs now.

On this PC, observed Fast Startup boots preserved the service session and did
not increase `BootId`; cold boots increased it. Use Windows **Restart** for
recovery because **Shut down** with Fast Startup can retain Seed and its loaded
engine. That path does not run Seed's normal shutdown barrier, and resuming a
retained CUDA context has not been tested. Seed does not change this setting.

**Local storage** can remove models, runtime files, or both once no assignment is
reserved. Setup and engine operations hold a shared installation lease, so
cleanup refuses to run against an installation used by another Seed process.
Cleanup preserves Library outputs, the durable workspace/spool, and diagnostic
logs. Setup is required again for removed components.

## Private diagnostics

Agents must not inspect user prompts or images. `/api/v1/jobs/:id/status` exposes
an explicit metadata allowlist: state, workflow, timestamps, executor, attempt ID,
output count, adapter count, and whether an error exists. It omits prompt text,
images, reference names, graphs and freeform errors.

Each new engine instance records lifecycle events and Windows event IDs without
event messages or application contents. Lifecycle records are flushed and synced
per event. Resource samples run every two seconds, flush per sample, sync every
ten seconds and again at shutdown. Missing telemetry is recorded as unavailable;
it is not proof of a GPU fault. The engine holds a Windows SystemRequired request
for its lifetime, then releases it. This prevents idle sleep under applicable
Windows policy; it does not keep the display on, override deliberate sleep, or
establish that the crash cause is fixed.

Output files and the terminal manifest are made durable before native queue
completion is published. A persistence failure is explicit and prevents new
engine submissions. It can accompany a successful shutdown barrier, with the
fault preserved in the stop receipt; a failed CUDA synchronization cannot.

Local shutdown checks the exact pinned ComfyUI sources, torch build, and aimdo
DLL before launch and again inside the engine. A normal stop fences admission,
removes queued work, lets the native worker finish its cleanup, collects
Python garbage, and synchronizes each initialized CUDA device. It never creates
a CUDA context just to stop. The worker then parks until the Windows supervisor
terminates every member and confirms their process handles are signaled.

This is **quiesced forced termination**, not a graceful engine exit or proof that
the graphics driver is healthy. The effect on the earlier Windows crashes has
not been established. A failed barrier remains `stop_pending`; normal controls
keep ownership and continue checking. Explicit **Force stop** bypasses the
barrier and records that fact.

Service shutdown commits its intent before awaiting cleanup. It allows 90
seconds to drain, then records a forced stop and allows up to 30 seconds for exit
confirmation. Unconfirmed ownership survives restart. Windows shutdown can end
the service earlier; this implementation does not change OS shutdown settings.
Service stops let an accepted image finish within that drain budget. Gateway
loss keeps checking in 120-second drain windows, with backoff between checks,
until the engine parks or the user forces it to stop. Explicit cancellation
interrupts the running image, including when a non-cancelling drain is already
waiting for it. Managed mode also
has a 140-second overall deadline covering background, cloud and control cleanup.
If that deadline expires, the process exits with its durable stop intent intact.

The default runtime/model directory is `<Seed data>/local-worker`; the durable
workspace is `<Seed data>/local-workspace`. Maintainers can set `SEED_LOCAL_ROOT`
to select a managed runtime/model directory. Never put Library files inside its
managed `models`, `image`, `video`, `python`, `tools`, `cache`, or `downloads`
subdirectories. Instance logs are in `local-worker/instances/<incarnation>`.

## Troubleshooting

- **Setup interrupted:** choose Resume setup. Existing complete files are
  verified; partial downloads resume. A checksum failure must be resolved before
  enabling the worker. Storage controls can remove a damaged model installation.
- **GPU hardware changed:** run setup again. Seed compares live GPU identity with
  the saved installation before enabling or starting a role.
- **Out of memory:** inspect the failed workload and close memory-heavy applications before retrying.
  Seed does not modify Windows page-file settings or manage other GPU apps.
- **Engine did not become ready:** inspect the latest `engine.log` and
  `gateway.log`. Startup has a three-minute limit; recovery can inspect saved
  output without loading any GPU models.
- **Output retained / save failed:** fix local storage, then retry saving. The
  reservation remains held until the output is saved and acknowledged.
- **Cancellation still pending:** Seed waits for the engine's cleanup barrier
  and all process exits. Ownership remains reserved until both are confirmed.
  It continues checking; Force stop is the explicit emergency action.
- **Unqualified settings:** use an admitted local combination or explicitly
  choose Cloud and start a compatible rental.

## Maintainer verification

Run from the repository after `npm run build`:

```powershell
node scripts/setup-local-worker.mjs runtime
node scripts/setup-local-worker.mjs models
node scripts/test-local-supervisor.mjs
node scripts/test-local-runtime.mjs
node scripts/test-local-generation.mjs
node scripts/qualify-local-images.mjs
node scripts/qualify-local-worker.mjs fl --size 768p --seconds 15 --fast-disk --disable-pinned-memory
node scripts/qualify-local-worker.mjs ref --size 768p --seconds 15 --fast-disk --disable-pinned-memory --reference-manifest path/to/maximum-references.json
node scripts/report-local-qualification.mjs
```

Run GPU tests serially. The app integration fixture uses isolated profiles and
an explicit test boundary; it does not alter the public qualification manifest.
The supervisor test injects coordinator and supervisor death, verifies all
descendants exit, and rejects duplicate ownership. The app test exercises real
generation, interrupted-attempt replay, saved-output recovery, and idle exit.
Cloud compiler flags and container release pins are unchanged by local setup.

To interrupt a qualification run, use
`node scripts/cancel-local-qualification.mjs <run-directory>`. This requests
native cancellation and lets the harness shut down after the terminal record.
Avoid force-killing an active GPU process for routine benchmark cancellation.
Fault-injection tests deliberately kill processes and must be considered
separately when investigating graphics-driver or Windows crashes.

Reference capacity tests must fill the intended input limit: nine images for an
image-only H3 test, or twelve combined inputs for a mixed H3 test. Use distinct
images and clips. The mixed input manifest is an array of objects with `path`
and `kind` (`image`, `video`, or `audio`). Video/audio entries also need `range`
with `start_seconds` and `duration_seconds`; video entries can specify
`include_audio`. Relative paths resolve beside the manifest. The harness uses
the app's request validation and media preparation, including its aggregate
15-second video/audio limits and soundtrack counting. A single-reference smoke
test does not establish reference capacity. Qwen image-edit capacity requires
ten images total (one source plus nine references).
