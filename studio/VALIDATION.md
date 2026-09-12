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
