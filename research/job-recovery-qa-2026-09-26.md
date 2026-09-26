# Unknown generation recovery — implementation and QA

Implemented and published September 26, 2026 on `codex/fal-only`.

## Behavior

- Shared Job Details in Generate, Chat and Activity offers **Retry** for eligible unknown jobs and **View worker** for the original worker. Mixed batches select the problematic output before a running sibling.
- Retry returns immediately with a process-owned pending state. It coalesces with reconciliation and duplicate clicks, checks the original saved worker/workspace identity, and reads the durable receipt. Existing results use ordinary saving and acknowledgement.
- An absent receipt permits only the saved original request ID, graph, inputs, seed and envelope on the same idle, ready worker. No new request, worker, seed or current LoRA lookup is introduced. Known legacy envelopes can be reconstructed from the saved graph and that rental's frozen inventory; unknown formats fail closed.
- Cancellation, quit, reassignment and shutdown are checked again after asynchronous operations and directly before the actual POST. Conflicts and timeouts retain the assignment and uncertainty.
- A receipt belonging to a previous engine cannot be presented as running or silently replayed. A temporarily unavailable engine also remains unknown. Terminal receipts can still be saved later.
- Pool cards and counts derive unknown/recovering status from the assigned job, without changing scheduling state. Acknowledgement cannot hide a current worker's unresolved request.
- New diagnostics preserve submission stage, POST invocation, timing and controlled failure class/status. Recovery does not log raw exception text, graph, prompts, media or LoRA names. No database migration or worker image update.

## Validation

| Layer | Result |
| --- | --- |
| Full unit suite at integration checkpoint | 423 passed across 46 files |
| Final affected suites after additional guards | 70 passed: Jobs 47, transport/worker 22, recovery HTTP 1 |
| Real worker adapter, isolated local Docker image | 35 engine/spool tests passed; networking disabled, no GPU |
| Browser | 12 recovery tests passed, plus existing Continue/Retry saving regression |
| Static/build | TypeScript and isolated production build passed |
| Visual | 14 numbered desktop/mobile states plus 320px and mobile-landscape boundaries, reviewed individually |

The real adapter tests hold validation while an original POST and exact same-ID retry race, and verify one native queue insertion. They also simulate a crash after durable acceptance but before queue insertion, proving that deduplication does not silently enqueue an orphan again. Local HTTP transport tests cover cached verification timeout with zero POSTs, fresh verification, cancellation before dispatch, missing original identity, identity mismatch, and diagnostic privacy. Application tests cover old envelopes/LoRAs, conflicts, save failures, cancellation and restart.

UI fixtures are explicitly simulated. They exercise rendering and interactions; transport and adapter tests establish the safety behavior separately. The worker fixture was corrected to match the actual public projection, with no invented provider issue banner.

Reproduce the visual suite with `node scripts/test-job-recovery.mjs`. It builds into isolated `.local` directories and never replaces the live app during tests.

[Desktop/mobile QA gallery](http://192.168.1.212:4314/job-recovery/index.html). Numbered screenshots include 601 unknown, 602 original worker, 603 checking, 604 recovered, 605 mixed batch/error, 606 Chat, and 607 unavailable saved submission. [Individual review record](job-recovery-visual-review-2026-09-26.json).

## Rollout and privacy

Published to [the LAN app](http://192.168.1.212:4310). Deployment checked aggregate transition counts only, backed up replaced program files, restarted the local coordinator and checked health, static assets and the recovery route using a nonexistent fixture ID. The first restart lacked permission to write the normal app log; the previous app was restored, then the tested update was published successfully with the required local filesystem permission.

No live request contents, chats, prompts, media or LoRA identities were inspected. No real generation was retried or cancelled, and no GPU was rented, restarted or released. Remote GPU processes continue across coordinator restart. No paid testing was performed.

Recovery is intentionally unavailable when original identity or submission data cannot be established. An interrupted accepted request remains a worker issue to resolve; this feature does not promise replay of every unknown outcome.
