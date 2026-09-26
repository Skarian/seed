# Library preview navigation

The Library now uses the same preview navigation as Chat and Generate: side arrows, keyboard Left/Right, single-finger swipes, and one Back action to dismiss the viewer. Navigation follows the selected media filter, favorites filter and collection in Library order. It works across images, video and audio.

`useLibraryPreview` keeps selection by asset ID so background polling does not select another file. At the end of the loaded page, Next loads older files and continues inside the existing preview. A late page response cannot reopen a closed viewer or override a newer selection. A failed page load leaves the current file and navigation available. Counts use `+` while more files remain unloaded.

Removing a selected item from the active favorites/collection filter advances to the nearest remaining item, or closes the viewer if none remain. Notes, favorite/collection actions and downloads belong to the displayed asset. Pinch/zoom, text inputs, native playback controls and frame picking keep their existing interaction rules.

Production changes are limited to the shared preview controls, Library wiring and a small selection hook. The existing Library page loader now returns its loaded additions; there is no second media cache or new server endpoint.

## Validation

- TypeScript and isolated production frontend build passed.
- Six Library browser journeys passed across desktop and mobile: filters and collection isolation, notes/favorites, swipe and pinch, keyboard, mixed audio/video/image navigation, Back, paging failure/retry, delayed response and closing during paging. Pagination also verifies automatic forward navigation into the next page.
- Seven existing Chat/Generate batch-navigation and Library-image regressions passed.
- Ten numbered desktop/mobile screenshots reviewed individually at full size. Mobile note editing initially overlapped the toolbar; the editor now occupies space below the canvas on small screens. The corrected screenshot and an overlap assertion were verified.
- Public fixture media used real local upload, collection, favorite and note APIs. Only pagination page sizing, delay and failure were explicitly simulated. No private Library items, user requests or paid GPUs were accessed.

Reproduce with `node scripts/test-library-preview.mjs`. This builds under `.local` without changing the running app. [Numbered QA gallery](http://192.168.1.212:4314/library-preview/index.html) · [individual review](library-preview-visual-review-2026-09-26.json).

Publication replaces only the frontend entry page and content-hashed assets, retaining prior assets for open clients. It does not restart the server or workers.
