# Recover an unknown generation

Status: proposed September 26, 2026. Three agents reviewed server safety, UI, and tests. Planning only: no application changes, live worker actions, private request inspection, or GPU tests.

## Outcome and scope

Give the existing generation error screen a **Retry** action that recovers the original job on its original worker. It checks for an existing result first and resends only the same saved submission when safe. The same job, seed, settings, batch position, and Chat approval remain in place.

Fix the related misleading presentation: an unresolved assignment must not say Generating merely because the worker still owns the job. Reviewing an error must not hide an unresolved job from Activity.

Keep this contained: one HTTP action, one tracked recovery operation, a small public recovery descriptor, and the existing shared Job Details UI. No provider changes, new rentals, persistent retry queue, database migration, or worker image update is expected. The existing worker protocol supplies duplicate protection.

## Verified foundations and limits

- `WorkerConnection.status()` caches a failed verification for two seconds. `requireVerified()` can rethrow that timeout before making the generation POST. This is a reachable failure and consistent with the diagnosed timing, but the saved timeout alone does not establish its exact origin.
- The worker's `/studio/prompt` handler holds a lock around saved-record lookup, payload digest comparison, validation, durable acceptance, and queue insertion. The same ID and identical payload returns the existing acceptance; a changed payload conflicts.
- The worker writes `submission.json` before `queue.put()`, without an intervening await. Normal acknowledgement retains that submission record.
- A receipt lookup returning 404 plus an idle engine is only an observation. A delayed original POST may still be validating. **The same-ID, identical-payload check under the worker lock is what makes replay safe.**
- This guarantees at most one queue admission under the supported single-engine worker and retained spool; it does not guarantee completion. An engine crash after durable acceptance but before queue insertion can leave an accepted record with no execution. That case must not be silently requeued by this feature.
- `Jobs.serialize()` does not exclude background reconciliation. Recovery must participate in `Jobs.inFlight`.
- A worker's current `session_id` changes during health refresh. It is not evidence of the original submission's engine session.

## User interaction

Use the existing `JobDetails` screen, already shared by Chat, Generate, and Activity. Keep compact approval cards and output tiles as entry points, without adding recovery controls to every card.

For an eligible unknown submission:

> Seed couldn't confirm this request. Retry checks the original worker and resumes or safely resends the same request.

- Primary **Retry** changes to disabled **Checking worker…** during recovery.
- Secondary **View worker** opens the assigned worker, not the Add workers picker.
- Keep error details collapsed. Show a concise explanation if the connection, identity, assignment, or stored submission prevents recovery.
- Stay on the same selected output as it becomes Running, Saving, Complete, or remains Unknown.
- Add no confirmation for this recovery action. Existing destructive worker controls retain their confirmation dialogs.

Keep existing actions distinct:

| Action | Meaning |
| --- | --- |
| Unknown-job Retry | Recover the same job on the same worker |
| Failed-output Retry | Existing deliberate new attempt/draft flow |
| Retry saving | Transfer an already generated output again |
| Continue request | Resume a blocked request through existing admission rules |
| Worker Reconnect | Rebuild the transport to the existing rental |

Remove “I reviewed the worker status” from current worker-backed uncertainty. Existing `uncertainty_acknowledged` flags must not hide unresolved worker-backed jobs, including jobs that lack a recoverable envelope or worker record. Visibility is independent of Retry eligibility. Preserve acknowledgement behavior for historical retired-provider jobs; do not resurface unrelated archived issues. Retain historical fields/API compatibility; no data rewrite is needed.

## Server recovery algorithm

Add `POST /api/v1/jobs/:id/recover` with an empty body. The server decides eligibility; the browser must not infer safety from error text or an idle-looking worker.

1. **Reserve the job operation synchronously.** Tag the existing in-flight entry as manual recovery before the first await. Duplicate clicks return the current operation. If a background operation already owns the job, chain behind it and reserve that successor so another poll cannot intervene. Make task cleanup delete an entry only if it still belongs to that task.
2. **Return 202 promptly.** Existing job polling reports progress. Do not hold the global HTTP serialization chain for a potentially 65-second network operation. Closing the browser does not stop the server task.
3. **Reload authoritative state.** Check job existence, eligible uncertainty, original worker assignment, no accepted cancellation, and no immediate shutdown/release. If an earlier task already completed or recovered the job, return its current state without another submission.
4. **Probe the original worker freshly.** Bypass cached failed verification and verify the saved worker/workspace identity and current engine status. Use a narrow read-only connection probe, not `driver.prepare()`, which can initiate preparation. An unreachable worker remains unresolved with Reconnect guidance; this action does not restart the engine or acquire a replacement.
5. **Read the durable receipt.** If present, use existing receipt/result handling. Running work is followed; terminal output is saved and acknowledged normally. Respect cancellation and content integrity checks. An old-engine accepted record without a terminal result must remain unresolved with an interruption explanation, rather than being requeued or claimed to be running forever.
6. **Replay only after absence and a ready, idle engine.** Require the exact saved submission on the same verified worker/workspace. Foreign activity, identity mismatch, unknown worker state, or unavailable original data blocks replay. Retain the assignment.
7. **Recheck cancellation, shutdown, assignment, and state immediately before POST.** Save the existing `submitting` / `submission_pending` state, then send the same ID and exact envelope using the freshly observed engine session. The worker's lock and digest check handle a delayed original POST arriving concurrently.
8. **Reconcile the outcome.** Resume the normal receipt path on acceptance. Timeout, conflict, transport failure, or inconclusive absence retains uncertainty and the original assignment. A conflict may mean the engine changed or a delayed request is still involved; do not run the first-submission rejection path that marks failed and releases the claim.

An existing finish-after-jobs shutdown may finish this already assigned request; immediate quit, release, and cancellation always take precedence. Late responses must not resurrect a cancelled job or released worker.

Apply those guards to failure saves as well as successful responses: the current `save()` cancellation fence does not cover a late write of `needs_attention`. A delayed probe/POST error must not replace an accepted cancellation with Unknown. The final implementation must re-read intent before writing recovery errors and preserve cancellation consistently.

Handle accepted records from a departed engine in ordinary reconciliation as well as manual recovery. The current `advance()` unconditionally labels a receipt without a manifest Running; leaving that unchanged would erase the interruption explanation on the next poll. Require fresh engine evidence for this classification and keep following any terminal receipt that subsequently becomes available. A single idle observation within the same engine is not proof of an orphan.

No durable retry intent is needed. A process restart clears transient recovery activity and resumes normal receipt reconciliation, without automatically posting again. If uncertainty remains, the user can invoke Retry again. Safety after a crash comes from the durable original submission and worker deduplication, not an in-memory lock.

## Exact submission data and compatibility

For new jobs, save the complete submission envelope before the first send. Reuse the existing saved graph and persist only the missing envelope metadata beside it, rather than storing a second copy of the graph. This includes the ordered resolved adapter payload, route, and recognized video profile; ID and graph remain those already assigned to the job. Capture non-secret identity/session metadata where available for diagnostics and restart interpretation.

Recovery must not call `graphFor()`, consult the current LoRA library, reroll seeds, regenerate prepared inputs, or submit a new logical job. Those operations could change the payload or create another generation.

For existing graph-only jobs, support a bounded compatibility path: use the saved graph, saved request schema, and ordered pinned selections resolved against the same rental's frozen installed inventory, with the known historical profile. Test that this reconstructs the original envelope for every supported workflow. Missing or unfamiliar metadata blocks replay with a clear reason. Do not claim arbitrary older versions can be reconstructed exactly. The worker also rejects a different payload if an acceptance record already exists.

Missing original engine-session metadata alone does not disqualify an otherwise valid legacy submission. Fresh identity verification pins the worker/workspace, and replay uses the current engine session. Existing accepted records remain authoritative across engine restarts.

## Shared status and privacy

Expose a small typed recovery descriptor: a controlled reason, available recovery action, and transient pending status. Project it consistently in job list/detail responses and Chat's job serialization. The transient pending flag comes from the tagged in-flight operation; do not persist a busy boolean or treat ordinary receipt polling as manual recovery.

Apply the accepted recovery response to the displayed job before clearing local click-pending state, then refresh normally. Avoid a brief enabled-button gap while waiting for the next poll; stale reads must not overwrite a newer recovery or cancellation response.

Extend the existing `WorkerPool.bindJobs()` with a read-only assigned-job lookup. In `publicWorker()`, derive **Needs attention / Request status unknown** for an unknown assigned job, or **Checking request…** during manual recovery. Preserve shutdown, release, reconnecting, preparation, and provider-error precedence. Keep internal worker readiness, assignment, and scheduler lifecycle unchanged. The pool summary already counts public states, so sidebar counts and worker cards stay consistent.

Derive available presentation actions from that effective state too: View worker must not advise Reconnect while displaying only shutdown buttons. The generation's Retry remains the primary recovery path.

Use one shared attention predicate so unresolved worker-backed jobs remain visible in server Activity totals and client views even if previously acknowledged, preserving historical retired-provider acknowledgement behavior. In mixed batches, Generate's View issue should select the problematic output before an ordinary active sibling. Recover only that output; never resend completed siblings.

Append bounded diagnostic events to the existing sink, preserving the initial failure even if the current error later becomes receipt missing:

- Job/worker/attempt IDs, timestamp and elapsed time.
- Stage: identity verification, receipt lookup, POST invocation, recovery result.
- Controlled error/outcome code, error class, and HTTP status.
- Whether POST was invoked, without asserting that it reached the worker.
- Receipt present/absent/unreachable/invalid; identity/session match and cancellation/shutdown outcomes.

Do not include raw exception messages or stacks, response bodies, graph/prompt data, request hashes, media paths, LoRA identities, credentials, or manifests in these new events. Use explicit allowlists rather than relying on general redaction to find private content.

## Implementation boundaries

| Files | Work |
| --- | --- |
| `server/jobs.ts` | Recovery ownership, exact envelope persistence/reuse, lifecycle fences, public recovery descriptor |
| `server/worker.ts`, `server/pool-worker.ts`, `server/pool-contracts.ts` | Fresh read-only identity/status probe and structured submission-stage diagnostics |
| `server/http.ts`, `server/chat/service.ts`, `shared/jobs.ts` | Recovery endpoint, shared job projection and attention semantics |
| `server/pool.ts` | Read-only assigned-job hook and truthful public status overlay |
| `web/job-ui.tsx`, `web/generate-feedback.tsx` | Shared Retry interaction, worker targeting, mixed-batch issue selection and attention counts |
| Existing shared styles/hooks | Reuse worker opening/refresh; only small action-row wrapping or busy handling changes as required |

Keep this separate from the resolution feature, general queue redesign, provider acquisition changes, and automatic retry policy. No universal job-action framework or new polling loop.

## Tests that establish the guarantee

Use the actual existing boundaries; a fake worker Map cannot prove queue deduplication.

| Layer | Required cases |
| --- | --- |
| Actual `WorkerConnection` with local HTTP | Cached verification timeout produces zero generation POSTs; fresh probe recovers without a preparation PUT |
| Jobs orchestration | Receipt exists after lost response → no POST; absent receipt → identical ID/envelope; second timeout/conflict → retain unknown state and assignment |
| Real Python submit adapter with its test queue | Hold original validation while receipt is absent; race recovery with the same ID/body; assert exactly one native queue insertion. Different payload conflicts. Normal cleanup retains deduplication |
| Concurrency and shutdown | Double click plus background poll coalesce; cancel/quit before POST suppresses it; late success AND late probe/POST failure cannot override cancellation; unrelated job actions remain responsive |
| Identity and compatibility | Wrong worker/workspace, engine change, foreign activity, legacy reconstruction and missing metadata; no replacement worker or graph regeneration |
| Restart and incomplete acceptance | Restart after acceptance recovers receipt without reposting; interrupted recovery remains safe to retry; accepted orphan after engine restart remains unresolved across subsequent ordinary polls |
| Diagnostics | First timeout stage survives later status changes; synthetic private markers in exceptions/bodies never appear in recovery events |
| Browser | Same output retained, pending survives reload through server projection, stale responses do not replace newer state, View worker selects the assigned rental and exposes Reconnect, mixed batches and current-worker acknowledgements remain truthful; historical acknowledged jobs retain their behavior |

Extend `tests/jobs.test.ts`, `tests/pool-worker.test.ts`, `tests/pool-lifecycle.test.ts`, `tests/diagnostics.test.ts`, and existing status tests. Add a focused connection test and recovery browser spec. Extend `worker/test_engine_jobs.py` for the real concurrent admission race; reuse spool tests and the process-recovery harness for restart coverage.

Exclude impossible or unsupported simulated success cases: normal acknowledgement deleting acceptance records; normal queue admission preceding the durable record; two legitimate coordinators for one profile; replacement-worker replay; fresh IDs; corrupted-spool reconstruction. Accepted-but-orphaned work is a real limitation to detect, not a success case to fake.

## Visual QA and delivery

Capture the changed flows at desktop 1440 × 1000 and mobile 390 × 844, plus narrow 320 × 568 and mobile landscape boundary cases. Cover:

1. Unknown job, Retry available, worker Needs attention.
2. Recovery pending, disabled action and status announcement.
3. Existing receipt recovered / safe replay returning to the same output.
4. Still unreachable, identity mismatch, or unavailable original submission.
5. Mixed batch and previously acknowledged unresolved job.
6. Existing Retry saving, failed-job retry, worker shutdown confirmations, and nested worker-dialog focus/Back behavior.

Review each screenshot individually, fix and deduplicate findings, then publish numbered desktop/mobile mosaics with scenario captions. Do not rely on tiny mosaics for the actual inspection.

Implementation order: server/data correctness → shared UI/status → focused automated tests → individual visual review → app rollout. Initial validation needs no paid GPU. A live replay of the user's pending generation is a separate action and is not part of this planning task.

Confidence: high in the recovery design because the required worker deduplication already exists. Exact reconstruction of historical envelopes and cancellation/reconciliation races are explicit test gates. The guarantee is recovery without duplicate admission under the supported worker contract, not recovery from every possible worker crash.
