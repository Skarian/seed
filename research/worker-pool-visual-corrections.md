# Individual visual review and corrections

September 22, 2026. Follow-up to the initial QA audit.

## Review method

All 82 original screenshots (41 desktop and 41 mobile) were opened **one at a time**, at original resolution. No contact sheet was used to approve a screen. Findings were recorded per image in [worker-pool-visual-review.json](worker-pool-visual-review.json), then deduplicated before editing shared code.

The original review is preserved as evidence of what was wrong. Reinspection of corrected captures is recorded separately. A passing atlas test means its assertions and capture passed; it does not itself mean visual approval.

## Deduplicated findings

| Findings | Root cause and resolution |
| --- | --- |
| F01, F14, F18 | The screenshot suite reused profile data and an advanced fake clock. Each atlas journey now has its own server process, profile, clock, fake credentials and transports. Captures return to scroll origin and await fonts/images. Empty Library and one-output Library cases assert exact state. The old blank third tile was in leaked fixture content; this review does not claim a reproduced production media bug. |
| F03, F19 | Global `footer` styling added a 45px top margin to worker and LoRA cards. Scoped it to the application footer; gave LoRA metadata and hints explicit spacing. Reduced the mobile worker header and launch footer while preserving rates, warnings and quit controls. |
| F02 | Changed credential text to “Keys are stored locally on this PC.” Keys are still sent to the relevant services/workers where needed. |
| F04 | File sizes use B/KB/MB/GB instead of rounding small nonempty files to “0 MB.” |
| F05 | The shared LoRA picker action now keeps its link treatment inside review dialogs despite generic dialog button styling. |
| F06, F09 | “Estimated spend” is consistent; one worker uses singular wording. Positive accrued spend below one cent displays `<$0.01`. Rates retain precision and billing calculations are unchanged. |
| F07, F08 | Avoid repeated provider names. When no provider can return offers, advise resolving credentials/availability instead of suggesting different filters. A genuine zero-match filter still shows filter advice. |
| F10 | Anonymous adapter labels in global worker status are intentional: the pool prepares adapters across modes and must not reveal hidden-mode names. Preserved this boundary rather than displaying catalog names globally. |
| F11 | Server-provided actions omit Reconnect for preparation failures and omit Finish once shutdown is committed. Immediate quit remains available, including while provider termination is unconfirmed. Pool Finish disables when all active workers are already finishing/releasing. |
| F12 | The atlas now captures overlapping full-resolution viewport images for scrollable dialogs, linked beside the numbered original. Quit/recovery reachability is also covered by interaction tests. |
| F13 | Generate distinguishes queued outputs waiting for a worker from outputs executing. Mixed requests still show active, queued and saved counts. |
| F15 | Styled and aligned the return-to-workers control in Admin, with a 44px minimum target. |
| F16 | Mobile Generate identifies the current workflow in the shared app bar. |
| F17 | Enlarged credential actions, request edit/approval controls, Activity actions and mobile worker close/quit targets. Added actual rendered-box checks for credentials and request controls. |
| Reinspection | Fast completion could stack “submitted” and “saved” toasts. The same request now updates its notification on completion. |
| Short landscape | The added 844×390 interaction test reproduced an inaccessible offers list: fixed header sections consumed the dialog height. On short screens, the entire dialog now scrolls and the launch footer stays in normal flow. |

## Validation result

- 260 application tests passed; typecheck and production build passed.
- All 82 atlas scenarios passed with fresh per-scenario processes/profiles; 17 extra scroll captures were generated. All 17 were inspected individually as well as representative corrected full-page views.
- Browser suite: 34 passed and the newly added short-landscape journey exposed a defect. After its fix, the targeted 320×568 and 844×390 launch/quit test passed. The new credential/edit/approval touch-target checks also passed.
- The final mobile approval states were recaptured after the last button-size correction. Other atlas dimensions are unaffected by the short-landscape media query.
- [Reinspection journal](worker-pool-visual-verification.json) separates original findings from the later correction checks, including intermediate failures and their final checks.
- Updated offline demo: <http://192.168.1.212:4314>. Numbered screenshots and scroll views: <http://192.168.1.212:4312>. Both URLs returned HTTP 200. The demo uses a fresh isolated profile under `.local/worker-pool-demo-review-*`; the previous demo profile remains untouched.

## Remaining validation

Everything here uses isolated local fixtures. No GPU was rented, no paid inference ran, and no real profile was reset. Real provider placement, inference quality, timing and billing remain unvalidated. The coordinator crash/restart and real local SSH integration work listed in [worker-pool-qa-audit.md](worker-pool-qa-audit.md) is separate from this visual correction pass.
