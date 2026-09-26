# Startup logs: real-provider acceptance

Tested the published app at `http://192.168.1.212:4310` on September 26, 2026 UTC (September 25 local time). User authorized $5 total. Both acquisitions and both shutdowns were performed through the real application in the browser. No production-code changes or image updates were needed.

## Results

| Test | Vast image worker | RunPod video worker |
| --- | --- | --- |
| Hardware | RTX PRO 6000 Max-Q, 96 GB class | RTX PRO 6000 Blackwell Server Edition, 96 GB |
| Rate, including disposable disk | $1.44967/hour | $2.11514/hour |
| Worker ID | `6bbce22f-3e48-4649-a619-ac4718dd9527` | `e245d3ae-424a-46a0-aeab-38c5b5d685e7` |
| Provider ID | `52684491` | `tq30s11ellwhwx` |
| Requested | 03:08:07.022 UTC | 03:17:07.329 UTC |
| First preparation event | 03:14:06.059 UTC | 03:17:43.875 UTC |
| Engine startup event | 03:14:28.735 UTC | 03:18:49.840 UTC |
| Ready | 03:14:35.538 UTC | 03:18:57.903 UTC |
| Request to Ready | 6m 28.5s | 1m 50.6s |
| Downloaded and verified | 20.55 GB, 4 files | 75.19 GB, 7 files |
| Release confirmed | 03:15:22.329 UTC | 03:19:45.125 UTC |
| Estimated lifetime compute and disk | $0.17513 | $0.09107 |

Combined compute/disk estimate: **$0.26620**. Vast bandwidth is additional and is not included in that estimate; the chosen host listed a very low inbound transfer fee (UI rounded to $0.0001/GB). These are rental-rate estimates, not a settled invoice.

The substantial latency difference was before model preparation: approximately 359 seconds on Vast versus 37 seconds on RunPod. Vast continued reporting completed container layers during that interval; there was no observed startup failure. These were different images on different hosts, so this is not a controlled provider-performance comparison.

## What passed

- Real RunPod system logs and Vast daemon logs appeared in the shared UI. Download, checksum, extraction and container-start messages were visible.
- Closing the Vast worker panel did not stop server collection. Reopening showed newer saved output.
- Both workers handed off from provider logs to structured model setup. File verification and generation-engine availability were recorded.
- Both became Ready without manual recovery, reconfiguration or a replacement rental. Provider collection stopped at preparation; the complete record sealed at Ready.
- Saved logs remained available after release. RunPod's released record was opened again in the browser and its saved sources/timestamp checked.
- The Vast "Finish jobs and quit" and RunPod "Cancel jobs and quit now" confirmation dialogs both appeared and correctly identified the worker and disk. Both queues were empty; this does not test cancellation during generation.
- Exact-resource provider lookups confirmed both rentals absent after teardown. RunPod had no attached network volume. Final provider inventory reported zero pods and zero Vast instances; the app reported zero active workers.
- Desktop (1440px) and mobile (390px) views were inspected individually. Long GPU names and log lines wrapped without horizontal overflow. Browser viewport was restored after QA.

## Scope and evidence

No generation was submitted. No user request, prompt, chat, upload or generated media was inspected. The preflight check read only a pending-job count. Only the two new workers' startup/setup logs were collected. Ready here means files and the engine are available, not that a first inference has loaded all model weights into VRAM.

No real startup errors occurred. Rate limits, permission failures, unavailable logs, failed downloads and late callbacks remain covered by the focused automated tests; this run does not claim live fault injection or universal provider reliability.

Private local evidence: `.local/live-startup-2026-09-26/`. It contains timestamped, scoped startup snapshots, safe provider-status extracts, exact-resource cleanup receipts, preflight/final inventories and individually reviewed browser screenshots. Test guards exited after confirming release. Persistent worker-history annotations identify this campaign as `startup-logs-live-2026-09-26`.

Screenshots: [desktop](http://192.168.1.212:4314/startup-logs-live/runpod-released-desktop.png), [mobile](http://192.168.1.212:4314/startup-logs-live/runpod-mobile.png).
