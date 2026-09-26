# Seed

Seed is a local image and video studio with a server-owned GPU worker pool.
Your PC stores the Library, chat history, job records, credentials, and rental
history. Image and video workers run on GPUs you choose from Vast or RunPod.

## Run locally

Use Node 26.8.2 or later in the 26.x line and an OpenSSH client:

```sh
npm ci
npm run build
node dist/server/cli.js setup
node dist/server/cli.js start
```

Setup works without keys. Open the printed address and enter your provider,
OpenRouter, Civitai, and optional Hugging Face keys in **Admin → Credentials**.
Saved keys take precedence over environment values and never return to the
browser. Provider keys cannot be removed while their rentals are unresolved;
replacement keys must still see every active rental.

`seed start` launches a detached local server. Closing the browser leaves
workers, jobs, transfers, and cost tracking running. Keep this PC awake and
connected. `seed stop` stops the coordinator, not your rentals: restart Seed to
resume reconciliation, or explicitly quit workers before stopping the server.
Use `seed setup --host <LAN IPv4>` while stopped to select a local-network
address. This personal, local app is not intended to be exposed to the internet.

## Workers

The sidebar GPU status opens the pool. Browse both providers, choose Image or
Video workers, select quantities, and review the combined hourly quote before
launching. The app provisions each rental, connects through a private SSH
tunnel, prepares its models and adapters, and dispatches compatible queued jobs.
No chat agent or external provisioning script is involved.

- **Image:** Krea 2 Turbo for text to image, plus Qwen Image 2.1 for image editing.
  Generate and Chat accept one source and up to nine reference images, Quantity
  and Seed. The Image container bakes in the official INT8 ConvRot Qwen model
  and encoder plus BF16 VAE (17.28 GB); one ComfyUI engine manages both models.
  RTX 5090 GPU qualification is the next step; no latency/quality claim yet.
- **Video:** the previous H3 high-quality recipe on one RTX PRO 6000 Blackwell
  96GB: pruned INT8 ConvRot, INT8 conditioner, native video/audio VAEs,
  30 steps, Kitchen attention and Sol attention. Both FL and Ref tasks share
  one logical Video worker. This phase does not change that measured recipe.

Each worker executes one output at a time. Quantity fans outputs across
compatible workers, or runs them sequentially when only one worker fits.
Image jobs never take over a Video worker. Requests can queue with no workers;
Seed never rents or replaces a GPU without an explicit launch.

Workers stay up until you quit them. Every worker and the whole pool support:

- **Finish jobs and quit:** drain compatible requests already queued when you
  click, save and acknowledge outputs, then terminate the rental.
- **Cancel jobs and quit now:** terminate without waiting for generation,
  preparation, or output transfers. Unsaved work may be lost. The pool action
  also cancels queued requests.

The sidebar and popup show hourly rates and estimated spend for active rentals.
Released rentals remain in Activity. Estimates include quoted compute and
provisioned disposable storage. Vast transfer charges are shown where supplied
but are not included in elapsed-time spend. These are estimates, not invoice
reconciliation. Charges remain visible while termination is unconfirmed.
There are no per-generation cost estimates or approval price gates.

## Worker image releases

Build targets, protocol, pinned model sources, and publication instructions
are in [worker/README.md](worker/README.md). `worker/releases.json` must contain
published image references pinned by registry digest before live rentals are
enabled. A local Docker build alone is not a deployable provider release.
Unpublished releases fail before any provider create call. The package includes
these release records and each role's base-model manifest.

The current Image and Video releases are public on GHCR and pinned in
`worker/releases.json`. [Publication evidence](worker/publication-evidence.json)
records verified image identities and anonymous registry access. GPU execution
has not yet been qualified on a rented worker.

## Generate and Chat

- Images: 1280×720 or 720×1280 PNG.
- Video: native 1344×768 or 768×1344, 5–15 seconds, generated audio or silent.
- Text to video, reference to video, and first/last-frame image guides.
  General references and frame guides can be combined.
- Quantity 1–16, with persisted output seeds.
- Pick Frame in the video preview saves a full-resolution image to the Library.

Generate and Chat use the same persisted request and job pipeline. Chat prepares
requests for approval and receives eligible LoRA descriptions, trigger words,
and strengths. It generally chooses one adapter or none. Generation can continue
without an open chat or browser tab.

## LoRAs

In **Admin → LoRAs**, paste a Civitai URL. Seed checks the model family, lists
versions/files, and lets you map each file to supported workflows. The same
file can be mapped to both H3 routes when appropriate. Filenames never determine
compatibility. Set a name, description, trigger words, and preferred strength.
Apply records pinned Civitai file/version IDs, URL, size, and SHA-256 locally.

The actual files download directly to a **new worker** from Civitai/CDN using
your saved credentials. Seed does not relay binaries through the PC or upload
them to another inference service. Every new worker receives all enabled,
source-ready adapters for its role; the launch manifest is immutable. Existing
workers do not receive later additions. A request needing an absent adapter
waits for a compatible new worker.

A failed optional adapter can be retried or omitted before readiness. Once
ready, the installed adapter inventory is frozen. Generation supports up to
three explicitly selected adapters, each at strength 0–4. Successful worker
outputs record compatibility evidence; old provider tests do not imply worker
compatibility. Legacy converted adapters without a proven original source are
marked for reimport rather than silently downloading different bytes.

## Recovery and storage

The server journals launch intent before provider creation and job assignment
before submission. Uncertain provider creates are reconciled by the unique
recorded launch name; they are never blindly repeated. Quit intent also applies
to rentals discovered after a delayed create response. One coordinator owns a
profile, and the database enforces one active job attempt per worker and per job.

Outputs are downloaded to partial files, checked by size/SHA-256, decoded,
saved to the Library, and only then acknowledged for worker cleanup. A failed
save retains the remote output and offers a retry without generating it again.
A missing job receipt never triggers an automatic duplicate generation.

Use the standard user data/config directories (shown in Admin). In development,
`STUDIO_DEV_ROOT` selects an isolated profile. Schema migration makes a
`studio-before-pool.sqlite` backup before adding pool tables. Saved media,
chat history, catalog metadata, and historical provider receipts remain intact.
Old unfinished API-provider requests are parked for review, not resubmitted.

## Acquisition history and diagnostics

Seed retains worker acquisition summaries and lifecycle milestones in its normal
user data directory (`studio.sqlite`), including released and rejected attempts.
History records the provider, GPU/host when supplied, pinned image, hourly rate,
first readiness time, recovery actions and release confirmation. Existing rentals
are marked as partial legacy history; missing readiness timestamps are unknown,
not evidence that a historical worker failed.

`seed diagnostics --since 2026-09-23 --provider vast --class image` prints the
acquisition report. `seed diagnostics --worker WORKER_ID` prints the timeline,
retained failure explanations and the first page of detailed exchanges. This
works while the server is stopped and never rents or modifies provider resources.

The same reports are available from `GET /api/v1/pool/history` (optional `from`,
`to`, `provider`, `worker_class`), and `GET /api/v1/pool/workers/:id/history`
(`after` follows `next_cursor`). `GET /api/v1/diagnostics?level=error` exposes
sanitized server exceptions with cursor pagination. Query dates use ISO timestamps.
The normal application same-origin restrictions apply to all these routes.

Detailed exchanges retain status, timing, correlation IDs and bounded sanitized
response content for 90 days, capped at 10,000 events. Request credentials,
environment values, prompts and references are excluded. Long-term acquisition
summaries, milestones and grouped failure explanations survive detail expiry.
Errors are sanitized before local storage. During container startup, Seed samples
RunPod system/container logs and Vast's provider-managed S3 daemon-log exports at
most once per worker every five minutes. Reachable worker download/engine log
tails are collected after stalls or failures. Collection failures are recorded
too. Log collection never delays immediate release. Provider rate limits preserve
their Retry-After delay when retrying termination.

For qualification, `POST /api/v1/pool/workers/:id/history` can attach a campaign,
note and a sticky `manual_intervention` flag. A repaired attempt must remain
marked; reaching readiness is distinct from qualification without manual repair.
Spend figures are elapsed-rate estimates, not invoices or transfer-inclusive totals.

## Running verification

```sh
npm run verify
npm pack --pack-destination .local
npm run test:package -- .local/skarian-seed-0.1.0.tgz
npm run test:browser
npm run test:visual
npm run test:cards
npm run qa:serve
```

Tests use injected provider/worker transports, isolated local profiles, and
real persisted app state. The browser harness rejects external network calls;
it cannot rent a GPU or submit paid inference. Worker CPU tests and local
container smoke checks are documented in `worker/README.md`.

The visual atlas captures numbered, captioned scenarios on desktop and mobile,
with individual screenshots, mosaics, an HTML gallery, and a JSON index.
`npm run test:visual` captures the application atlas and the request-card matrix;
`npm run qa:serve` makes the
read-only report available on this PC's local-network address, port 4312.

`npm run test:cards` builds the frontend and server into unique staging directories
and runs 43 card scenarios on desktop and touch-enabled mobile, plus branch,
approval lifecycle, and stale-response regressions. It checks ten widths, mobile landscape, and a reduced CSS
viewport for zoom, covering all four workflows, LoRA title lengths and counts,
request states, drafts, and review dialogs. Approval checks cover waiting siblings,
preparation, failure/retry, interrupted startup, Stop, and delayed HTTP/stream updates.
Reports go to
`.local/request-card-atlas`; set `SEED_ATLAS_ROOT` to that directory when serving
this gallery. The live frontend and workers are not changed by these tests.
Each capture is tied to its test run, so an old screenshot cannot make a missing
case pass. Review individual full-size screenshots before using the numbered
mosaics to navigate or discuss findings.

Live GPU inference and provider purchases require a separate test
run; passing offline tests does not establish generation latency or quality.
