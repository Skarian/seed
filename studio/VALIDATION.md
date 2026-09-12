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
