# Favorites, collections and reference selection

Published to http://192.168.1.212:4310 on 26 September 2026. Refresh existing browser tabs to load the update.

## Behavior

- Favorite individual saved images, videos and audio files from Library or the shared preview. Generate, Chat and Activity open that same preview.
- Create, rename and delete named collections; a file can belong to several. Collection deletion is confirmed and leaves files and favorites intact. Removing membership does not delete a file.
- Filter Library by Favorites, collection and media type together.
- The shared Gallery picker in Generate and Chat also offers Favorites and Collection. Changing filters retains selected references, including selected files outside the current filtered view. Image editing uses server-side image filtering and retains its ten-image limit.
- Organization is stored server-side in the normal application database and survives reload/restart. It does not duplicate files or change generation jobs, worker images or provider behavior.

## Implementation

Additive schema 10 contains favorite and collection membership tables; foreign keys clean up organization when files are actually deleted. Explicit desired-state PUT requests are safe to repeat. Same-origin mutation protection, readiness checks, missing-file errors and existing visibility rules apply. Collection names are trimmed, normalized and unique per visibility scope.

One asset organization hook coordinates pending writes and confirmed changes across mounted views, preserving newer saved state against older reads. A fresh read can still observe edits from another device. The existing Library hook handles filtering and pagination for both Library and Gallery; one filter component supplies their controls. No new state-management dependency or background service was added.

## Verification

- TypeScript passed.
- 32 focused server/state tests passed: organization, state reconciliation, storage migration/reopen, HTTP, sequences and frames.
- 22 unique browser tests passed. The full run passed 21; one mobile Gallery test initially failed because the test omitted opening the mobile sidebar. Correcting that test-only navigation and rerunning it passed. Application code did not change between those runs.
- Real isolated database/API checks cover creation, rename, multiple memberships, deletion preservation, persistence, combined filters, more than 50 files, stale reads, pending double clicks and failed writes. Delayed/error responses are explicitly simulated only for those failure checks.
- Gallery tests cover Generate reference-to-video, image editing, and Chat; selection retention across filters, image-only behavior and input caps are checked. Existing preview opening, mobile pinch/Back, LAN security-context and generation feedback tests pass.
- All 18 final numbered screenshots were opened and reviewed individually at full resolution. Review hashes and notes: [visual review](asset-organization-visual-review-2026-09-26.json).
- Additional computer-use checks on a separate isolated fixture server confirmed saved stars, collection membership, shared-preview state, nested Back dismissal and selection from the filtered Gallery into Generate.

Visual corrections during review: enough vertical room for actions on audio tiles; keep preview icons together on mobile while Edit image/Pick Frame wraps below; preserve normal desktop card size when filtering down to one file. Captures use labeled test artwork, a three-second green video and a half-second test tone. Video screenshots retain Chromium's native buffering spinner; they verify toolbar layout, not playback completion. Separate preview regression tests cover media behavior.

## Delivery and privacy

Final run: `2026-09-26T05:11:48.937Z`. Staged web build: `.local/asset-organization-web-I668ij`; server build: `.local/asset-organization-server-QnlNFa`.

The app was checked for idle work using aggregate counts only, then its compiled files and an opaque database snapshot were backed up before the additive migration. The first restart was blocked by sandbox access to AppData; previous code was restored and restarted with filesystem permission, then the reviewed update published successfully. The rollback path accepts the additive schema without restoring an old database over later user writes.

Verified live health, the served frontend and hashed assets, a deliberately nonexistent organization route, and schema version 10. No live Library listing, requests, chats, media, credentials or logs were read. No generation or GPU rental was submitted.

LAN review gallery: [desktop/mobile screenshots and mosaics](http://192.168.1.212:4314/asset-organization/index.html). The published gallery contains only QA HTML and screenshot files; database backups remain private under `.local`.

Rollout record: `.local/asset-organization-atlas/rollout.json`.
