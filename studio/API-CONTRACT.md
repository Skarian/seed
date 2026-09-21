# Local API

All routes are under /api/v1, require the configured Host, and reject cross-site
requests. Mutations require an exact same-origin Origin header. Credentials and
private config files are never served. Media uploads retain the TUS API.

- GET /studio: provider.name = fal, provider.configured, activity/output counts.
  There is no worker connection or teardown state.
- GET /loras?mode=sfw|nsfw: mode-filtered catalog metadata, names, versions, hash
  revisions, variant, compatibility and upload availability. Defaults to sfw;
  omits local paths and private upload URLs.
- PATCH /loras/:id: set availability to `all` or `spicy`. Standard submissions
  and queued dispatches reject Spicy-only adapters.
- POST /assets/:id/frames: `{time_seconds}` extracts a full-resolution PNG from
  a saved video, preserving its mode and note. Returns the new Library asset.
- POST /jobs: validated request plus Idempotency-Key and X-Seed-Estimate; returns durable local jobs.
  loras is an optional array of {id, revision, scale}, at most three distinct IDs.
  Each adapter must match the image, FL or Ref route.
- GET /jobs and /jobs/:id: job history, provider receipt, timing, saved outputs.
- POST /jobs/:id/cancel: durable local cancellation intent. fal may still complete.
- POST /jobs/:id/acknowledge: acknowledge an uncertain result after inspecting fal.
- POST /jobs/:id/continue: release only the unsent outputs in this request after resolving the reported problem.
- POST /jobs/:id/retry-save: retry saving an existing fal result without generating again.
- No global pause/resume controls. Uncertain submissions require acknowledgment; provider rejections hold unsent outputs until explicitly continued.

Requests specify workflow, prompt, mode, output, seed, count, references, audio,
and optional LoRAs. Images use size `1mp`; videos use `768p` with a whole-second
duration from 5 to 15. Videos are always saved as videos; frames are picked later.
General reference inputs cannot be combined with first/last frame guides.

Media, notes, sequence, repeat/branch and chat routes remain local. There is no
capabilities, pairing, GPU status, or worker API. Requests carry no capability
revision, quality tier, model preset, graph, or worker identity. The database is
fresh; retired provider records are not migrated or replayed.

## Admin, pricing, and provider errors

- GET /admin: credential configured flags and application storage paths only.
- PATCH /admin/credentials/:field: `{value: string | null}` saves/removes one of
  falKey, openrouterApiKey, civitaiKey. No billing/Admin credential. Removing a
  saved credential suppresses environment fallback. Changing fal keys invalidates
  upload receipts and estimates; changes during uploads/submission are rejected.
- POST /admin/credentials/:field/check: read-only provider authentication check.
- GET /admin/loras?mode=sfw|nsfw: grouped catalog including disabled entries;
  each LoRA contains its workflow-specific files. No import progress is included.
- POST /admin/loras/inspect: `{url}` returns Civitai versions, files and reported
  model family support. File names do not imply workflow compatibility.
- POST /admin/loras/import: accepts version_id, mode, name, description,
  default_scale, trigger_words and files: `[{file_id, route}]`. Returns 202 after
  validating the import plan. Routes are image for Krea 2, fl/ref for H3; each
  route maps to at most one file. All selected files activate together.
- PATCH /admin/loras/:group_id: accepts guidance, enabled and files:
  `[{id, route}]`. Returns 202 for a background catalog update, reusing local
  files and valid upload receipts. Existing file IDs remain stable when unchanged.
- GET /lora-imports?mode=sfw|nsfw: safe Activity records with stage, per-file
  status, byte progress and error. No local paths or private URLs are exposed.
- POST /lora-imports/:id/retry: returns 202 and resumes a failed import without
  repeating completed file transfers.
- POST /estimates accepts shared PriceInput: workflow, mode, aspect, size, count,
  optional duration, LoRA selections, and references (kind, role, video duration).
  Returns USD per_item/total, count, endpoint, units, breakdown, id and expires_at.
  Quotes expire after ten minutes and are invalid after server restart or key
  replacement. Pricing inputs must match at submission. Same-priced prompt or
  seed edits do not invalidate an estimate. Source rates cache for one minute.
- Chat card /decision accepts estimate_id for approval. The accepted estimate is
  saved on the approved revision and resulting jobs. Repeats need new approval.
- Jobs expose provider_issue with a safe code, message, action, optional recovery
  URL, HTTP status, provider_type and retry_after_seconds. Raw provider input and
  arbitrary provider messages are never copied into this object.

Pricing and estimate APIs use the regular fal key:
https://fal.ai/docs/platform-apis/v1/models/pricing
https://fal.ai/docs/platform-apis/v1/models/pricing/estimate
Error mapping follows model request errors and infrastructure errors:
https://fal.ai/docs/documentation/model-apis/errors
https://fal.ai/docs/documentation/model-apis/request-errors
