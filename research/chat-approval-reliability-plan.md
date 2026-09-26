# Chat approval: small visibility and recovery fix

Status: implemented. Aligned across three independent reviews of server
submission, UI state, and recovery/tests. Verification and rollout are recorded in
[the QA report](chat-approval-reliability-qa-2026-09-24.md).

## Scope decision

Keep the existing rule: decide every proposal in the open group, then submit its
approved requests together. Make that waiting state visible and actionable.
Independent card execution is deferred: it would change editing, feedback,
busy-state, partially submitted groups, cancellation, and branch/repeat rules.

Reuse existing approval persistence, frozen seeds, deterministic submission keys,
serialized preparation, and the transaction that commits jobs and chat links.
Add one optional stored field, `ChatGroup.submission_error?: string`. No new
database table, endpoint, scheduler, submission service, or recovery subsystem.

Privacy: source and isolated synthetic fixtures only. Do not inspect the owner's
real prompts, conversations, assets, generation payloads, or logs containing them.

## Server changes

Files: `shared/chat.ts`, `server/chat/service.ts`.

1. Add the group-specific error field. Keep approval and execution distinct;
   a successful approval does not imply jobs have already been admitted.
2. In `decide()`, when the final decision is saved and approved work is ready to
   submit, persist the existing `chat.activity = 'preparing'` in that same save.
   Keep the existing in-memory preparation guard. All-denied groups close without
   preparation or job creation.
3. Keep `release()`'s serialized preparation and atomic commit. Clear an old group
   error when beginning an actual attempt. On failure, preserve decisions and
   resolved seeds, save the actionable error on that group, and return to idle.
   On success, clear the error and persist `chat.activity = 'idle'` in the same
   transaction as jobs, links, and the released group. `view()` already derives
   generating from jobs; leaving a stored preparing marker would falsely signal
   interruption on the next restart.
4. Scope late completion/error handling to the same epoch and still-open group.
   Stop must remain authoritative after delayed preparation settles. Keep the
   existing pre-commit stop fence; do not add processing cancellation machinery.
   Capture the epoch/group before awaiting. A stopped or superseded operation
   writes no late error or activity update. Keep its in-memory preparation guard
   until it settles, so an old finally cannot clear a newer operation's guard.
5. Clear obsolete group errors on actual revision changes and changed decisions.
   Do not blindly erase unrelated chat/agent errors. Check existing error consumers
   before removing duplicate chat-level reporting of this particular failure.
6. Retry through the existing decision endpoint, using the current approved
   revision. Preserve `approved_snapshot`, resolved seeds, and the original
   group/card/revision submission key. Preparing, stopped, replaced, or released
   work must not be submitted by this retry action.
7. At startup, identify unfinished handoffs only when a reviewing group has all
   decisions resolved, at least one approval, and no latest revision has job links.
   Preserve an existing group error. For persisted preparation, explain that startup
   interrupted the handoff. For older unmarked records, use the neutral message
   “These approved requests did not start. Retry to continue.” Do not infer a crash.
   Reset interrupted activity to idle and avoid also applying the generic agent
   restart message to that handoff. An all-denied group can close without work.
   Never automatically generate or
   reconstruct missing jobs. Released groups keep their existing jobs.

This targets forced termination before commit. Graceful shutdown already waits
for the preparation chain. A post-commit lost response must recover existing jobs,
not create another batch.

## UI changes

Files: `web/chat.tsx`, `web/review-request.tsx`; reuse `RequestCard` and its footer.

- Keep the real group and its sibling cards in timeline entries. Store the React
  rendering key, displayed card, and revision separately instead of replacing the
  group ID and reducing its cards to one.
- Replace the no-jobs fallback ternary with one small status resolver. Existing
  linked jobs continue using the current job UI. Replaced/denied history retains
  its meaning; Stopped takes precedence over approval. Only current approved
  revisions receive waiting, preparation, or retry controls.
- Approved with undecided siblings: **Waiting for N other decisions**, plus
  **Review next request**, opening the existing review dialog for an undecided
  sibling. Count from the full original group.
- Preparing: **Preparing…**. Reuse the existing Stop chat confirmation; no new
  per-card cancellation system or invented progress percentage. Stop must remain
  usable while approval's POST is pending; its availability must not be disabled
  by the approval action's `saving` flag. Stopped outranks any draining preparation.
- Failed/interrupted start: **Couldn’t start**, with the group-specific explanation
  in the existing footer. Offer **Retry start** for one approved request or
  **Retry approved requests** for several. Retrying any approved card retries the
  approved group, so the copy must say so. Editing uses the existing review dialog.
- Relabel the review dialog's existing approval action for the same retry state;
  do not create a second submission flow. Do not present preparation failure as a
  successfully started generation or open the worker panel as its remedy.
- Direct card approval stays inline instead of auto-opening Review merely to hold
  errors while the POST runs. Explicit Review/Edit still opens that dialog. Show
  persisted preparation failures on the card; rejected decisions use the existing
  action-error surface. Offer the worker panel only after a decision response
  actually admits jobs for this group, not merely because it returned a chat.

For stale responses, reuse the worker-pool's in-flight read guard and epoch pattern
in one local read/accept helper. Route polling, SSE-triggered full refreshes,
action results, chat opening, and job-detail refreshes through it; replace the
duplicated acceptance logic. Invalidate earlier reads on navigation, accepted
actions, and newer SSE updates; schedule a follow-up read when an update arrives
during a read. Queuing a refresh alone must not allow the old response to apply.
Preserve existing branch abandonment guards and ordered streaming messages.
Do not use `chat.version` alone: job/preparation status can change without it.
This is a local correction, not a general Chat state-management rewrite.

## Verification

Extend existing service and browser fixtures; do not add another test harness.

1. First sibling approval waits; final approval/denial submits only approved work.
   The visible link reaches the correct undecided card in a long synthetic chat.
2. Hold real service preparation at an injected boundary: persisted/visible
   Preparing, no early jobs, duplicate approval blocked.
3. Fail later preparation: zero jobs committed, group error survives reload;
   Retry admits exactly one batch with the original seeds.
4. Stop during preparation, then resolve and reject delayed work in separate cases:
   no late admission or error that overwrites Stopped.
5. Reopen isolated persisted state before commit: explicit retry, no automatic work.
   Reopen after commit/lost response: original jobs remain linked, stored activity
   is idle, no false interruption, no duplicates.
6. Cover older unmarked handoffs, existing group errors, all-denied groups, and
   revision changes that clear obsolete preparation errors.
7. Return an older browser snapshot after approval/Stop completes; it cannot undo
   the accepted state. Also cover equal chat versions and switching conversations.
8. Add only the changed waiting/preparing/failed/stopped presentations to the
   existing card atlas, including long LoRA names and long synthetic history.
   Inspect desktop/mobile screenshots individually; publish numbered review images.
9. During a held approval POST, the inline card stays visible and Stop remains
   usable. Waiting/failure responses do not open the worker popup as though jobs
   were admitted. Exercise both direct approval and the expanded review dialog.

Acceptance: an approved card shows why it is waiting, actual job state, or an
actionable start error. It never ends at an unexplained “Approved.” Existing card,
branch, revision, and cancellation regressions must continue to pass.

## Deliberate exclusions

- Independent submission of sibling cards.
- Missing-record reconstruction or corrupted-database repair.
- New job queue, outbox, automatic retry daemon, diagnostic endpoint, or telemetry
  project. The persisted group error provides the required start-failure evidence.
- Worker/provider changes, GPU spend, real user requests, or prompt/composer redesign.
- Blanket rewrites or another large visual scenario generator.
