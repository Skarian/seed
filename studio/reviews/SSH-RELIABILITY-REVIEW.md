# SSH-only plan review

September 12, 2026. Planning only; no new paid instances. Active plan:
[SSH-RELIABILITY.md](../SSH-RELIABILITY.md).

## Wave 1: independent audits

Recovery reviewer audited actual preparation, connection, jobs and worker code.
Removal reviewer audited container/config/CLI/test/skill surfaces and upgrade.
Acceptance reviewer independently compared existing test harnesses with claimed
unattended recovery. All found that tunnel reconnection and manually resumed
protocol tests were insufficient evidence of complete operation recovery.

The main gaps were prepare exiting after transient failures, its short tus retry
burst, lost-before-acceptance generation requests, stalled individual streams,
and permanent failures being hidden as retryable transfer errors. Existing job
output/receipt retry behavior should be retained and tested, not rewritten.

## Wave 2: challenges and decisions

- Rejected a new durable operation engine, preparation daemon and generic retry
  wrapper around provider mutations. Retained three current owners: tunnel,
  active preparation CLI and durable Jobs scheduler.
- Rejected expanding tus to reference uploads by default. Whole-file retry is
  acceptable but must be labelled honestly and safe under overlapping attempts.
- Challenged the assumption that native multipart overwrite was automatically
  safe. The primary agent inspected the actual pinned local worker image at
  Comfy commit 12d5279438bfefc058a269eae805ceab6047777f: the body is parsed first,
  then the final destination is opened with wb. Settled on a narrow atomic,
  immutable input saver, retaining multipart and its response shape. Review
  follow-up agreed this evidence justifies it. Include extracted audio hashes.
- Distinguished lost request before acceptance from lost response after it.
  Permit exact same-ID replay only after same-engine absence reconciliation;
  existing journal without execution proof stays uncertain. No exactly-once
  claim across an engine crash.
- Added a stream-only blackhole while status stays healthy; whole-tunnel failure
  alone would miss this. Use progress-based attempt aborts, not total file limits.
- Removed generic route migration machinery. Preserve legacy pairing/jobs in a
  narrowly upgraded inactive connection until verified SSH reconnect. Keep
  defensive retired-secret environment filters.

## Final synthesized-plan review

Removal reviewer approved after adding inactive historical-state inspectability
and a rule that live production fixes require a new pinned candidate and affected
tests on both providers. Acceptance reviewer approved after specifying real
LoadImage/SaveImage fixture handling, stream-only fault coverage, measurable
post-restoration test bounds, and continued recovery of valid terminal outputs
despite a later engine change. Those changes are incorporated in the active plan.

There is consensus on implementation readiness of the plan, not evidence that
the proposed runtime behavior already passes. The owner approves next. Remaining
uncertainties are explicit implementation/acceptance gates, not invented confidence
percentages. No manual rescue may be counted as an unattended test pass.
