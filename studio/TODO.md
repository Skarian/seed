# Design iteration

Reviewed 25 September 2026 against the current implementation.

Diagnosed and implemented with three subagents. Scope and evidence are in the [minimal repair plan](../research/todo-diagnosis-plan-2026-09-25.md); validation and release details are in the [repair report](../research/todo-repair-qa-2026-09-25.md).

## Bugs

- [x] **Retry an unknown generation safely.** Shared Retry/View worker controls recover the original request with fresh identity checks and durable duplicate protection. Unknown jobs stay visible, worker status is corrected, cancellation wins before POST, and interrupted engines fail closed. Published with server/transport/real-adapter tests and individual desktop/mobile visual review. [Implementation and QA](../research/job-recovery-qa-2026-09-26.md); [reviewed plan](../research/unknown-generation-recovery-plan.md).

- [ ] **Feedback can create an additional approvable request instead of replacing it.** Reproduced with the real chat service and controlled model replies: ordinary chat can create instead of edit; explicit feedback loses its enforced target after the first successful change in a turn. Confirmed code weakness, not yet tied to the user's specific occurrence or a recent regression. Diagnosis only; no live changes. [Evidence and proposed correction](../research/chat-feedback-diagnosis-2026-09-26.md).

- [x] **Compact request cards after approval.** Shared grid layout separates LoRA wrapping from header/actions; queued/running requests retain the heading pencil and Cancel stays on the header row. Added actual approval-to-queued/running transitions across valid workflows and no/short/medium/long/unbroken/multiple LoRAs, with spacing assertions alongside overflow and touch targets. 181 browser tests passed; 53 captures reviewed individually. Frontend update published without a backend restart. [Fix, QA and earlier coverage gap](../research/card-layout-qa-2026-09-25.md).

- [x] **Failed worker launches remain visible.** Persistent Launch failed cards derive from the existing rejection flag, with guarded dismissal and retained Activity history. Find another GPU clears old selections and loads fresh offers. Rejected launches stay out of rental accounting; uncertain allocations remain visible. Capacity and price-change errors are distinct.

- [x] **Image deletion cleans cached copies.** Existing job/asset references protect shared and in-flight files. Target previews are fenced and drained; derivatives are removed before originals/records. Failed removal remains retryable, including sequence cleanup. Recognized orphans are swept at startup/after deletion with bounded failure logs. Legacy uncommitted copies lack per-asset ownership and rely on that sweep.

Manual cleanup completed 24 September: removed six verified orphaned prepared images (8,409,129 bytes). Preserved current Library thumbnails, references with live source assets, and active-job inputs. Audit: `.local/image-cache-cleanup-2026-09-24/result.json`.

- [x] **Startup reporting and resumed-download rate.** Transfer bytes remain visible when telemetry is stale; rate becomes unavailable and reporting age remains explicit. Older workers do not falsely promise a speed measurement. Clearly reported container phases and explicit retry state are shown. Both worker images now exclude cached bytes from measured transfer rate; new rentals use published digest pins. Unrealistic fixture download concurrency and engine/failure states were corrected.

## Unverified report and bounded recovery work

- [ ] **Intermittent blank screen after Branch in Chat remains unverified.** Current isolated branch/navigation checks pass, but do not reproduce the later report. Keep it open until a valid reproduction or content-free crash evidence identifies the cause. Known label, branch-restoration and preview-LAN fixes are not proven explanations for this report.
- [x] **Blank-screen recovery and private diagnostics.** One boundary above the app offers Reload/Open Generate. Existing Diagnostics stores only whitelisted error classes, build/frame coordinates and route enums, with payload bounds, deduplication and rate limits. Messages, full stacks, private content and IDs are excluded. Async errors leave an otherwise working screen visible.

## Recently completed

- [x] **Browse a generation batch inside its preview.** Chat/Generate/Activity share one output preview: side arrows, keyboard arrows, position counter and mobile swipes. Pinch/pan stays independent; video controls and nested dialogs retain their input handling. Missing/delayed outputs remain navigable and one Back closes the preview. 25 browser tests passed; 10 final captures reviewed individually; frontend published without restarting the server. [QA](../research/batch-preview-qa-2026-09-26.md).

- [x] **Favorites and named collections.** Persistent per-file stars; create/rename/delete collections and multiple memberships; shared Library/preview controls. Chat and Generate's Gallery picker can combine Favorites with a collection while preserving selected references. 32 focused server/state tests and 22 unique browser tests passed; 18 final captures reviewed individually. Published to the LAN app. [Implementation and QA](../research/asset-organization-qa-2026-09-26.md).

- [x] Approval preparation/recovery, stale-response handling, and card overflow fixes. Compact layout after approval was completed in the follow-up above; the original QA did not establish consistent spacing across lifecycle states. [Original QA](../research/chat-approval-reliability-qa-2026-09-24.md).
- [x] Separate Vast/RunPod selection views with provider-specific metrics, sorting and retained selections. [QA](../research/worker-selection-qa-2026-09-24.md).
- [x] Confirmation dialogs for destructive worker shutdown actions. [QA](../research/worker-shutdown-confirmations-2026-09-24.md).
- [x] Image preview pinch/pan, browser Back dismissal, mobile toolbar overlap and delayed-reference reopening fixes. Fixed the subsequent plain-HTTP LAN opening regression and added browser security-context coverage. [QA](../research/media-preview-qa-2026-09-24.md).

## Design

- [ ] **User-controlled resolution defaults.** Add shared Images and Video defaults in Admin → Generation, inherited by Chat and Generate with manual request overrides. Preserve saved request sizes through approval, feedback, branching and retries; update preparation, caching, worker capabilities/export checks and actual-dimension validation. Qualify new sizes on GPUs after offline and individual desktop/mobile visual QA. [Implementation plan](../research/resolution-settings-plan.md).

- [x] **Worker startup logs through Ready.** Published one shared View startup logs disclosure with RunPod system/Vast daemon boot output and structured download/verification/failure/engine events. Server collection and bounded saved records remain available after Ready/release, including older workers selected from Activity. Removed broad lifetime engine-log collection. 138 server tests and 26 browser tests passed; 24 final screenshots reviewed individually. Existing workers without a captured startup record show an unavailable message. Complete engine startup tracebacks remain outside this version. [Implementation and QA](../research/worker-startup-logs-qa-2026-09-25.md).

- Refine Generate, Library, and Chat around the four current workflows: Text to image, Image to image, Text to video and Reference to video.
- Review reference roles, LoRA selection, and job progress with real usage.
- Keep adapter compatibility evidence tied to the file hash, model family and task variant.

The app now uses separate image/video worker pools on Vast and RunPod. The old
fal-only migration note no longer describes the current architecture.
