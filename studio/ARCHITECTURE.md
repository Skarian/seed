# Architecture

The application is local Fastify + React + SQLite. It calls fal's model APIs:

Browser → local API / approved chat requests → durable local jobs → fal queue
→ private fal outputs → local verified media → Library.

`server/fal.ts` owns credentials, bounded network requests, private multipart
uploads, signed URLs, queue operations, and output downloads. Paid submission is
one POST with no automatic retry. `server/fal-request.ts` maps application requests
to the Krea/H3 contracts. It does not claim a provider precision or sampler.

`server/jobs.ts` persists one job per output and schedules at most two active fal
requests. Request IDs, endpoint, actual input, pinned adapters, queue/processing
observation times, upload duration, and local completion times are retained.
Polling observations are approximate stage boundaries, not provider billing data.

Known requests are recovered after restart. Unknown submission outcomes require
review. Output-transfer failures retain the result receipt and offer a per-output retry of saving.
Cancellation intent is durable; remote cancellation can race with completion.
The app still saves a result if fal completes it. A missing/cancelled remote
request whose outcome cannot be established requires manual acknowledgement.

Local media preparation preserves selected clip ranges, prepares frame guides,
and separates selected video soundtracks into explicit audio slots. Those slots
precede standalone audio to match the application's prompt bindings. Provider
prompts translate Picture/Video/Audio labels into fal's Image/Video/Audio labels.

`server/loras.ts` stores content-addressed local masters and a private fal upload
receipt. Selectors pin ID, hash revision, strength, and image/FL/Ref variant.
Catalog mode availability filters selectors and is checked at submission and
dispatch. `server/frames.ts` extracts individual PNGs from saved videos locally;
the shared media preview exposes this as Pick Frame.
Known H3 Kohya names are converted without changing matrix bytes; both source
and converted hashes are retained. The application has no automatic acceleration
adapter. Imports remain untested
until actual endpoint compatibility is established.

The database contains current fal jobs, local media, chat approvals, frame
sequences, and notes. Schema 7 removes global dispatcher state and safely migrates held requests from schema 6. It removes
historical GPU identity and lifecycle columns; older schemas require a separate
fresh data directory. Configuration and LoRA masters live outside SQLite.

The browser has three workflows: Text to image, Text to video, and Ref to video.
Video resolution is fixed at 768P. Generation readiness depends only on a fal
key; there is no infrastructure status panel or capability handshake.
Chat code loads on demand. Hashed frontend assets use long-lived caching and
precompressed gzip/Brotli files; HTML revalidates on navigation.

The React shell in `web/app.tsx` owns navigation, sidebar layout, and the shared
studio snapshot. Generate and Library own their page state. Generate stays
mounted across navigation to preserve pending uploads, drafts, and completion
notifications; Library only fetches while open. Their hooks separately manage
draft reduction and persistence, submission, estimates, and paginated media.
Drafts use the same typed request structure as Chat, with migration from the
earlier stored format. Pending submission keys survive workflow changes, and
polls cannot overwrite newer locally accepted job records.

`PromptField`, `RequestSettings`, and `CostPreview` are shared by Generate and
Chat review. `ApprovalCard` owns the quote used for both its dotted footer and
the approval payload. Changing billable settings immediately invalidates the
displayed quote; a stale response cannot enable submission. Sidebar positioning
lives in its own eagerly loaded stylesheet, independent of Admin loading.

Admin and pricing are small local services. `credential-store.ts` keeps secrets
in the user config directory and exposes only configured flags. Admin groups a
LoRA's workflow-specific files into one catalog entry. Civitai's version metadata
identifies the supported model family; users explicitly map files to workflows,
without filename inference. `lora-imports.ts` persists grouped acquisition jobs,
validates origins and checksums, and activates all selected files together after
their private uploads succeed. Failed imports preserve the previous catalog and
can resume completed transfers. Admin shows only an acceptance toast; Activity
owns stage progress, per-file download progress, errors, and retry. Catalog
revision changes refresh both Admin and generation selectors.
`pricing.ts` fetches current fal
rates with the inference key and binds an expiring quote to billable settings.
Generate and Chat approval both require this quote. `fal-errors.ts` normalizes
safe user-facing recovery instructions; funds/auth/rate failures hold unsent outputs. Only explicit continuation of that request releases them. Global pause/resume state and APIs have been removed.
The browser never receives keys or local adapter paths.

Library and the reference gallery list extracted frames as individual images. Legacy sequence records are supported only for safe recovery and individual deletion; no separate Library category or sequence picker is exposed.
