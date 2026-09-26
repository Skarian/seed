# Worker pool implementation and review

Implementation date: September 22, 2026. Branch: `codex/fal-only`.
The implementation is in the working tree; no merge, commit, or push was performed.

## Review links

- [Approved plan](worker-pool-buildout-plan.md)
- [Numbered desktop/mobile screenshot gallery](http://192.168.1.212:4312)
- [Interactive offline demo](http://192.168.1.212:4314)
- [Application operating notes](../README.md)
- [Worker build and protocol notes](../worker/README.md)
- [Local container build evidence](../worker/build-evidence.json)
- [Follow-up QA audit and remaining validation](worker-pool-qa-audit.md)

Both review servers run on this PC and require it to remain awake. The demo has
an isolated profile under `.local/worker-pool-demo`, synthetic credentials,
simulated providers/workers, and an external-network rejection guard. Its GPU
prices and generated media are fixtures. Starting or stopping a demo worker does
not contact a provider or incur charges. Do not enter real credentials there.

## Delivered application behavior

- Sidebar GPU status and one pool popup with Image/Video worker choices,
  available Vast/RunPod offers, filters, multiple selections, quantities, and a
  combined hourly quote before launch.
- Durable server orchestration for provisioning, per-worker SSH authentication,
  model preparation, assignment, receipt reconciliation, output retrieval,
  cleanup acknowledgment, and termination. Closing the browser has no effect
  on that work. Stopping or sleeping the host PC pauses local orchestration.
- Separate worker roles and one active output per GPU. Generate and Chat share
  the same job path. Quantity can spread across compatible workers; no automatic
  renting, replacement, or idle shutdown.
- Readiness verifies the actual CUDA device, visible GPU count, memory capacity,
  role, runtime protocol, model files, and required video kernels before jobs
  can be assigned. A provider listing alone cannot mark a worker Ready.
- Per-worker and pool-wide **Finish jobs and quit** and **Cancel jobs and quit
  now**. Quit remains independent of stuck preparation, submission, or saving.
  Late responses cannot reverse quit intent. Billing estimates remain active
  until the provider confirms termination.
- Admin credentials for Vast, RunPod, OpenRouter, Civitai, and optional Hugging
  Face. Setup is keyless. Saved keys are authoritative; replacement provider
  keys must retain access to unresolved rentals.
- Metadata-only Civitai imports with explicit file-to-workflow mapping. New
  workers directly download every enabled, compatible original adapter. A
  worker's launch manifest and ready inventory are frozen; later imports wait
  for later workers. Failed optional adapters can be retried or omitted before
  readiness. No adapter binaries are relayed through the PC.
- An explicit recovery option for failed mandatory base-model downloads:
  download the pinned file through this PC, verify it, and resume transfer to
  that worker. Cancellation stops the local transfer immediately.
- Restored H3 mixed references and frame guides, preserved Library and Pick
  Frame, shared UI hooks and provider-independent request contracts. Active fal
  execution, uploads, conversion, and generation-price gates are removed;
  historical receipts remain readable.

## Verification

- Production build, TypeScript checks, and full application suite: 260 tests
  passed, including all 18 worker lifecycle tests.
- Credential scan: zero potential matches.
- Packaged install check: passed keyless setup, Admin credential persistence,
  start/stop, reinstall, synthetic version upgrade, failed-start rollback,
  preservation of media/custom instructions/credentials, and restart.
- Worker CPU suite: 80 tests passed. Real TypeScript graph payloads were checked
  against Python worker validation for Image/FL/Ref and zero, one, and three
  adapters.
- Both local containers passed startup/authentication checks. All 25 Qwen files
  (33,131,609,424 bytes) passed offline verification inside the final Image
  container, and its Qwen pipeline imported successfully.
- Browser interaction suite: 33 of 33 passed in one clean run, including both
  provider launch selections, reload persistence, Chat approval, model-download
  fallback, saving before release, and video preview/Pick Frame.
- Visual atlas: 82 of 82 desktop/mobile capture scenarios passed their assertions.
  This is not individual visual sign-off on every image; the follow-up QA audit
  records fixture isolation and capture coverage gaps. The gallery includes
  individual full-size images, numbered mosaics,
  captions, pass/fail status, and a machine-readable index. Coverage is
  representative, not a claim to enumerate every possible state combination.

Chrome computer use succeeded against the LAN URLs after the initial loopback
page was blocked. The live gallery, worker popup, provider selections, combined
quote, and simulated launch were inspected in Chrome in addition to the automated
Playwright runs and screenshot review.

## Release boundary

The subsequent [recovery and container transport pass](worker-pool-recovery-validation.md)
passed six abrupt coordinator shutdown scenarios and ten real SSH/worker
transport checks against these images. It fixed application-side OpenSSH trust
file handling for Windows paths containing spaces. GPU inference remains untested.

Both role images built locally and passed startup, authentication, pairing,
manifest rejection, and packaged-source checks. The Image build reused a
locally recovered, checksum-verified Qwen asset layer, then assembled the final
image using the checked-in Dockerfile and current worker source. This was not a
second clean download build. The Image target contains the actual Qwen assets
and runtime; Qwen remains unloaded and its product workflows are deferred.

The subsequent approved publication pass published both role images to GHCR,
verified anonymous registry access and pinned their digests in
`worker/releases.json`, including the running app's release manifest. The Image
artifact was repackaged into individual Qwen shard layers to fit GHCR's 10 GB
per-layer limit. All 25 model file hashes, 29 worker source fingerprints,
startup/authentication checks and ten SSH transport checks passed again.
See [publication evidence](../worker/publication-evidence.json).

Live availability returned 67 Image offers (50 Vast, 17 RunPod) and two Video
offers (RunPod), with no provider errors. These are a point-in-time availability
check, not a placement guarantee. No paid inference, GPU rental or provider
resource was created; active workers and estimated spend remained zero.

This phase does not establish real GPU latency, model quality, Qwen editing
quality, or live placement reliability. The existing H3 recipe is preserved;
performance tuning and Qwen editing UI/workflows remain deferred.
