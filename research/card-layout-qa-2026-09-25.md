# Compact cards through approval and generation — 25 September 2026

The reported mobile card was an active request, not the awaiting-approval state.
The previous fix kept approval cards compact but left active cards with a full
Edit button and a wrapping action row. Prior checks mainly established containment
and accessible targets; lifecycle fixtures only used reference video with three
adapters. The visual review also accepted the detached row. This was incomplete
layout work, not evidence of a browser cache problem.

## Change

The shared RequestCard shell now places adapter badges on their own spanning
grid row. They cannot force Cancel below the header. Edit remains a pencil in
the shared header while queued/running, retaining the existing review action.
Mobile approval decisions still get a dedicated row with full touch targets.
Cards size to their content within the existing available-width/640px bound.
Drafts and attached-request summaries retain their inline adapter metadata.

No prompt, coordinator, generation, worker, or provider behavior changed.

## Validation

- `node scripts/test-request-cards.mjs`: **181 browser tests passed**.
- TypeScript check passed.
- **62 scenarios on desktop/mobile, 124 passing catalog entries**. No missing
  captures. Existing branch, submission recovery, and stale-response checks pass.
- New scenarios **244–262** click Approve and progress through queued/running,
  checking each stage at 320–1440px, plus the existing landscape/zoom checks.
  Valid image/video workflows cover no, short, medium, long, unbroken, and three
  adapters. Image editing has no LoRAs. Each new case also opens the heading Edit
  control to verify the review action still works.
- New assertions reject a missing heading Edit, detached active action row,
  unnecessary vertical space, and oversized medium-title image cards.
- **53 captures reviewed individually**, including all 38 new desktop/mobile
  cases, four medium-title intermediate stages, and eleven previous-layout
  checks. Exact file hashes: `card-layout-visual-review-2026-09-25.json`.
- The initial implementation made mobile reference approval cards 137px tall;
  the existing compact-height regression caught this. Shared mobile edit alignment
  was corrected before the successful full run.

Run: `2026-09-26T01:27:45.216Z` (25 September local time).
QA uses isolated application fixtures; no private chats/requests were read and
no GPU/provider actions were taken. Chromium geometry checks do not certify every
browser engine or every possible title.

## Publication

Published only staged frontend assets, keeping old hashed assets for open clients.
The backend instance stayed unchanged. Rollback HTML and publication receipt:
`.local/card-layout-rollout-1790386691165/`.

App: http://192.168.1.212:4310

Gallery: http://192.168.1.212:4314/index.html

Reported-shape example: http://192.168.1.212:4314/mobile/246.png
