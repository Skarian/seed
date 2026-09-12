# H3 High Quality candidate validation — September 12, 2026

Implementation is on `codex/h3-high-quality`, source commit `cec0af3`.
High Quality is an optional checkbox, off by default, independent of Normal/Spicy.
The candidate preserves native video dimensions in both quality modes and uses
the researched native 30-step H3 recipe for HQ, with Turbo bypassed.

## Published candidate

`ghcr.io/skarian/seed-worker@sha256:fceb482939a16783746dcf09adbae69deee277c284110381f027cdd7bc92d67a`

[GitHub Actions publication](https://github.com/Skarian/seed/actions/runs/34723568844)
succeeded. The application image pin and final local package use this digest.
The owner's installed app has not been replaced pending live GPU validation.

## Completed checks and measured timings

| Check or operation | Result | Elapsed |
|---|---|---:|
| Local candidate Docker runtime build | Passed | 49.35s |
| Final worker code layer rebuild | Passed | 1.87s |
| Full verification command | Passed | 46.99s |
| Application tests | 90 passed across 13 files | 9.70s |
| Operations tests | 70 passed | 16.65s |
| Worker tests | 61 passed, 1 skipped | 11.82s |
| Browser tests | 14 passed; desktop/mobile screenshots reviewed | 10.0s |
| Initial package attempt | Local npm cache permission failure | 3.30s |
| Package build using workspace cache | Passed | 2.75s |
| Windows isolated package lifecycle/upgrade/rollback checks | Passed | 36.98s |
| Final package with immutable published image pin | Passed | 2.88s |
| Direct local GHCR push | Credential lacked package write scope | 0.74s |
| CI disk cleanup | Passed | 77s |
| CI image build | Passed | 269s |
| CI image publication | Passed | 24s |
| Complete CI job | Passed | 372s |
| RunPod creation request | Passed | 2.67s |

Test suite times overlap the full verification command and must not be added
to it. Type checking/build and the 308-file secret scan passed in that command.
The browser command was rerun with Windows process permissions after an initial
sandbox teardown hang; the successful run exited normally. Package acceptance
used the same application code before the final image-pin-only change.

Local CPU startup also verified ComfyUI v0.35.0 and native node API schemas.
This does not prove CUDA kernel availability or generated video quality.
Implementation/research and every individual CPU inspection were not separately
instrumented; no exact duration is claimed for those activities.

## Live GPU blocker

RunPod `9ndkngn38ve3f2` was created at approximately 22:52:25 UTC in EUR-IS-2:
RTX PRO 6000 Blackwell Server Edition, quoted $2.09/hour, 180GB disposable disk.
No preexisting RunPod pod was present. GPU hardware has not yet been independently
verified with `nvidia-smi` because SSH is unavailable.

After approximately 20 minutes, RunPod still reported image download activity,
with no worker runtime or direct SSH endpoint. The repeated active layer
`74f288efe069` is 194,448,843 compressed bytes. The provider logs expose neither
byte progress nor an explicit error, so a stalled or unusually slow provider
image pull is suspected, not proven. The full compressed image is 9.08GB.

Per the owner's instructions, the pod and its disk are retained for inspection.
Compute remains quoted at $2.09/hour plus approximately $0.025/hour for the disk
at [RunPod's published storage rate](https://docs.runpod.io/pods/pricing).
These are rate estimates, not a reconciled provider invoice.

No model preparation or inference was started. Consequently no GPU generation,
export, transfer, quality, or kernel-activation timing/result is claimed.

## Prepared, unexecuted GPU test matrix

The isolated test app is at `http://127.0.0.1:4312`. It uses separate Library,
configuration and rental tracking; the existing app and Library are preserved.
Fourteen verified model files (101.48GB total) are available in its local cache.

The harness covers Normal/Spicy images; Fast/HQ text videos in both modes;
Fast/HQ mixed image/video/audio references in both modes; Fast first/last frames;
HQ 15-second portrait first/last frames with silent output; and Fast/HQ PNG
sequences. It verifies native dimensions, frame count, frame rate, duration,
audio presence/duration/nonempty samples and duplicate-submission idempotency.
Native Sol attention activation must additionally be verified from GPU logs.
Successful execution would still be separate from subjective acting/dialogue
quality assessment.

Private timing and diagnostic evidence is retained under `.local/hq/`.
Changing hosts or the approved model/runtime recipe requires the owner's
check-in before further work.
