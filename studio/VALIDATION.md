# Validation status

Current as of September 12, 2026. This is the latest summary; the
[historical test journal](../research/development/HISTORICAL-VALIDATION.md)
retains failures, fixes, timing evidence and earlier partial bills.

| Area | Status |
|---|---|
| Local package | Windows archive installation, setup/start/status/stop and reinstall passed |
| Data preservation | Isolated reinstall and synthetic upgrade/rollback passed; future schema migrations need their own tests |
| Linux | Actual Node Debian container package install/setup/start/status/stop passed |
| Windows sign-in | Owner tested successfully; feature subsequently removed by request |
| Desktop and mobile | Owner accepted; no additional walkthrough required for this milestone |
| macOS | Deferred by owner |
| RunPod lifecycle | Global disposable RTX PRO 6000 96GB: prepare, pair, reconnect and deletion passed |
| Vast lifecycle | Verified RTX PRO 6000 96GB hosts: prepare, pair, reconnect and deletion passed |
| Model acquisition | All 14 configured files downloaded directly in recent tests; optional fallback has regression coverage |
| Generation | Prior live image/video tests passed; latest infrastructure tests did not run inference |
| Capacity | Maximum-reference 10/15-second tests deferred; successful startup does not prove capacity |
| Identity editing | Unfinished/deferred |

## Recent measured runs

| Provider / host | Base download + verification | Message to Ready | Notes |
|---|---:|---:|---|
| Vast Japan, reused host | 3m50s | 5m42s | Container cache advantage; not a fresh-host comparison |
| Vast Japan, different WS host | 8m22s | 20m54s | Includes mistaken small-GPU rental/correction; 15m49s from replacement wait to Ready |
| RunPod EUR-IS-2, Server | 14m07s | 16m20s | No SSH repair or fallback; cleanup needed a bounded safety-status wait fix |

Base manifest: 99.6248 GB; with the three user LoRAs: approximately 101.48 GB.
Layer cache state was not fully controlled. These are observations, not provider
performance guarantees. Full message-to-report time also includes cleanup and fixes.

## Billing and cleanup

Latest posted Vast charge for 50683866: **$0.558** (GPU $0.279, disk $0.010,
download $0.263, upload $0.006). Provider records may still adjust.
RunPod o4f7fcba47cz0l still returns no billing records: retain the approximately
**$0.65 estimate**, never report zero. Billing reconciliation was attempted;
RunPod's final posted amount remains outstanding without requiring another GPU.
Private evidence: `.local/closeout-vast-billing.json` and
`.local/closeout-runpod-billing.json` on the development PC.

Both test rentals were deleted. With separate owner approval, the three old
stopped RunPod pods and 150GB neil-h3-models volume were also deleted. RunPod
confirmed an empty pod and network-volume inventory. No retained GPU storage is
required by the current design.

## Closeout verification

Startup removal passed build/typecheck, 51 app tests, 43 operational tests,
42 worker tests (one platform skip), and a credential scan with no matches.
The isolated archive acceptance passed installation, setup, start/stop, reinstall,
synthetic upgrade/failed-start rollback and credential/media preservation.
Current Markdown links were checked. The updated archive and skill were installed
on the owner's PC, the retired startup entry removed, and the app restarted at its
configured LAN address. No GPU was created for closeout.

## Retired provisioning cleanup

Removed the legacy pod-setup command, volume/template provisioning and template-
based pairing fallback. Current RunPod creation retains a small secret helper;
pairing requires the recorded rental and pinned image. The existing private
configuration filename is retained solely to preserve secrets for reconnecting
current disposable rentals. GHCR base-image mirroring remains a live dependency.

Verification passed: 44 app tests, 44 operational tests, 42 worker tests (one
skip), build/typecheck and secret scan. Archive contents exclude pod-setup and
include the secret helper. Isolated package lifecycle, reinstall and rollback
acceptance passed. No GPU was rented for this removal.

## Additional legacy cleanup

Removed stale LoRA/job planning examples, the checkout-local Vast state importer
(after confirming migrated state), and the old preview-address override. Removed
the supervisor's token-driven download branch; the transfer receiver retains its
shared pinned HF download helper. Identity-edit weights remain unchanged.

Build/typecheck, 44 app tests, 44 operational tests and 37 worker tests (one skip)
passed, with no credential scan matches. A local network-disabled candidate image
passed verification, warm reuse and both transport-configuration smoke checks.
The owner subsequently authorized publication. GitHub Actions run 34672975492
published the candidate; anonymous registry access and an exact-digest CPU smoke
test passed. shared/worker-release.ts now pins that image. Local Docker push had
failed authentication; publication used the existing Actions workflow. No GPU was rented.


## H3 frame export: local implementation checkpoint (2026-09-12)

Branch feat/h3-image-edit; implementation commits 277b753 (shared confirmation)
and d301855 (frame export and Library sequences). No GPU rented and no worker
image published. The released worker digest is unchanged; live generation,
PNG transfer cost and quality remain unverified for this branch.

- Build/typecheck passed. App suite: 65 tests passed; operations: 44 passed;
  worker: 41 passed, one pre-existing skip; browser: 21 passed.
- Full verify ran successfully before the final additional HTTP integration test;
  the expanded 65-test app suite and final build passed afterward.
- Browser suite initially exposed obsolete image-to-image/duration expectations
  and an encoding error in a modified test; corrected those and reran. Restricted
  Windows execution hung during test-server teardown after tests completed;
  final unrestricted test run exited successfully in 10.6 seconds.
- Worker fixtures cover complete 120-frame capture and missing/duplicate/foreign
  outputs. Pinned native ImageFromBatch schema/source was inspected directly.
  This is not yet a real Comfy inference run.
- Local tests cover frame grouping, original-byte preservation, actual Sharp
  previews, pruning, restart recovery, stale/repeated selections, queued input
  protection, deletion, transfer retries and reuse as image references.
- Native frame images remain original PNGs. Scrubbing previews are temporary;
  selection waits for the original to display. Inspected desktop and portrait
  mobile screenshots from a real local database containing synthetic sequences.
- Package archive 87eb106a2dec0e8766471fee3c43caa16feeffc2 passed the isolated
  Windows installation harness: setup, module resolution, start/stop, reinstall,
  upgrade, failed-start rollback and credential/media preservation.

Owner UI checkpoint: http://192.168.1.212:4312/library. Two synthetic 120-frame
sequences, stored only in .local/frame-review. No credentials in that instance;
original installed app/data were not upgraded or migrated. Review scrubbing,
original detail/zoom, selecting frames, confirmation/cancel, Keep only and
Library reference picking. Fixtures can be safely pruned/deleted. Live proof,
worker publication/pinning and production installation follow owner feedback.


### Scrubbing performance follow-up

Tested the actual review app with a mobile-sized Chromium viewport, synthetic
120-frame PNG sequence, 60 ms simulated latency and 20 Mbit/s download cap.
Swept 90 frames at roughly 16 ms input intervals:

- Previous image-element renderer: 89 blank samples, one displayed distinct
  frame, 87 canceled/failed requests and 5,674 ms to settle on the original.
- Persistent canvas plus individual-frame previews removed blanking but only
  displayed ten distinct frames. This intermediate approach was superseded.
- Final cached-sheet renderer: 90 distinct frames, zero blanks, nine total media
  requests, zero failed requests, 200 ms to the original after the sweep. Maximum
  measured input-loop interval was 19 ms; this is not a GPU frame-time benchmark.
- Cold sheet preparation is still work: an immediate cold sweep showed only 14
  distinct frames while previews were being built. The UI now indicates Preparing
  previews; the smooth result above is after sheet preparation, not a cold-start
  claim. Original-quality selection intentionally remains unavailable while moving.

65 app tests, typecheck/build and all 22 browser tests passed. Added atlas image
size/revision checks and a canvas pixel test for correct tile selection followed
by original resolution. Desktop/mobile screenshots were inspected after the
change. No worker, provider, GPU or production installation change in this follow-up.
# Scrubbing feedback refinement (2026-09-12)

Build and typecheck passed. All four sequence browser checks passed, including stable control opacity during a blocked original fetch, delayed loading feedback, clearing feedback on another seek, and selection remaining unavailable until the correct original is displayed. Desktop and mobile review screenshots were refreshed against the local fixture app. No GPU needed.

## Live frame-export release preparation (2026-09-12)

### Live outcome so far: generation passed, transport recovery pending

Owner requested automatic SSH recovery. The tunnel supervisor now retains its local control endpoint and restarts the same SSH command after disconnects, backing off 1/2/4/8/16/30 seconds between attempts. Pairing and job submission are untouched. Stop cancels backoff and waits for the child to exit. Local tests cover disconnect/reconnect, failed spawn, capped backoff, and cancellation during startup/backoff. This handles transient connection loss; it does not prove the failing live network route is repaired.

Owner removed the arbitrary five-minute startup deadline after this test. Both providers now wait without a startup time limit, emit elapsed progress every 30 seconds, and retain normal error handling and manual interruption. Tests simulate nine minutes before readiness and propagate provider failure; 39 provider/recovery tests passed, with the final Vast error-state check also passing the eight-test recovery suite. Explicit deadlines remain for unrelated operations such as confirming deletion. Installed package and local skill instructions updated; no additional GPU was rented.

Vast instance 50708650, South Korea machine 38830, verified RTX PRO 6000 WS with 97,247.7 MiB reported VRAM. Rate: $1.46333/hour including 180 GB disk, ingress $0.000260417/GB. Rented at 07:18:52 UTC; authenticated SSH ready 07:26:35 after the initial five-minute wait timed out and one progress-based retry. Models started 07:27:01 and finished 07:38:06. One SSH/model-transfer process exited during the identity LoRA download; logs were collected, disk was not full, cgroup OOM count was zero, and a single resume completed all 14 files (101.48 GB). Cause of that exit remains unconfirmed.

Live job 7214742a-0f79-45ca-93c3-c4a7b056a822 used one saved SFW fox image as an H3 reference, landscape, five seconds, seed 4358172, PNG export. Native execution: 128.393 seconds, including cold loading; sampling log about 71 seconds. Manifest confirms 120 PNGs totaling 169,660,354 bytes. Native Comfy memory-accounting peak: 52,290.84 MiB (51.07 GiB), 64 samples and zero failed samples. This is sampled Comfy memory usage, not an NVML peak or minimum-VRAM guarantee. The private full manifest/telemetry were recovered locally.

The SSH tunnel timed out during execution. Restoring direct SSH brought back small status requests, but the 54,549-byte job response took 40.683 seconds over the tunnel versus 0.021 seconds inside the GPU. The provider SSH proxy route also timed out; a second PC SSH client and QoS-disabled probe did not resolve it. No inference rerun occurred. Normal Seed delivery, live Library inspection and Keep only are **not yet passed**. The 120 original files remain on the GPU. Private diagnostics are under `.local/frame-*` and the per-user Seed diagnostics folder.

Automatic approval review rejected a local-container client probe involving the PC private SSH key; it was not run. It also rejected temporary authenticated HTTPS recovery because of the added public endpoint; that endpoint was not created. Explicit owner approval is pending before that recovery path. Posted charges at the interim check: $0.825, with the instance still active and charges continuing. Do not destroy the disk with unsaved outputs without the owner's instruction.

The live host later dropped the SSH tunnel during generation. Comfy finished and retained all 120 PNGs, but Seed could not observe completion. Added `gpu vast reconnect` to restore only the recorded paired worker's tunnel, without re-pairing or changing pending jobs. A regression test rejects mismatched pairing and verifies credentials/queue remain untouched. Twenty Vast operations tests pass. This is a live-discovered recovery gap; output delivery is checked below after restoration.

Owner accepted the scrubber and selected-frame navigation and authorized one GPU test. GitHub Actions run 34679995595 published the candidate from 1cf0051; the exact pin lives in shared/worker-release.ts. Anonymous image pull and the early connection page passed a local CPU smoke check. An initial smoke invocation used an invalid HTTP public URL for HTTPS transport; startup rejected it as expected, and the corrected invocation returned HTTP 200. Temporary CPU containers were removed.

Final checks: 65 application tests, 44 operations tests, 41 worker tests (one skip), 22 browser tests, typecheck and secret scan passed. The candidate archive passed isolated Windows installation, setup, upgrade/rollback and credential/media preservation. Backed up the owner's database and updated the installed app. Live GPU generation remains pending below; these checks alone do not prove inference.
