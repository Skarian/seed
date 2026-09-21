# Fresh Vast lifecycle after the SSH ownership fix

The owner requested: delete the working rental and disk, create a fresh one,
reach readiness, delete it and its disk, investigate errors, and measure from
their message. This was a startup/preparation test, not a generation benchmark.

## Timeline

The original message timestamp is **2026-09-12 21:03:24.982 UTC**, read from the
conversation record. Total to confirmed deletion: **18m 44s**. Final independent
empty inventory check: **19m 15s** after the message.

| Milestone | UTC | Since message |
| --- | --- | --- |
| Previous VM 50797980 and disk confirmed deleted | 21:04:08.517 | 0m 44s |
| Corrected image published | 21:09:40 | 6m 15s |
| Fresh rental 50802138 confirmed | 21:12:44.576 | 9m 20s |
| Container loaded (provider log) | 21:15:33 | 12m 08s |
| Authenticated SSH readiness | 21:15:44.782 | 12m 20s |
| Seed pairing complete | 21:16:13.736 | 12m 49s |
| All 14 files / 101.48 GB verified | 21:20:38.285 | 17m 13s |
| Worker Ready observed | 21:20:51.695 | 17m 27s |
| Fresh VM and disk confirmed deleted | 21:22:08.978 | 18m 44s |
| Independent instances/volumes inventory empty | 21:22:39.913 | 19m 15s |

The fresh rental request took **0.852 seconds**. Acquisition to SSH readiness was
**3m 00s**. Pairing took **6.623 seconds**. The single model-preparation command
took **4m 19.839s**; Ready was observed 13.410 seconds later. Fresh acquisition
request to Ready was **8m 08s**. Fresh acquisition request through deletion was
**9m 25s**. The overall timer also includes image publication, local packaging and
installation, offer selection, agent/tool handoffs, diagnostics and final checks.
It is not represented as a normal prepublished-image cold-start time.

GitHub job 103620953091: cleanup 21:04:14–21:05:22, image build
21:05:22–21:09:34, publication 21:09:34–21:09:40. No rental billed during that build.

## Configuration and result

Verified Switzerland machine 135884, 96 GB RTX PRO 6000 WS, advertised 7.42 Gbit/s
download and 99.76% reliability. Price **$2.136/hour including 180 GB disk**;
download $0.00260417/GB. The prior Virginia offer was unavailable. Lower-hourly
offers charged around $3.80–$3.90 per 100 GB, making them more expensive for this test.

Published worker: `ghcr.io/skarian/seed-worker@sha256:a48f56da5d5fd2699f436a1941dd62288257b4930504f59dfee949000501405e`, source `f0e50d7`,
GitHub run 34718887178. The installed CLI was updated to this exact pin.

Fresh disk; standard Seed CLI rent/wait/connect/boot commands; no provider
onstart override, manual ownership repair, command retry, or model-cache reuse
from the discarded disk. Underlying provider image-layer caching was not controlled.
Post-start inspection showed root ownership and 0700/0600 modes. SSH and model
preparation commands all exited successfully. No user generations were submitted.

## Errors investigated

- No SSH authentication failure or failed model-preparation command occurred.
- Vast's wrapper logs `sshd: no hostkeys available` before Seed creates host keys.
  Seed then creates them and starts SSH successfully. This is an early wrapper
  ordering warning, not the previous key-ownership failure.
- A real status-handling defect remains: `Jobs.reconcile()` immediately requests
  `/comfy/capabilities` while the worker is preparing models and Comfy is absent.
  `worker/jobs.py` lets the resulting `ClientConnectorError` reach the general
  HTTP 500 handler. A controlled probe returned worker status 200/Preparing and
  capabilities 500/worker_error during preparation. After engine startup, both
  returned 200 and capabilities reported ready. This did not block preparation
  or require recovery, but the log/error message is misleading. Follow-up is
  recorded in TODO; no mid-test runtime patch hid it.

## Cost and evidence

At 21:22:39 UTC the fresh rental had **$0.457 posted** (GPU $0.241, disk $0.005,
download $0.208, upload $0.003). Billing had only posted 79.7 GB of download at
that point, so this is not a settled final invoice. Estimate **about $0.65**, allowing
for the full quoted rental duration, roughly 101.5 GB of models, image transfer
where billed, and small diagnostics transfers. Earlier session 50797980 separately
showed $0.812 posted. These figures exclude any separately billed GitHub Actions usage.

Private evidence: `.local/networking/fresh-lifecycle-origin.json`,
`fresh-lifecycle-20260912.jsonl`, `ownership-build.json`, `fresh-preparing-probe.json`,
`fresh-ready-probe.json`, `fresh-lifecycle-final-audit.json`, and
`vast-50802138-final-{container,daemon}.json`. Provider inventory returned no Vast
instances or volumes. The local PC app and Library remain intact.
