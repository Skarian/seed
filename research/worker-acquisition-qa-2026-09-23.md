# Worker acquisition UX and QA — 2026-09-23

The real application now shows acquisition, model downloads, file verification and engine startup as separate phases. Streaming worker telemetry supplies bytes, throughput and an estimated remaining download time. Engine startup is explicitly excluded from that estimate. Missing or stale telemetry does not produce a fabricated ETA. The sidebar distinguishes preparing, ready and busy workers. A worker-ready toast appears once for workers observed preparing during the current browser session, including workers that immediately accept queued jobs.

Lifecycle and downloads remain server-side. The UI can be closed without stopping preparation or jobs. Existing recovery and explicit shutdown controls remain available. Paused preparation uses amber progress styling.

## Validation

- Application build and TypeScript validation passed.
- 268 application tests passed across 32 files.
- 86 Linux worker tests passed, including transfer-rate, resume, progress callback and stale-telemetry cases.
- 35 browser regression tests passed, including narrow/short screens, reload recovery, provider selection, both shutdown modes, result saving and preview.
- 57 representative UX scenarios were captured on desktop (1440 × 1000) and mobile (390 × 844): 114 passing scenarios, zero failing or missing.
- All 153 final screenshots, including overflow scroll positions, were opened and reviewed individually. Mosaics were not used as the basis for approving individual screens.
- Both replacement containers passed packaged-source verification and offline startup/auth checks. No new GPU inference was run for this update.
- Chrome computer use confirmed the updated real app and the LAN visual gallery. The app had zero active workers and queued/running jobs before restart.
- GPU rental spend for this QA run: $0.

Coverage includes Generate, Admin, LoRA mapping, Chat approval, Library, Preview, Activity, acquisition, live/stalled downloads, verification, engine startup, ready notifications, automatic queued-job dispatch, recovery, quitting and mixed worker states. This is representative lifecycle and pairwise coverage, not an assertion that every possible input combination was tested.

## Findings corrected

1. Paused setup initially retained green progress styling. Changed the bar and active stage marker to amber; rechecked desktop/mobile failure views.
2. The image-download fixture reused a video ETA. Calculate it from remaining bytes and throughput; recaptured both image views.
3. The mixed-pool fixture incorrectly sent an already-ready worker back to Starting. Scope acquisition to workers without initial readiness and assert one Ready plus one Starting worker.
4. New queued-job fixtures lacked idempotency keys; the adapter recovery fixture used the wrong worker class. Corrected both.
5. The automatic-dispatch test inspected the transient ready toast too late. Assert the toast before waiting for generation. Two isolated fixture startup timeouts passed on targeted reruns; no application change was needed.

## Access and publication

- Real app: http://192.168.1.212:4310
- Numbered desktop/mobile mosaics and full-resolution captures: http://192.168.1.212:4312
- Capture manifest: `.local/worker-pool-atlas/manifest.json`
- Individual review journal: `.local/acquisition-qa/visual-review.json`

The replacement video image is published and activated at `ghcr.io/skarian/seed-worker-video@sha256:4bcf501766cafe5d3582630134131906b7768e7be532b6eb8aac30b8b5869f5d`.

After explicit user approval, the image replacement was published and activated at `ghcr.io/skarian/seed-worker-image@sha256:aeda5b387bffd635761d8a2de521ed98a0869807ced7ece688877c66eeafb426` (tag `v0.1.0-pool.3-e6f3cfd215fd`). Registry manifest/config integrity and anonymous access to all 60 layers were verified. The published configuration exactly matches the tested image ID `sha256:e6f3cfd215fdb2cf80e8726f309f6051769d270bb3d8b4a23d0ce4641340e442`. A local tag had moved to a later build, so publication selected the original verified immutable image ID. Both worker classes now use the verified acquisition-progress release for new rentals. No GPU was rented for publication.
