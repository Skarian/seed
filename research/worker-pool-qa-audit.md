# Worker pool QA audit

Reviewed September 22, 2026, after the initial implementation handoff.

**Follow-up:** The later [individual review and correction pass](worker-pool-visual-corrections.md) opened all 82 originals separately. The account below describes the earlier audit and is preserved rather than retroactively claiming it reviewed every original.

**Recovery follow-up:** [Abrupt process recovery and real container transport](worker-pool-recovery-validation.md)
now cover six interruption points and ten SSH/worker transport checks. They
found and fixed a Windows host-trust path bug. The process test uses the built
application, not an installed-package upgrade; the remaining limits are recorded
in that report.

## What was actually reviewed

The initial implementation included representative manual screenshot review and
Chrome interaction checks, not individual visual sign-off on every capture.
This follow-up inspected all 18 contact sheets covering 41 scenarios on desktop
and mobile (82 tiles). Mobile originals 013, 014, 025 and 038 were also opened
at full resolution to investigate apparent problems. This is still not a
full-resolution review of every original image.

The atlas's `passed` field records scenario assertions and successful capture.
It is not a visual approval, screenshot baseline comparison, or proof that all
controls in a scrollable dialog are reachable.

## Findings

| Priority | Evidence | Finding and next action |
| --- | --- | --- |
| High | Desktop/mobile 003, 008, 014, 029 and 033; atlas `cleanup()` | Scenario data carries between tests. Cleanup stops jobs and workers and restores provider keys, but retains catalog entries, media, chats and released rentals. For example, desktop 003 has no video LoRA while mobile 003 does; desktop 014 is empty while mobile 014 contains prior outputs. Reset or isolate each scenario and seed its exact starting state. Test order must not determine the visual baseline. |
| Medium | Mobile 014 original | The third Library tile is blank. Scenario 014 waits for the grid, but unlike 033 does not wait for image decoding. Reproduce to distinguish capture timing from a product defect; require successful asset loading before screenshot approval. |
| Medium | Mobile 013, 025 and 038 originals | The captures do not establish access to the bottom of long dialog content. In 025 the immediate-quit control is below the captured viewport; 038 omits the second worker's actions. This does not prove the UI is broken. Add top/bottom captures and keyboard/touch-scroll reachability assertions, especially for quit and recovery actions. |
| Medium | Scenario catalog and browser suite | Desktop and 390px mobile coverage is broad, and a tablet launch/reload test exists. Dedicated narrow-phone, browser zoom, keyboard-only and focus-restoration coverage is limited. Add targeted coverage rather than multiplying all combinations. |
| Medium | Lifecycle/job tests and `tests/pool-worker.test.ts` | Lifecycle failures and restart reconstruction have useful unit coverage, but the pool driver substitutes its connection in these tests. Final containers also passed isolated startup/authentication checks. A combined real local SSH/tunnel/worker-protocol journey, and abrupt coordinator process death, remain stronger next checks. |

No application defect is inferred solely from a clipped screenshot. These are
confirmed test-evidence gaps and observations requiring targeted reproduction.

## Next local validation, in priority order

1. Make atlas scenarios independent and deterministic. Fix the blank-tile
   capture, add long-dialog scroll captures, review the regenerated originals,
   and record visual review separately from automated assertion status.
2. Start the packaged coordinator as an owned child process with persistent fake
   providers/workers. Kill it at create, submit, output-save and release
   boundaries; restart it against the same isolated profile. Verify no duplicate
   purchase/submission, preserved spend, output recovery and continued quit.
3. Exercise real local SSH setup, per-worker tunnels, pairing, resumable
   transfers, receipts and reconnect against local worker containers, with
   synthetic inference output and no external network. Drop one connection and
   verify the other worker continues.
4. Run a bounded mixed Image/Video queue stress test with several workers,
   duplicate browser submissions, slow saves, partial failures and both quit
   policies. Check every job/receipt/lease and the final resource count.
5. Extend installed-package upgrade testing from idle state to unresolved
   rentals and saved-but-unacknowledged outputs. Recheck preservation, rollback,
   release access, secret redaction and absence of QA routes in production.

These checks need no GPU rental or user interaction. They must use isolated
profiles, owned local processes/containers, synthetic keys and blocked external
provider mutations. No such new execution is claimed by this audit.

Real provider placement, CUDA inference, GPU memory fit, LoRA output quality,
audio quality, generation latency and actual billing still require a later
authorized live GPU validation. CPU checks cannot establish those results.
