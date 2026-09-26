# To-do diagnosis and minimal repair plan

Status: approved scope implemented; see [repair validation and release report](todo-repair-qa-2026-09-25.md). The diagnosis below records the original evidence and agreed boundaries. Three subagents reviewed worker launches, cache deletion and startup progress; the primary agent reviewed Branch in Chat. No private requests were inspected or paid GPU tests performed.

| Item | Finding | Smallest justified change |
| --- | --- | --- |
| Failed launches disappear | Confirmed | Derive failure presentation from existing allocation evidence; persist dismissal. Keep the lifecycle unchanged. |
| Deleted images leave caches | Confirmed, including a concurrent preview-write race | Reuse existing job/asset records for cache retention; fence only the affected previews during deletion. |
| Startup progress is incomplete | Partly already implemented; narrow UX gaps plus a real resume-rate bug | Keep existing progress pipeline. Expose reporting freshness, retain the transfer row, correct resumed-byte accounting. |
| Intermittent Branch blank screen | Later report remains unverified | Keep known fixes. Add small crash recovery and content-free evidence rather than another branch rewrite. |

## 1. Failed launches: presentation, not a new worker lifecycle

Evidence: `server/pool.ts:466` records definitive rejection as `create_rejected=true` and terminal `released`. `web/worker-pool.tsx:158` excludes released records from the main list; its Recently released section drops the issue. Activity also labels the outcome Released. The recorded empty-offers failure fits this path. Existing tests explicitly expect the terminal state, which is correct for resource accounting but insufficient for presentation.

- Expose the existing rejection flag in `PoolWorker`. Add only an optional persisted `launch_failure_dismissed_at` to the existing rental JSON.
- Use one shared outcome helper in the worker popup, Activity and attention indicator. Show undismissed **Launch failed** cards separately from rented workers. Preserve the error and diagnostic history after dismissal.
- Add **Find another GPU** and **Dismiss**. Find another opens the existing offer picker for the same worker class with fresh quotes and no retained selection from the original launch. This prevents accidentally selecting already-successful workers from a partial launch again. The user still reviews price and selects a replacement.
- Add a guarded, idempotent dismissal action through the existing worker-action endpoint. It only accepts confirmed rejected terminal records and does not contact the provider.
- Split unavailable-capacity errors from increased-price errors in provider preflight. Only confirmed non-allocation can say **No rental was created**. Show zero estimated rental spend without promising anything about unrelated provider charges.
- Reuse the existing notification hook for a supplementary failure toast. The persistent card is the authoritative UI.

Keep uncertain create requests visible and reconciling. Keep failed termination visible and accruing estimated cost. Rejected launches must not enter active capacity, rental rates, spend, or Quit All. Expired quotes rejected before any worker record exists remain ordinary inline errors.

Validation: recorded empty offer response; price change; partial success; reload/dismissal; history retention; uncertain purchase response; failed termination. Desktop/mobile captures for rejected-only and rejected-plus-active lists. No automatic replacement, new worker state, or retry-linking subsystem.

## 2. Cache deletion: existing reachability and a small preview fence

Evidence: ordinary deletion in `server/http.ts:155` removes only the source file and asset record. `server/previews.ts:38` writes two thumbnail sizes outside the job queue. `server/media.ts:90` creates content-derived Qwen prepared files that can be shared by separately uploaded identical images. `Job.prepared` already stores `asset_id`, `file` and optional `audio_file`. Preparation is already serialized against deletion in Generate, retry and Chat approval paths.

Use existing records to decide which prepared files remain needed: retain files used by a nonterminal/in-flight job, or by a historical prepared entry whose source asset still exists. Include `Jobs.inFlight`: cancellation can mark a job terminal before its upload has unwound. Reject deletion of a source still being used rather than adding deferred-deletion bookkeeping.

Target deletion remains inside `jobs.serialize`:

1. Validate the target and active/in-flight use.
2. Fence new preview work for the target asset IDs and affected sequence sheets; await already-pending writes for those targets. A snapshot of pending promises alone is insufficient because a second thumbnail size can start during the wait.
3. Compute retained prepared files as though the target assets were absent. Identify their exclusive derivatives using existing prepared entries.
4. Remove exclusive prepared derivatives and target thumbnail/temporary files **before** removing originals or records.
5. Run the existing original-file unlink and database transaction; release preview fences in `finally`.

A target-derivative failure returns a retryable deletion error while the original and record remain. Partially removed caches can regenerate. Apply the same helper before original unlink in sequence pruning, retaining its existing `pending_json` recovery instead of another deletion system.

Run an orphan sweep after successful deletion and once at startup, using the same serialized retention check. Only enumerate recognized direct files under the two cache directories; reject links/directories and validate path containment. Never delete arbitrary absolute paths merely because a job mentions them. Log sweep failures for subsequent retry; do not silently claim complete cleanup.

Legacy prepared copies from an uncommitted request lack per-asset ownership. The orphan sweep can remove them as unreachable, but target-specific atomic deletion of those old files cannot be guaranteed without extra tracking. Keep that limit explicit; no new ownership table is justified for this fix.

Validation: both thumbnail sizes; normal prepared image; two assets sharing one Qwen copy; active and cancellation-unwinding jobs; a real preview write held across deletion; second-size admission during the fence; locked derivative and retry; interrupted preparation orphan; sequence frame; outside-root safety. No second preparation lock, hash scanning of originals, recursive deletion, or cache service.

## 3. Startup: improve existing signals without inventing measurements

Already implemented: model byte counts/rate/ETA, stale-report detection, Acquire → Models → Engine, verification status, recovery actions, and total rental elapsed/spend. Remove those from the missing-feature list.

Confirmed UX gaps are in `web/worker-preparation.tsx:16–27`: stale transfers hide the rate entirely, and the view lacks reporting freshness. Worker file events already contain `updated_at`, but `server/pool-worker.ts:413` drops it.

- Keep a stable transfer row. Show the last known byte count and **Rate unavailable** when reports are stale; suppress stale ETA. Stale reports do not prove zero network traffic.
- Forward existing optional transfer-update timestamps through the preparation snapshot. Say **Last transfer update …**, not last actual byte movement. Use existing polling and server-time handling; no new timer, event stream or timestamp table. Omit unknown values for older workers.
- Keep explicit retry actions and their existing history. Show Retrying while the action is pending, then normal preparation status. Do not add attempt counts based on HTTP success, redirects, reconnects or SDK guesses; accepted commands can still be no-ops.
- Expose a small bounded provider startup category where an existing provider message clearly supports it: downloading container, verifying container, provider retrying, waiting for SSH. Reuse normalized resource data and existing polling. Otherwise retain the honest waiting state. Do not show raw log tails or invent container speed.

Separate confirmed rate defect: `worker/download_process.py:24` primes `DownloadProgress` with zero before the SDK reports a resumed prefix. The actual sequence `0 → cached prefix 400 → 600 at 2s` reports 300 B/s instead of 100 B/s for 200 new bytes. Send initial status without priming the rate accumulator; the first SDK byte observation establishes the baseline. Test this invocation sequence, not only the helper in isolation. This small worker change needs updated image/video container releases; it must not modify existing rentals automatically.

Correct unrealistic fixtures instead of expanding them: the real downloader has one sequential base-model lane and one adapter lane, not all files downloading simultaneously. Engine-start fixtures must show verified models, not active downloads. Replace the existing stalled-case assertion that blesses the hidden rate.

Validation: fresh → stale → resumed reports, missing telemetry, verification with unchanged bytes, accepted versus no-op retry, provider category fallback, resumed prefix, and individual desktop/mobile screenshots. Defer exact phase-duration UI and SDK-internal retry counts.

## 4. Branch: retain the report, avoid a speculative rewrite

Known defects are fixed: Qwen reference-label parsing (`shared/reference-labels.ts` and `web/chat.tsx:120`), Generate consuming a Chat branch URL (`web/hooks/use-branched-generation.ts:16`), and abandoned branch loads restoring late (`web/chat.tsx:152`). The recent preview UUID crash was a separate plain-HTTP regression and is also fixed.

The later intermittent Branch report is not proven fixed or impossible. Current branch tests passed over a genuinely insecure HTTP browser origin, including four workflows, same/new seeds, new/existing chats, reload, follow-up submission, missing source jobs and delayed response abandonment. Do not add random null guards or rewrite navigation based on the symptom alone.

The verified architectural gap is that `web/main.tsx` has no render-error boundary or app-owned client crash evidence. Add one small boundary above the app with a static recovery view: **Reload** and an ordinary link to **Open Generate**. Recovery must not depend on the failed router/provider tree, clear saved chats, or replay actions. Server jobs remain independent.

For diagnosis, send a strictly bounded event through the existing Diagnostics storage: whitelisted error class, built JS asset name, first-party stack line/column coordinates, and a route enum. Strip raw messages, full stacks, query/hash, IDs, prompts, props, DOM and network payloads before sending. Validate the same allowlist server-side, deduplicate/rate-limit modestly, and never pass the original browser Error into `Diagnostics.error()` (it serializes messages and stacks). No monitoring SDK or new history store.

The boundary catches render/lifecycle failures; restricted global error listeners can record asynchronous failures without replacing an otherwise working page. A controlled boundary test proves fallback/privacy behavior, **not** reproduction of the unknown Branch bug. Keep the original report under Unverified until real content-free crash evidence or a valid reproduction identifies it.

## Evidence and execution order

- 54 isolated pool/provider tests passed. They confirm accounting protections but currently permit the misleading failure presentation.
- 34 isolated media/HTTP/sequence/image-edit tests passed. They omit ordinary derivative-cleanup assertions.
- 32 existing branch/card browser tests passed against the current staged build at `http://seed-qa.test:4311`, forwarded only to the isolated loopback fixture. No real conversations/assets were accessed. Command: `node scripts/test-browser.mjs chat-branch.spec.ts chat-branch-lifecycle.spec.ts --config .local/branch-diagnosis.config.mjs` with the current staged frontend/server roots.
- Download resume-rate error reproduced with the actual callback sequence in an isolated Python probe.

Implement as small independent changes: failed-launch presentation, cache deletion, startup UI plus its separate worker rate correction, then crash recovery/evidence. Keep current server-owned scheduling and lifecycle; use shared presentation helpers and existing hooks. No GPU spend is required to validate these changes. Review new UI captures individually and offer mosaics only as a navigation aid.
