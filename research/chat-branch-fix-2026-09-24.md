# Chat branch blank-screen fix

Published browser assets to the running LAN app at 2026-09-24T01:26:58Z.

Qwen image-edit requests use `<image1>` reference labels. Chat's composer slot
counter assumed every label matched `<Picture N>`, `<Video N>` or `<Audio N>`
and dereferenced a null regular-expression result. Clicking Branch in Chat
reproduced `Cannot read properties of null (reading '1')` and an empty page.

The fix handles both label families, shares mention recognition between Chat
and the inline editor, preserves input-instance bindings when sending, and
renders Qwen mentions as clickable chips. Unknown labels no longer crash the
counter. Reload testing also exposed the retained Generate page consuming a
Chat branch URL; its branch loader now only handles the Generate route.

Validation:

- Old production browser build reproduced the exact crash through the menu.
- Nine new browser regressions passed: all four workflows, both seed choices,
  reload, removing a draft, Qwen mention sending and image-edit feedback.
- Nine existing browser checks passed for input mentions, chat switching,
  workflow drafts, retry behavior, and composer actions.
- 25 targeted unit tests, TypeScript checking and the frontend build passed.
- Four screenshots were reviewed individually: same/new seed, desktop/mobile.
- Live browser verification used the user's existing image-edit conversation
  and its saved visibility mode. Branching, reload and source mention selection
  passed with no browser errors and no API writes. No generations were submitted.

Deployment copied tested browser assets and replaced plain/gzip/Brotli HTML.
Existing hashed assets were retained for already-open tabs. The server instance
remained `5f8f745b-9f34-4a72-b5b8-cd3ed72c2482`; both rented workers stayed ready.
No backend restart, container update or worker action was performed. Browser
refresh is needed to load the fix. The running backend remains the prior build.

Local evidence: `.local/chat-branch-evidence/` contains the old failure capture,
four reviewed screenshots, deployment hashes and the live browser check.
