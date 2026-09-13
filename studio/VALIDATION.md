# Validation status

Current as of September 13, 2026. This is the latest summary; the
[historical test journal](../research/development/HISTORICAL-VALIDATION.md)
retains failures, fixes, timing evidence and earlier partial bills.

## Chat implementation acceptance (2026-09-13)

Owner subsequently authorized testing the saved key. The first live request
exposed OpenAI-specific `store` / `max_completion_tokens` fields rejected by
OpenRouter strict parameter routing. The adapter now omits `store` and sends
`max_tokens`; regression checks, build and typecheck pass. A live Parasail reply
succeeded with reasoning enabled (27 input / 59 output tokens, reported cost
$0.00002711). The installed Chat subsequently replied successfully through
DeepInfra despite the Parasail preference (311 input / 43 output tokens,
$0.00004261). This confirms an alternate provider was selected, but does not
establish why Parasail was bypassed. Live tools, image interpretation and GPU
generation remain untested.

Implemented on `codex/seed-chat-openrouter`. Local verification passed: 106
application tests, 70 operations tests, 61 worker tests (one skipped), typecheck,
build and credential scan (328 files, no potential matches). Browser coverage
includes 33 cases: the full run passed 32 and exposed an ambiguous new-chat
selector; after the accessible-name fix, all three Chat cases passed. The final
shared-viewer change also passed Chat and generation browser checks. Tests use
fake OpenRouter/worker transports and isolated storage.

The final archive passed Windows installation, setup, restart, reinstall,
synthetic version upgrade, broken-start rollback, and media/credential/custom
prompt preservation (fixture `seed-package-OWmPok`). Installed the archive after
stopping the idle owner app and backing up SQLite under
`.local/backups/seed-before-chat/`. The restarted `/chat` returns 200 at the
existing LAN address. Installed Chat service matches the built source; all 42
assets and 69 historical jobs remain, with zero active/waiting jobs.

The optional OpenRouter key is not configured. Owner can use
`seed setup --chat-only` while the app runs. Prompt defaults were initialized in
the per-user Config/prompting directory. No paid hosted inference, real provider
fallback, or GPU generation was run for Chat; these and owner visual acceptance
remain explicit follow-up checkpoints.

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

## H3 High Quality candidate — September 12, 2026

The optional HQ implementation and native-resolution exports passed local
application, operations, worker, browser and package checks. Eleven live GPU
jobs passed on a verified 96GB Vast worker, covering both content/quality modes,
mixed references and Fast first/last frames. Native sparse attention was verified
in GPU logs. The owner approved ending testing: the 15-second portrait HQ run
was cancelled and the two PNG GPU runs were skipped. Both rented workers and
their disks were deleted; nine completed videos remain saved locally. The
installed app uses the published candidate and High Quality defaults off. See the
[candidate report](../research/development/H3-HQ-VALIDATION-2026-09-12.md)
for timings, the unexecuted test matrix and exact image identity.

## Spicy mode acceptance — September 12, 2026

Owner accepted the shared mode and final centered toast placement. Build and
TypeScript checks passed. Browser coverage passed for Library filtering, reference
picker reuse, image/video mode submission, preserved drafts, mouse/keyboard/touch
holds, canceled holds, session persistence, and mode changes during submission.
The toast was visually reviewed on mobile and its entrance, exit, and removal
were verified against the running LAN app. No paid generation was used.
The browser test server required explicit termination during Windows teardown.

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

Final checks: 65 application tests, 44 operations tests, 41 worker tests (one skip), 22 browser tests, typecheck and secret scan passed. The candidate archive passed isolated Windows installation, setup, upgrade/rollback and credential/media preservation. Backed up the owner's database and updated the installed app. Live generation subsequently passed as recorded above; delivery to the local Library remains unverified.

## Branch integration checkpoint (2026-09-12)

Before merging to main: build, typecheck, 65 application tests, 52 operations tests, 41 worker tests (one skipped), and credential scan passed. Browser checks were not repeated for this documentation-only checkpoint. Live frame delivery remains unverified. Owner requested GPU teardown; stop was accepted for Vast 50708650, retaining its disk because automatic approval review rejected destruction of unrecovered test outputs without explicit discard approval. Tailscale is a proposed next feature, not implemented.

## Rental closeout (2026-09-12)

Owner explicitly authorized discarding the test frames and deleting the disk. Vast instance 50708650 was deleted; the subsequent instance listing was empty. The 120 remote originals were not recovered. Saved local manifest/logs remain evidence of generation, not successful delivery. A fresh authorized test is required for end-to-end delivery.

## SSH-only recovery checkpoint (2026-09-12)

The candidate worker is pinned to `sha256:5c5e6119e6f6b0c4ec4a6cde5f833041c531ae3a833e038b75ee0ba4b4d15b50`.
Local unattended recovery acceptance, all 22 browser tests, and isolated package
installation/upgrade checks passed. The [SSH recovery report](../research/infrastructure/2026-09-12-ssh-recovery.md)
records the cases and their limits; these networking fixtures do not measure model inference.

RunPod passed preparation recovery, the job transfer blackhole test, and restart
recovery. Private evidence: `.local/networking/preparation-runpod-recovery.json`,
`ssh-recovery-NgGQtD`, and `ssh-recovery-J1Izx7`. Its test pod and disposable disk
were deleted and absence confirmed. A final RunPod check explicitly covered native
generation finishing during an outage (`ssh-recovery-tVcXZ4`); it passed, and that
additional pod/disk were deleted. The first Vast host failed SSH authentication
and was deleted after log collection. Replacement Vast instance `50795178` passed
preparation recovery and all job transfer boundaries, including native execution
finishing during an outage. Evidence: `preparation-vast-recovery.json` and
`ssh-recovery-IFxbad`. That VM and disk were deleted too; both providers' final
compute and volume inventories were empty.

The installed PC package includes changes through `2acb9d4`. The Library renders
correctly at the existing LAN address on port 4310. The historical, explicitly
discarded frame job was reconciled without deleting any of the 37 existing assets.
Engineering acceptance is complete. The owner checkpoint and branch merge remain
open. Posted charges and their billing-delay limits are in the recovery report.

### Live image-card correction (2026-09-13)

The owner's first image request exposed a workflow schema bug: image tools
advertised video-only sizes and unrestricted seeds. Gemma submitted `native`
with a descriptive seed, then falsely claimed success after validation failed.
The schema now restricts image output to `1mp`, requires video duration only for
video, and describes/constrains seed syntax. Failed tool results are recorded as
visible chat events and unresolved failures set the chat error. Tool guidance
explicitly requires successful creation before claiming a card exists.

Seventeen Chat/provider tests, typecheck and build passed, including the exact
invalid-settings/false-success regression. Installed the fix and retried the
owner's puppy request: one durable, undecided image card is now in the Connection
test chat, with no submitted jobs. Image generation still requires owner approval
and a connected worker; no GPU generation was performed.

### Approval error visibility (2026-09-13)

Owner reported Generate doing nothing while the worker was disconnected. The
request remained undecided with no jobs; approval errors rendered behind the
modal. Review now displays action errors inside the dialog. All three Chat
browser cases, build and typecheck pass, including a rejected approval whose
error stays visible in the open modal. Updated the installed app. No GPU rented
or generation submitted.

Follow-up: owner still saw no error. The installed desktop/mobile UI displayed
mocked failures, so the exact missing-message symptom was not reproduced. A
read-only worker capability check returned `fetch failed`. Chat now translates
that into an actionable disconnected-worker message, places a highlighted error
beside Generate and scrolls/focuses it. Three browser tests, build and typecheck
passed. After installation, a phone-sized browser with that mocked response
confirmed the full message visible and focused. Real Generate replay was blocked
by automatic approval review due to possible paid job submission; no job was
submitted during diagnosis.


## Sidebar and UI overhaul (2026-09-13)

Installed a shared sidebar with GPU/Jobs collapsibles, Library/Generate/Chat
navigation and page-specific options. Desktop opens at 1100px; mobile uses a
modal 78vw drawer. Chat fills the viewport with independent history scrolling,
a growing composer, clear primary actions and keyboard-aware viewport sizing.
All six dialog types use Radix Dialog through Modal. Library kind filtering
happens before pagination. Chat partial text now arrives through SSE; a local
HTTP check confirms streams end cleanly on server shutdown.

Validation: 109 application tests passed (single-worker run after one timing-
sensitive transfer test failed under concurrent browser load); typecheck/build
and credential scan passed. All 34 browser cases passed. Expanded design QA then
passed streaming visibility, drawer size/focus, modal scroll locking, a reduced
keyboard viewport, and a 40-message long conversation. Visually inspected
screenshots for desktop/mobile Chat, review dialogs, mobile drawer, Generate,
and reduced viewport. Evidence is in `.local/qa-*.png` and browser test outputs.

The first isolated package run failed its startup probe despite a listening
server log; retry without concurrent suite load passed install, setup, upgrade,
rollback and data preservation (`seed-package-hCTwyf`). No claim is made that
this isolated probe failure's root cause is established. No paid model or GPU
requests were submitted during the redesign. Physical iOS/Android keyboard and
owner visual acceptance remain to be checked on the actual devices.


## Reference-informed Chat refinement

See [UI reference study](UI-REFERENCES.md). Replaced the composer dropdown with
a caret-aware slash menu, compact active-workflow label, and denser sidebar and
composer spacing. Full browser regression: 34 passed; final command-submission
edge cases verified in the Chat suite. Build/typecheck passed. Visually inspected
desktop and mobile menu screenshots; no paid requests submitted.

Chat command follow-up: Generate and Chat share workflow labels. The reasoning checkbox is replaced by /reasoning with current state in the command menu and toast feedback. Build/typecheck and all four Chat/responsive checks passed; mobile command menu inspected.

Welcome screen: centered serif heading ('What shall we create today?') above a bottom composer, based on the owner's revised reference. The no-selection state accepts input directly and creates a chat on first send or settings change. Five Chat/responsive browser checks passed, including first-send transition and reduced-height viewport; desktop/mobile screenshots inspected. Physical phone keyboard remains unverified.

Scroll follow: reviewed Open WebUI Chat.svelte response scroll scheduling. Seed follows within 80px of the bottom, preserves reading position above that, and observes content/viewport size changes. Browser checks cover multiple streamed chunks, scrolling away and back, viewport reflow, and delayed content growth. Typecheck/build pass.
