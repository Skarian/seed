# Request cards and branch regression QA — 24 September 2026

The reported card problem was reproduced with long unbroken LoRA names. The
card's intrinsic width and non-shrinking content pushed Edit, Deny, and Approve
outside the visible card at narrow widths. A page-level overflow check alone
missed it because the surrounding chat clipped the overflow.

## Changes

- Bound shared request cards and branch drafts to the available width and a
  640px desktop maximum; retain compact cards when their content is short.
- Allow LoRA names, versions, and title containers to shrink and wrap, including
  unbroken and multilingual names. Apply the same wrapping to review selectors.
- Keep mobile Edit beside the heading when LoRA summaries grow taller. Keep
  approval actions inside the card and at least 44px high on mobile.
- Invalidate pending branch initialization when the user leaves the branch,
  starts a new chat, switches chats, or starts another branch.

No prompt/composer redesign, backend migration, paid inference, worker restart,
or provider mutation is part of this change.

## Evidence and coverage

`npm run test:cards` passes **104 browser tests**: 72 card cases, 19 new branch
lifecycle cases, and 13 existing branch cases. The final TypeScript check also
passes. Final run: `2026-09-25T02:07:55.030Z` (24 September local time).

The card catalog has 36 scenarios, IDs 201–236, each on desktop and mobile:

| Dimension | Coverage |
| --- | --- |
| Workflows | Text to image, image to image, text to video, reference to video |
| LoRAs | None, short, long name/version, unbroken, multilingual, three mixed names, missing catalog entry |
| Inputs | Zero, first frame, two image-edit inputs, three video references, ten image-edit inputs |
| States | Review, approved, denied, queued, running, failed, completed, revising, stopped, revision history |
| Other surfaces | Branch draft, feedback draft, review dialog inputs and LoRA settings |
| Widths | 320, 360, 390, 600, 601, 650, 651, 768, 1024, 1440 CSS pixels |
| Additional layouts | 844×390 touch landscape and 720×500 CSS viewport (zoom equivalent) |

This produces **432 checked layout configurations** and **74 screenshots**.
Assertions check the bounds of cards, summaries, individual badges, titles,
selectors, and action buttons; overlap; action accessibility; and browser errors.
The review dialog is tested as a scrollable surface, not incorrectly required to
fit all its content into one viewport. Its inputs and lower LoRA/settings area
have separate captures. Completed video fixtures use a playable local MP4.

Screenshots were inspected one at a time, with findings deduplicated before
correction. This caught misplaced Edit controls, oversized branch drafts, and
missing review-dialog coverage in addition to the original overflow. The numbered
mosaics are navigation aids, not the basis for visual acceptance. The final
review record is `research/request-card-visual-review.json`; the full gallery,
screenshots, and manifest are under `.local/request-card-atlas`.

The matrix covers valid combinations and representative lifecycle intersections;
it is not a claim to cover every possible application state or browser engine.
Tests use Chromium, isolated local state, and deterministic API fixtures. External
requests are blocked and audited. No GPU or model execution is involved.

## Branch findings and remaining uncertainty

A delayed source-job response could restore an abandoned branch after clicking
New chat or switching to another conversation. Both transitions reproduced the
race and now have regression tests. Additional tests cover branching into a new
chat for each workflow, desktop/mobile, both seed choices, page reload, follow-up
submission, and a missing source job.

The user's intermittent **entire-screen disappearance has not reproduced**.
The race fix must not be represented as proof that this separate symptom is
resolved. It remains in `studio/TODO.md` pending a reproducible path or actual
browser exception and stack.

## Repeatability and publication

The runner builds into a unique staging directory, leaving the live frontend and
worker processes alone. Captures carry a run identifier; stale captures count as
missing instead of passing. The broader `test:visual` command also runs this
matrix, so subsequent card changes do not depend on remembering a separate check.

Frontend publication copies and verifies hashed assets before replacing the
HTML entry point, retains old assets for already-open clients, and verifies plain,
gzip, and Brotli responses. Publication evidence, including the server instance
and worker states before and after, is stored at
`.local/request-card-evidence/deployment.json`.
