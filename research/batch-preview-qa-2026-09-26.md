# Batch preview navigation

Published to the LAN app on 26 September 2026. Refresh existing tabs to load the frontend update; the server and workers were not restarted.

## Behavior

- Opening an output in Chat or Generate starts at that output, with previous/next arrows and an “n of total” indicator. Activity and request details reuse the same component.
- Navigation stays within saved outputs of that submission, ordered by submission index. It does not cross into another request. Single-output previews have no navigation controls; first/last arrows are disabled rather than wrapping around.
- Mobile supports deliberate horizontal swipes plus 44px arrow buttons. Swiping an image switches files only at fitted zoom. Pinch, zoomed pan, vertical gestures and multi-touch do not switch files. Gestures beginning at the screen edge remain available to browser navigation.
- Keyboard Left/Right works for the topmost preview, including when a pending button temporarily loses focus. Text entry, native audio/video controls, collection dialogs and frame picking retain their controls.
- Switching files resets zoom/video/frame state, updates favorite/collection/download actions, and keeps one dialog/history entry. One Back closes the preview after any number of switches.
- Delayed responses cannot replace the newly selected output. Loading and missing-file states retain arrows/keyboard navigation; errors offer Retry.

## Implementation

`JobMedia` moved out of the large job UI module into `web/job-media.tsx`; its callers supply their existing jobs list. It selects only the same submission's completed outputs and cancels obsolete asset reads. The shared media preview stays mounted across loading, errors and file changes, preserving its dialog lifecycle. Navigation and swipe handling are small shared modules; existing input previews also gain swipe/keyboard handling without replacing their existing toolbar controls. No backend, schema, provider, generation or container changes.

## Verification

TypeScript passed. All **25 browser tests** passed on the final build:

- Five batch tests covering desktop/mobile Generate and Chat, image/video batches, unrelated submissions, selected-file favorites, first/last bounds, single outputs, missing outputs, delayed responses and nested collection dialogs.
- Twenty existing organization, Gallery, preview, LAN security-context, frame-picking and generation-feedback tests.
- Actual browser touch events exercise swipe, pinch, zoomed pan and vertical movement. Additional width checks run at 320px. Fixture files are uploaded to a fresh isolated backend; completion records are controlled test data, with no actual generation.

The first test run caught a keyboard-focus gap after a favorite write. Pending disabled controls can move focus to the document body. The fix scopes keyboard handling to the topmost preview and keeps one dialog mounted while loading. The final run passed without relaxing the assertion.

All **10 final screenshots** (901–905, desktop and mobile) were opened individually at full resolution. The video uses a generated green test clip; its native loading indicator is visible briefly in captures. Separate behavioral checks verify video navigation and frame controls. [Review hashes and notes](batch-preview-visual-review-2026-09-26.json).

Computer use against a second isolated real server confirmed clicking the middle Chat output, moving to the last output, keyboard navigation back, and one browser Back returning to Chat. That fixture server was stopped afterward. No private requests, chats, media or live Library content were inspected, and no GPU money was spent.

Reproduce with:

```powershell
npm run typecheck
node scripts/test-batch-preview.mjs media-preview.spec.ts media-preview-lan.spec.ts generate-feedback.spec.ts asset-organization.spec.ts
```

Live verification checked only the frontend HTML and its hashed assets. The prior frontend index was backed up; old assets were retained for open tabs. Rollout record: `.local/batch-preview-atlas/rollout.json`.

[Desktop/mobile QA gallery and mosaics](http://192.168.1.212:4314/batch-preview/index.html)
