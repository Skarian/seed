# Acquisition qualification and persistent diagnostics

23 September 2026. Live qualification finished; independent compute and disk cleanup confirmed.

## Durable application history

Seed now retains provider HTTP failures, bounded response bodies, statuses, request identifiers, durations, Retry-After values and correlation to workers/jobs in its normal SQLite database. SSH errors, startup logs, model preparation errors, engine logs, job transitions and deletion verification are recorded too. Failed diagnostic collection is itself recorded. Rental deletion, browser closure and application restart do not erase history.

Provider logs are captured before SSH is usable: RunPod's container/system stream; Vast's daemon export during image acquisition and its process log when a running container cannot connect. Worker download stderr previously went to DEVNULL; the published diagnostics images retain redacted errors instead.

Detailed events: 90 days or 10,000 events. Acquisition summaries, milestones and grouped failure evidence: retained separately until application data is deliberately removed. Failures retain first/last occurrence and occurrence counts. Old rentals are marked partial coverage; missing timestamps are not invented outcomes.

Secrets are removed before persistence, including Admin credentials, pairing secrets, signed URL queries and sensitive structured fields, including JSON nested in strings. Logs remain private local data. A diagnostics write failure is surfaced through API health, stderr and a fallback log, without blocking worker termination.

## Queries for future comparisons

```powershell
node dist/server/cli.js diagnostics --since 2026-09-23 --provider vast --class image
node dist/server/cli.js diagnostics --worker WORKER_ID
```

These production queries return attempts, readiness outcomes, recovery/manual flags, readiness timing, estimated cost, milestones, grouped failures and paginated details. HTTP equivalents: `/api/v1/pool/history` (date filters `from`/`to`, `provider`, `worker_class`) and `/api/v1/pool/workers/WORKER_ID/history`. Future answers can use this evidence rather than chat memory. Provider invoices remain authoritative.

## Campaign method

Approved ceiling: **$10**, with cleanup starting by **$8** estimated spend. The original target was eight journeys, Image and Video twice per provider. Extra fresh Image attempts investigated a real Vast SSH failure. No failed worker was repaired remotely or retroactively counted as an unassisted pass.

Rentals and jobs were submitted through the actual application UI using Admin credentials and pinned public images. Tests used real Krea images, Qwen edits, H3 text video and H3 video with three actual image references. Browser closure/reopening and a planned application restart preserved rentals and queued work. Generate, Chat approval, shared previews, Pick Frame, graceful release during a job, and cancellation during a video were exercised.

An automatic approval review temporarily misread an older $5 cap. All eight rentals were deleted at approximately $5.32 cumulative estimated spend. The original $10 proposal and user approval were recovered from thread history; the subsequent UI action was accepted. The same campaign resumed with cumulative spend intact and the $8 guard active. The rejected action created no rental.

Private evidence: `.local/acquisition-qualification/2026-09-23T20-17-05.928Z`, including per-worker records, provider logs, job timings, budget events, provider inventories and individual screenshots. Logs are not served in the visual gallery.

## Attempt scorecard

11 fresh rentals; **6 reached readiness and saved a real generation**. Failed and incomplete attempts remain below. Rental estimates include compute and attached storage; transfer allowance is accounted separately in the campaign total.

| # | Provider / class / GPU | Ready | Saved jobs | Rental estimate | Outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | runpod / image / NVIDIA RTX PRO 4500 Blackwell | 7m 12.7s | 2 | $0.1147 | Krea and Qwen saved; graceful quit saved the running edit. |
| 2 | vast / image / RTX 5090 | — | 0 | $0.8539 | Incomplete: repeated registry-layer retries; released during campaign cleanup before container readiness. |
| 3 | runpod / video / NVIDIA RTX PRO 6000 Blackwell Server Edition | 17m 42.4s | 1 | $0.7241 | H3 text video saved; graceful quit saved the running video. |
| 4 | vast / video / RTX PRO 6000 S | 15m 24.0s | 1 | $0.5451 | Three-reference H3 saved; deletion recovered automatically from a real HTTP 429. |
| 5 | runpod / image / NVIDIA RTX PRO 4500 Blackwell | 7m 4.1s | 3 | $0.1502 | Krea, Chat generation and Qwen edit saved; graceful quit succeeded. |
| 6 | runpod / video / NVIDIA RTX PRO 6000 Blackwell Server Edition | — | 0 | $1.1011 | Incomplete: provider still fetching image at cleanup; never reached SSH. |
| 7 | vast / image / RTX 5090 | — | 0 | $0.2487 | Failed: SSH authentication; exited-process error was initially discarded. No remote repair. |
| 8 | vast / video / RTX PRO 6000 S | 6m 30.5s | 1 | $0.3498 | H3 text video saved; separate running video cancelled by immediate quit. |
| 9 | vast / image / RTX 5090 | — | 0 | $0.0353 | Failed fresh retry: delayed key registration alone did not solve SSH authentication. |
| 10 | vast / image / RTX 5090 | — | 0 | $0.0211 | Failed fresh retry: key-file isolation alone did not solve SSH authentication. |
| 11 | vast / image / RTX 5090 | 11m 32.8s | 2 | $0.1281 | Krea and Qwen saved without manual intervention. Same physical Vast host as attempts 7, 9 and 10; container base layers cached. One transient connection error recovered automatically. |

Full worker IDs, image pins and provider resource IDs are retained in the private history and application diagnostics.


## Timing interpretation

Readiness includes provider container startup, model downloads/verification and engine startup. It is not inference time. Successful H3 requests were five seconds at 1344×768 with native audio. Submission-to-save times: RunPod text video **167.7s**, Vast three-reference video **193.7s**, second Vast text video **183.2s**. These include transfer/save overhead. Queueing while waiting for a worker is recorded separately.

First RunPod Image: Krea **11.8s**, Qwen **20.7s** from worker submission to save. Second RunPod Image: Krea **15.0s**, Chat image **6.7s**, Qwen edit **22.3s**. The final Vast Image reached readiness in **11m 32.8s**, then saved Krea in **24.9s** and Qwen in **27.0s**. Its container base layers were cached, but model assets were downloaded to a fresh disk. A transient connection failure during preparation recovered automatically and remains in its history. These are application timings, not kernel benchmarks.

The image request originally queued during the first Vast Image startup was ultimately executed by the second RunPod Image. It is credited to RunPod and does not turn the Vast attempt into a success.

## Findings and corrections

- **Dialog scroll:** offer-to-worker transition left the heading above the viewport. Reset dialog/content scroll on launch; verified in a subsequent real acquisition.
- **Activity-to-editor handoff:** Edit image from an Activity preview left Activity covering the editor. Close Activity on that navigation event; verified against a real saved Qwen result after rebuilding.
- **SSH state loss:** an exited subprocess's authentication error was discarded and startup grace repeatedly reset. Preserve both; the real failure now shows Needs attention, Reconnect and both shutdown options.
- **SSH initialization:** moving instance-key registration after SSH availability did not fix the failure. Isolating the authorized-key file alone also failed. Both fresh attempts remain in the scorecard. The final Image release uses `SEED_SSH_PUBLIC_KEY` independently of the provider's generic `PUBLIC_KEY`, stores the key in `/run/seed-ssh`, and emits SSH server diagnostics/public fingerprints. A fresh rental on the same failing host accepted the matching key without repair. This proves authentication on that launch, not every provider's internal key-injection behavior.
- **Expected startup waits:** brief initial SSH waits and host-key notices are informational; persistent unavailability/authentication errors remain failures.
- **Deletion rate limiting:** retained a real Vast HTML 429 with `Retry-After: 3`. The app recovered automatically and verified deletion. Scheduling now respects Retry-After instead of repeating DELETE every two seconds.
- **GPU catalog:** exclude known pre-Turing devices incompatible with the pinned CUDA 13 runtime; recognize observed Blackwell `RTX PRO 6000 S`/`WS` aliases so suitable video capacity is visible.
- **Provider logs:** bounded retries for asynchronous Vast exports that initially return S3 403/404; retain the collection error if still unavailable. Running-container SSH failures collect process logs separately from daemon logs.
- **Nested provider JSON:** apply structural redaction to the stringified SSH-key metadata returned by Vast.

Real responses became focused regression fixtures. Those tests cover observed shapes, not general marketplace reliability.

## Validation and limits

306 application tests across 35 files, typecheck and production build passed. 90 Linux worker tests passed. Final Image candidate also passed a real SSH handshake through its packaged entrypoint with conflicting provider/Seed keys, replacement of the provider-managed key file and rejection of an unrelated key. Packaged source fingerprints and anonymous registry manifest/configuration/layer access were verified.

The original diagnostics Image and Video releases both completed actual GPU generations. The final Image SSH release also completed fresh live generation qualification. Model checkpoints/settings and idle policy were unchanged. Video retains its generation-qualified diagnostics image; the new Image entrypoint was not deployed to Video.

This selected sample is not a statistical provider reliability estimate. Container pulls stopped by campaign cleanup are incomplete, not proven permanent outages. Failed attempts and unsuccessful fixes remain visible.

## Visual review

[LAN gallery: numbered captures and mosaics](http://192.168.1.212:4312/acquisition-2026-09-23/index.html). Every screenshot was inspected individually before mosaic assembly. This gallery covers actual live journeys, not an exhaustive product permutation matrix. Decisions: `research/acquisition-qualification-visual-review.json`.

## Cleanup and spend

Independent compute inventory at 2026-09-23T22:20:18.861Z: Vast **0**, RunPod **0**. Independent volume inventory at 2026-09-23T22:20:19.313Z: Vast local/network volumes **0**, RunPod network volumes **0**. All campaign workers were terminated, not stopped; their attached disposable disks were deleted with them. No pre-existing volume was deleted.

Campaign estimate: **$6.21**, including compute/storage plus a conservative Vast transfer allowance. This is not a provider invoice. The $10 cap was not approached; unused authorization remains unspent. The campaign guard has been stopped after cleanup.

Final redaction audit: 2034 records scanned, **0 installed-credential/pairing-secret matches**.
