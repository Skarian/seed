# To-do repair validation

Implemented the [approved minimal plan](todo-diagnosis-plan-2026-09-25.md) on `codex/fal-only`. No new worker lifecycle state, ownership table, monitoring service or preparation lock.

## Delivered behavior

- Confirmed rejected purchases remain visible as Launch failed until dismissed. Replacement opens fresh offers with cleared selections. Dismissal preserves cause/history, never calls a provider, and cannot hide uncertain purchases or unconfirmed termination.
- Deletion removes target thumbnails and exclusive prepared derivatives before the original/record. Shared sources and in-flight uploads remain protected. Preview admission is fenced before awaiting writes. Sequences use the same cleanup with existing recovery intent. A safe, bounded orphan sweep handles uncommitted leftovers and logs failures without media content.
- Startup shows report freshness and unavailable rates honestly, plus clearly reported provider stages and explicit retry state. Resumed cached bytes no longer inflate download speed. Existing workers are not mutated; future rentals use new pinned images.
- A render-error boundary provides Reload/Open Generate. Diagnostics accept only fixed class/route enums, JS asset names and numeric coordinates. Both ends exclude message/stack content; malformed/oversized bodies do not enter general error logging. A multiline-message regression protects against text masquerading as stack frames.

The intermittent Branch blank-screen report remains **unverified**, not closed. Controlled render failure proves recovery and privacy, not reproduction of that symptom. No speculative branch rewrite was added.

## Validation and visual review

Full application suite: **361 tests passed**, plus focused reruns after privacy/copy corrections. **85 browser checks passed**, producing **28 numbered desktop/mobile scenarios** plus supplemental scroll captures. Typecheck passed. Python: 10 targeted tests passed locally; the dependency-dependent HTTP/Xet progress check and actual resumed-prefix callback sequence passed inside both published containers, offline without GPUs.

Repeatable browser runner: `node scripts/test-todo-repairs.mjs`. It stages builds outside the running app, uses fresh isolated fixture data, blocks external requests, and produces a numbered desktop/mobile gallery. It includes launch failure/replacement/dismissal, fresh/stale/absent telemetry, verification, engine startup, pending retry, recovery/privacy, Branch navigation, plain-HTTP mobile previews and worker shutdown confirmations.

Gallery numbering: 501–502 recovery; 511–515 failed launches; 521–527 startup. Screenshots were inspected individually. Mosaics are navigation aids only. Review records:

- [Launch review](todo-repair-launch-visual-review.json)
- [Startup review](todo-repair-progress-visual-review.json)
- Recovery: desktop/mobile 501 and 502 inspected individually; text/actions fit, recovery controls work, and returning to Generate restores the normal screen.

Visual review corrected misleading missing-speed copy and a fixture that briefly invented transfer progress after failure. A provider toggle looked wrong during its color transition; stabilized captures confirmed no product defect, so no unnecessary CSS change was made.

## Release boundaries

[Worker release evidence](todo-repair-worker-release-2026-09-25.json) records both published digests, source hash and offline checks. Only the small download callback patch was layered onto the existing pinned images. Models/runtime remain the existing releases.

App rollout checks aggregate activity counts only, stops an idle app gracefully, preserves old hashed assets for open tabs, and verifies health plus static assets. No real chats, prompts, uploads or generation requests were inspected; no GPUs were rented, restarted or released. Rollout receipt and exact build run are under `.local/todo-repair-atlas/`.

Limits: legacy uncommitted prepared files have no source mapping, so their cleanup relies on the orphan sweep. Render boundaries cannot prevent every possible browser failure. No paid GPU generation performance claim is made by these tests.

## Follow-up: historical failure toasts on opening

The initial notification implementation incorrectly treated the second poll of an existing failed launch as a new failure. Confirmed against the three old rejected worker records, using only worker timestamps/status. The first snapshot now establishes the failure baseline without notifications; later failures notify once, including fast rejections never seen in a starting state. Persistent cards remain unchanged. Two additional desktop/mobile browser lifecycle checks passed across opening, repeated polls, both new-failure paths and reload. Added to the reusable repair QA runner. Released as a frontend-only update without restarting the app or touching workers.
