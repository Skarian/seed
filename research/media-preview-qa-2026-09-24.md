# Mobile image preview

Implemented in the shared media preview, used by Library, Generate, Chat and references:

- Two-finger pinch zoom (1–6×), one-finger pan, bounded image movement and Reset zoom. Desktop double-click also toggles zoom.
- Zoom resets on file changes and viewport resizing. Toolbar and page do not zoom with the image.
- Opening a preview adds one same-URL history entry. Back dismisses the top preview; explicit close and Escape remove that entry. Underlying path, query, fragment and history state are preserved.
- Edit image waits for dismissal before navigating. Nested picked-frame previews close independently of their video.
- Loading wrappers retain one history entry across reference changes. Chat ignores stale reference responses after dismissal or a newer preview request.
- Mobile toolbar uses two rows when reference navigation is present, fixing overlapping action buttons and navigation arrows.

## Validation

Typecheck and staged Vite build passed. Sixteen Playwright tests passed across `media-preview`, `input-mentions`, `generate-feedback` and `library-images` specs. The fixture server reported no external requests. Tests use fixture assets and conversations exclusively.

Mobile touch tests use Chromium touch input, including two simultaneous contacts. Coverage includes zoom in/out, dragging, reset, rotation, reference changes at 320px and 390px, repeated Back/button/Escape dismissal, preserved page state, Edit image navigation, and nested video/frame dismissal. A deliberately delayed Chat reference response verifies that dismissing during loading cannot reopen the preview.

Screens 401–405 on desktop and mobile were reviewed individually. The mobile reference-toolbar overlap found during testing was corrected and rechecked. The atlas is `.local/media-preview-atlas/index.html`, published for LAN viewing under `/media-preview/index.html` on port 4314.

Limit: browser Back and touch input were tested in desktop Chromium emulation; a physical phone OS back-swipe was not available to test directly.

Build was staged outside `dist` and published as frontend assets only. No app restart, worker action, model/API generation, or user-content inspection was involved.

## Plain HTTP regression

The first release used `crypto.randomUUID()` in the preview history hook. Chromium exposes that API on localhost but not on an ordinary HTTP LAN origin. Opening any preview on the user's LAN therefore threw `crypto.randomUUID is not a function`. The earlier localhost suite did not cover this security-context difference.

The hook now uses Seed's existing `clientId()` helper, based on `crypto.getRandomValues()`. The new `media-preview-lan.spec.ts` loads the actual app under `http://seed-qa.test:4311`; the fixture interceptor forwards only to the isolated loopback fixture server, rewriting its Host/Origin headers. Browser APIs are not mocked: the tests assert `isSecureContext === false` and `crypto.randomUUID` is absent. The old bundle reproduced the crash; desktop and mobile regression cases cover opening, zooming, Back, explicit close and reopening. No request is sent to the real app's assets or conversations.
