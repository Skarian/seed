# Worker pool reliability audit and proposed qualification matrix

23 September 2026. Planning and source audit only; no new rentals, paid calls, or application changes in this pass.

## Assessment

Real generation is working. Acquisition has not yet demonstrated sufficiently repeatable, intervention-free behavior to call the entire application dependable. The latest qualification needed provider integration fixes as well as replacement of two unsuitable hosts. Those are different failure classes, and a successful image after manual repair does not qualify the original launch journey.

The [paid Qwen qualification](qwen-image-edit-gpu-qualification-2026-09-23.md) records five rentals: three became usable and two Vast hosts had unacceptable acquisition/transfer performance. This small, selected sample is not a provider reliability estimate. H3 was outside that qualification.

## What the existing evidence establishes

| Layer | Existing evidence | Limit |
| --- | --- | --- |
| Provider client | `tests/pool-providers.test.ts` tests actual adapters through an injected fetch function, including the newly observed Vast offer ID, deletion and SSH responses | Mostly handcrafted replies; no comprehensive recorded request/response corpus or full browser journey through these adapters |
| Scheduling/lifecycle | `tests/pool-lifecycle.test.ts`, `tests/jobs.test.ts`: ambiguous creation, partial launch, frozen LoRAs, drain/quit, credential changes, rate limits, disappearing workers | Provider and worker drivers are substituted |
| Browser interaction | Worker forms/actions, Generate/Chat, visual atlases | `scripts/offline-pool.mjs` replaces provider drivers; a passing UI test does not validate provider request construction |
| Process recovery | Six abrupt coordinator interruption cases in `scripts/test-pool-recovery.mjs` | Real app/SQLite, persistent synthetic providers and worker receipts |
| Container transport | `scripts/test-container-transport.mjs` uses real SSH and worker protocol | Synthetic inference and model readiness; cannot validate GPU execution or marketplace networking |
| Paid execution | Generate, Chat, cancellation, restart during inference, two-worker scheduling, both shutdown policies, independent cleanup checks | Few hosts; some manual diagnostics and repairs; not a repeated clean-install acceptance run |

The paid run retained state transitions, selected provider snapshots, job receipts, worker/container logs, timings and cleanup evidence. It did **not** systematically retain every sanitized HTTP exchange. We have reviewed specific failure responses, not exhaustively qualified every interaction. The external budget watchdog used for that test is a test helper, not a product feature.

## Concrete gaps found in this audit

1. `ProviderApi.request` in `server/pool-providers.ts` discards non-success response bodies. `server/pool-errors.ts` then mainly classifies HTTP status. Preserve bounded, allowlisted error codes/details and request IDs, with secrets removed; map them to appropriate recovery actions. Do not display arbitrary provider text directly.
2. Vast create responses with `success: false` are currently all called unavailable capacity. Different documented/provider-observed reasons need distinct fixtures and appropriate handling.
3. Provider polling now has a cadence and rate-limit backoff, but it needs aggregate multi-worker pressure tests. Exercise reads and repeated release verification together; allowing Quit must not create an API request storm.
4. Slow startup is partly observable, but the app needs a clearly tested path for long container pulls, stalled preparation and lost connectivity. Preserve the user's choice to keep workers until explicitly released. Do not silently replace or rent another worker.
5. The full path from browser to actual provider adapter to worker transport is not covered by the existing independent harnesses. Connect these layers instead of adding more screenshots of manually seeded success states.

## Provider test environments

I did not find a documented non-billing instance/pod provisioning sandbox in the current [Vast documentation index](https://docs.vast.ai/llms.txt) or [RunPod API documentation](https://docs.runpod.io/api-reference-v2/overview). That is a documentation finding, not proof that a private partner environment cannot exist.

[RunPod local testing](https://docs.runpod.io/serverless/development/local-testing) simulates Serverless handler endpoints. Its local asynchronous `/run` returns a fake ID; it does not test pod acquisition, disks or SSH. [Vast machine self-test](https://docs.vast.ai/cli/reference/self-test-machine) is a host-side hardware test, not a renter's fake billing environment.

[RunPod publishes OpenAPI](https://docs.runpod.io/api-reference-v2/overview), which can validate request shapes. Schema checks cannot prove placement or startup. [Vast documents variable error envelopes and rate limits](https://docs.vast.ai/api-reference/rate-limits-and-errors); that is a reason to test complete HTTP behavior. Treat documentation examples and observed responses as separate sources of fixtures.

## Proposed matrix

Each row is a family of explicit cases, with independent starting state and expected final resources. Existing coverage is partial unless noted. Start with money/ownership/recovery boundaries; do not multiply every input by every viewport.

| ID | Stage and injected cases | Required behavior | Main evidence to add |
| --- | --- | --- | --- |
| 01 | Credentials missing, invalid, insufficient permissions; edit credentials with live workers | Useful Admin action; no unintended purchase; preserve access to owned rentals | HTTP adapter + browser |
| 02 | No offers, stale offer, changed rate, capacity disappears between quote and purchase | Refresh/review action; never exceed approved rate or silently select a different offer | Real recorded catalog/rejection fixtures |
| 03 | Duplicate launch click, response lost after allocation, delayed resource visibility, coordinator crash | One owned rental per launch; reconcile uncertain outcome before another purchase | Stateful provider simulator + process kill |
| 04 | Multiple requested workers, one rejected, one delayed, one succeeds | Preserve successful workers; accurately report partial completion, rate and errors | Both providers through real adapters |
| 05 | Container pull slow/fails, endpoint delayed, SSH denied, duplicate key association, endpoint changes | Correct startup stage; retry safe connection work; Quit reachable throughout | Provider replay + real local SSH |
| 06 | Direct model/LoRA download: revoked token, gated asset, 404, throttle, interrupted bytes, hash mismatch, disk full | Actionable failure; verified files only; optional-adapter recovery; no false readiness | Worker download tests + browser recovery |
| 07 | Engine starting/crashed, insufficient physical memory, wrong GPU, missing required nodes/kernels | Never assign jobs before verified capability; retain release control and rate | Container checks + paid hardware smoke |
| 08 | One/multiple outputs, multiple workers, mixed Image/Video queues, one unhealthy worker | Correct workflow/LoRA assignment; bounded concurrency; healthy workers continue | Deterministic scheduling stress suite |
| 09 | Submit accepted but reply lost, cancel during upload/inference/save, late completion after cancel | Reconcile receipt; avoid blind duplicate execution; no publication after accepted cancellation | HTTP/SSH faults + durable receipts |
| 10 | Output connection drops, corrupt partial file, PC disk full, restart between file save and DB commit | Resume/verify; one Library asset; preserve remote output until save acknowledged | Existing recovery harness plus transport faults |
| 11 | Close browser, lose LAN, two tabs, restart coordinator, PC sleep/resume | No duplicate actions; recover status; distinguish browser closure from server unavailability | Real process/browser journeys |
| 12 | Provider 429/5xx, timeout, malformed JSON, HTML error, incomplete/wrong-resource response, pagination | Safe bounded polling, useful errors, no false absence; retain ownership under uncertainty | Adapter replay with fake time and request counts |
| 13 | Quit now during every startup/job stage; finish during active/queued work | Stop only intended work; verify provider deletion; no resurrected worker after late replies | Cross-stage race tests + browser controls |
| 14 | Delete accepted but reply lost, deletion delayed/denied, external deletion | Remain visibly unresolved until authoritative absence; retry safely; no hidden billed resource | Provider simulator + independent inventory assertion |
| 15 | Startup/idle/running/releasing cost, delayed billing, attached disk and transfer charges | Explain estimate vs invoice; preserve elapsed spend through restart; never interpret missing billing as zero | Clock-controlled ledger + recorded billing fixtures |
| 16 | Desktop/mobile dialogs, keyboard, scrolling, long errors, reconnect, retry, shutdown confirmation | Every required action reachable; no clipped status or misleading success; shared UI stays consistent | Numbered screenshots and individual full-resolution review |

For IDs 03, 09, 10 and 14, test process death immediately before and after the external side effect and local persistence. For IDs 05, 06, 09 and 13, deliver late responses after cancellation. These boundaries matter more than a large raw test count.

## Implementation order

1. **Record and classify.** Add one bounded, redacted provider exchange recorder with correlation IDs for launch, worker and job. Retain sanitized method/path, response status, allowed headers, error classification and timing. Never record authorization headers, environment secrets, signed URLs or media payloads. Turn the known live failures into versioned fixtures with provenance. Review production error mappings against those fixtures and the current docs.
2. **Join the harnesses.** Extend existing test seams so the real built app and production provider adapters call a local stateful HTTP provider simulator. Use the existing local container transport for selected journeys. Block external traffic and use synthetic credentials. Simulate actual state changes even when the response is lost; check request bodies/counts, database records, outputs, and final owned resources.
3. **Exercise recovery and UX.** Run the priority matrix with controlled time, dropped connections and process restarts. Capture desktop/mobile states from these journeys. Review originals one at a time, deduplicate defects, fix, then produce the numbered mosaic index the user requested.
4. **Read-only live check.** Validate real credentials, catalog response parsing and compatibility with current documented schemas without renting. Report failures explicitly. This cannot establish create permissions, capacity placement or launch success.
5. **Paid acceptance after separate budget authorization.** Use pinned published images, fresh disposable disks and the actual app. Cover Image and Video roles on both providers across a bounded campaign. Start with one complete acquisition/generation/release journey per combination; repeat clean acquisitions on different hosts before broader reliability claims. Record failed hosts as failed attempts, not invisible retries. Independently verify deletion of owned compute and disks.

## Release criteria

- Known integration regressions pass through real adapters and at least one complete browser journey.
- All money/ownership/cancellation/recovery cases have automated assertions; no duplicate rental, no falsely confirmed release, no forgotten owned disk, no late cancelled output.
- Every exposed failure has a usable next action. Long startup shows elapsed time, current cost estimate and accessible Quit; workers remain up until the user chooses otherwise.
- Required desktop/mobile states are individually reviewed, with visual sign-off separate from test assertion status.
- A paid acceptance journey requires **zero manual repair**. SSH inspection for diagnosis is fine; editing remote files, attaching keys manually or bypassing broken app actions makes that journey a failure. Fix and rerun before counting it as a pass.
- Final report separates simulator results, local container results, read-only provider checks and actual GPU results. No claim of a statistical reliability percentage from a handful of rentals.

Recommended next work is this focused acquisition/error/recovery pass before another model feature. It extends the existing architecture and test harnesses; it does not require a new orchestration system.
