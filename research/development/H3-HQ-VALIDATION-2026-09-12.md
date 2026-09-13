# H3 High Quality candidate validation — September 12, 2026

Implementation is on `codex/h3-high-quality`, source commit `cec0af3`.
High Quality is an optional checkbox, off by default, independent of Normal/Spicy.
The candidate preserves native video dimensions in both quality modes and uses
the researched native 30-step H3 recipe for HQ, with Turbo bypassed.

## Published candidate

`ghcr.io/skarian/seed-worker@sha256:fceb482939a16783746dcf09adbae69deee277c284110381f027cdd7bc92d67a`

[GitHub Actions publication](https://github.com/Skarian/seed/actions/runs/34723568844)
succeeded. The application image pin and final local package use this digest.
The installed application is updated from the tested local archive after GPU validation; its existing settings and Library are preserved.

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

## Live GPU results and approved scope reduction

Eleven GPU jobs completed and passed output validation. At the owner's request,
testing stopped after that coverage: the in-progress 15-second portrait HQ job
was explicitly cancelled, and the Fast/HQ PNG GPU tests were not started.
These are uncompleted checks, not passing GPU results. PNG behavior still has
local regression coverage. No completed GPU test failed.

| Pipeline | Clip seconds | Engine execution | Request to locally saved | Result |
|---|---:|---:|---:|---|
| image-normal | Image | 0m 7.1s | 0m 16.3s | Passed |
| image-spicy | Image | 0m 2.9s | 0m 7.1s | Passed |
| fast-text-normal | 5 | 1m 55.7s | 1m 59.6s | Passed |
| fast-text-spicy | 5 | 1m 51.5s | 1m 55.2s | Passed |
| hq-text-normal | 10 | 8m 20.7s | 8m 25.3s | Passed |
| hq-text-spicy | 10 | 8m 21.3s | 8m 25.5s | Passed |
| fast-mixed-reference-sfw | 5 | 4m 12.0s | 4m 24.9s | Passed |
| fast-mixed-reference-nsfw | 5 | 4m 11.3s | 4m 19.5s | Passed |
| high-mixed-reference-sfw | 10 | 15m 11.6s | 15m 17.7s | Passed |
| high-mixed-reference-nsfw | 10 | 15m 8.0s | 15m 16.1s | Passed |
| fast-first-last | 5 | 2m 8.3s | 2m 17.0s | Passed |

Engine execution includes model loading, sampling, decoding and encoding; those
phases were not separately instrumented. Request-to-saved includes reference
preparation/transfers and output saving. Do not add overlapping columns.
The cancelled portrait run recorded 7m 58.8s
of engine execution before interruption; no completed video is claimed for it.

All nine completed videos have native 1344×768 dimensions, 24fps, exact requested
frame count/duration, and matching nonempty decoded audio tracks. The two images
retain 1280×720 dimensions. Repeated submissions with the same idempotency key
returned the same jobs without duplicate generation. Mixed-reference tests used
an image, a video including its soundtrack, and a separate audio reference.

The actual worker reported ComfyUI 0.35.0, PyTorch 2.11.0+cu130 and an NVIDIA RTX
PRO 6000 Blackwell Server Edition with 97,887 MiB physical VRAM. Sampled peak
usage across completed jobs was 63736 MiB
under ComfyUI's reported-memory definition. This is sampled usage, not a promise
that every maximum-reference/duration combination fits.

Native Sol sparse producer-path activation was confirmed in engine logs for
text-only and mixed-reference HQ. The early dense phase was approximately
25.5s/step versus 12.9s/step sparse for text-only HQ, and 40.3s versus 25.4s for
mixed-reference HQ. The window uses model noise levels; these observations do not
mean every job has the same speedup. No Turbo fallback was used for HQ.

Representative Fast/HQ frames were visually inspected and were coherent and
intact. These functional checks and still-frame inspection do not constitute a
controlled acting, dialogue, or temporal-quality benchmark. First/last-frame
execution passed in Fast, but visual last-frame influence was not quantitatively
validated. The cancelled portrait/silent run and unexecuted PNG runs remain
explicit live-validation limits.

## Infrastructure, timing and cleanup

The first RunPod rental, 9ndkngn38ve3f2 in EUR-IS-2, pulled the image from about
22:52:29 to 23:23:40 UTC (31m 11s), then started at 23:23:44. Calling it stuck at
20 minutes was premature. The owner subsequently reported a host maintenance
alert warning of intermittent connectivity and public-IP reassignment. The pod
had no direct SSH endpoint, although its rental public key was correctly set.
The account had no proxy SSH keys; no account key was added.

The owner authorized deleting that rental and trying another region. RunPod
confirmed deletion of its pod and disposable disk. US-NC-2, US-NE-1 and EU-RO-1
each rejected replacement allocation for unavailable capacity despite catalog
listings. Each attempt was reconciled before another attempt; no RunPod pod
remains. The owner then explicitly authorized switching to Vast.

Vast instance 50820350 used verified Spain host 43574, the same candidate image,
a 96GB RTX PRO 6000 S and 180GB disk, quoted at $1.9833/hour including disk.
It was requested at 23:35:42 UTC and became SSH-ready in approximately 3m 20s.
Actual GPU identity and VRAM were verified over SSH before inference.

| Additional phase | Elapsed |
|---|---:|
| Vast model preparation, all 14 files / 101.48GB | 3m 29.4s |
| Completed GPU matrix, first submission to last saved output | 63m 10.3s |
| Vast deletion and confirmation | 0m 2.9s |
| Installed application update | 0m 15.6s |

After the owner's approval to wrap up, the active job was cancelled and the
queue was left paused. Vast confirmed the instance was destroyed with
disk_retained=false. All completed videos remain on this PC. The pre-deletion
Vast billing snapshot showed $3.301 for this rental, including GPU, disk and
transfer; billing can lag and this is not a combined final invoice. The RunPod
billing query had no posted record at collection time, which does not mean zero
cost.

## Saved videos and evidence

Nine clearly named original MP4s and a local playback page are saved at:

`C:/projects/runpod/.local/hq/review-videos/index.html`

The original outputs also remain in the isolated test Library. Private raw
results, per-job metrics, preparation logs, full engine logs, billing snapshots,
cancellation result and confirmed deletion receipts are retained in .local/hq.
No credentials are included in this report. The model/runtime recipe was not
changed during testing; provider relocation and reduced scope were explicitly
approved by the owner.

## Additional 15-second mixed-reference validation

A second Vast rental, 50830485 in Alberta, used the same pinned worker image on
an RTX PRO 6000 Blackwell Workstation Edition: 97,887 MiB physical VRAM,
440 W, driver 595.71.05. All three additional jobs completed successfully.
Gemma was neither installed nor loaded.

| Pipeline | Engine execution | Request to saved | Physical VRAM peak |
|---|---:|---:|---:|
| HQ Normal, 15 seconds | 22m 54s | 23m 11s | 61.94 GiB |
| HQ Spicy, 15 seconds | 22m 58s | 23m 7s | 66.62 GiB |
| Fast Normal, 15 seconds | 15m 24s | 15m 37s | 67.15 GiB |

The three-job wall time was 61m 57.5s. Every output passed validation for native
1344x768 resolution, 24fps, 360 frames, and 15 seconds each of video and nonempty
audio. Inputs were the same image, a three-second video with its soundtrack,
and a separate three-second audio reference, with seed 424242 and the same
non-explicit dialogue prompt. Normal/Spicy selected the corresponding adapter.

Physical memory was sampled with nvidia-smi approximately every 1.03 seconds;
this includes allocator cache and retained models, unlike the earlier ComfyUI
memory metric. The largest sampled footprint left 28.44 GiB physically free.
Shorter spikes may be missed, and this does not establish maximum-reference or
concurrent LLM capacity. HQ Normal included cold loading; subsequent runs were
warm sequential mode switches. HQ sparse steps settled around 37.5 seconds.
Fast retained its original attention setup and eight-step Turbo workflow.

The three originals are in the main Seed Library, with additional local copies
and private measurements in `.local/gemma-h3/`. After review, the owner requested
shutdown. The CLI confirmed deletion of instance 50830485 with disk_retained=false,
and a subsequent status check returned no Vast instances. All videos remain local.
This adds maximum-duration landscape mixed-reference coverage; the previously
noted portrait/silent and PNG GPU coverage limits remain unchanged.

## Merge readiness

A fresh full verification passed before merge: build, typecheck, 90 application
tests, 70 operations tests, 61 worker tests (one skipped), and credential scan.
All 30 browser tests passed in 13.8 seconds. The initial verification attempt
hit the existing worker-connection test's five-second timeout during its first
HTTP app import, followed by a Windows teardown race; the full unchanged rerun
passed. No source or timeout changes were made to obtain the passing result.
