# Chat approval reliability — implementation and QA

Implemented and published to the local Seed app on September 24, 2026
(September 25, 03:14 UTC). Branch remains `codex/fal-only`.

## Behavior

- Approved cards explain when they are waiting for sibling decisions and offer
  **Review next request**. The existing group submission rule is unchanged.
- Final approval visibly enters **Preparing…**; Stop remains usable while that
  request is in flight. Direct approval stays inline.
- Failed or interrupted preparation preserves the approved requests and frozen
  seeds, explains the failure on the card, and offers an explicit retry through
  the existing endpoint. Startup never automatically resubmits these requests.
- Stop wins over late preparation completion/failure and delayed browser updates.
- Existing committed jobs recover without duplicate submission. Worker selection
  opens only after the decision actually admits jobs requiring a worker.
- Slow reads cannot replace a newer action, strand the next chat, or block the
  authoritative refresh after a successful approval. Streaming updates carry the
  existing chat version; equal-version job changes also use local ordering guards.

The implementation adds one optional stored group error field and one small
presentation resolver. It reuses the existing endpoint, job transaction,
submission identity, review dialog, and Stop confirmation. No new queue,
background retry service, or database table was added.

## Verification

- TypeScript check passed.
- 118 chat/job tests passed across 11 test files.
- Final browser run: **143 passed**, including 18 approval lifecycle cases,
  seven response-ordering cases, existing branch regressions, and the card atlas.
- The newly added held-read test failed against the earlier staged frontend and
  passed after the targeted fix, establishing that it exercises a real defect.
- Atlas: **43 scenarios × desktop/mobile = 86 passing cases**, with 90 screenshots
  including the expanded review captures. Checks include 320–1440px widths,
  mobile landscape, and a reduced CSS viewport representing browser zoom.
- Screenshots were inspected individually by three reviewers. Final recapture:
  76 screenshots were byte-identical to already inspected captures; changed
  screenshots were inspected again. The undersized terminal Retry button found
  in mobile case 227 now uses the shared card button styling, with a mobile
  touch-size assertion. Existing compact controls inside the expanded review
  dialog remain unchanged.

Final run: `2026-09-25T03:11:16.899Z`.

The runner now stages both frontend and server independently of the live build.
All UI tests use isolated synthetic fixtures and block external provider access.
Passing these checks establishes the tested application behavior, not GPU
generation reliability or performance.

## Review gallery

[Desktop and mobile gallery](http://192.168.1.212:4314/).

Use the numbered full-size captures; mosaics are navigation aids only:

| Cases | Coverage |
| --- | --- |
| 201–222 | Four workflows and LoRA title/count variations |
| 223 | Approved card waiting for another decision |
| 224–231 | Denied, queued, running, failed, completed, revising, stopped, history |
| 232–236 | Branch/feedback drafts, expanded review, multiple inputs |
| 237 | Preparing with Stop |
| 238 | Preparation failure with retry |
| 239 | Interrupted preparation |
| 240 | Older unfinished approval |
| 241 | Stopped after approval |
| 242 | Waiting for two decisions in a long conversation |
| 243 | Retry through the existing review dialog |

Evidence is in `.local/request-card-atlas/`: `manifest.json`, `run.json`,
individual review records, `visual-review.json`, and `rollout.json`.

## Publication and privacy

Published the tested frontend and changed compiled server modules with a backup,
preserving existing hashed assets for already-open tabs. A read-only aggregate
activity check found no unfinished jobs, busy chats, or unreleased workers before
the graceful restart. Health, the served HTML, and entry assets were verified
after restart. The live app remains at http://192.168.1.212:4310.

No private prompts, conversations, uploads, generation payloads, or logs were
inspected. No GPU resources were acquired or changed, and no paid generations
were submitted. Existing unfinished approvals require the owner's explicit retry.
