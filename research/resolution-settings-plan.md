# User-controlled resolution defaults

Status: proposed, September 26, 2026. Source audit and three independent reviews completed; no application changes or GPU tests performed for this proposal.

## Product decision

Add two application defaults, controlled by the user:

- **Images** applies to Text to image (Krea) and Image to image (Qwen).
- **Video** applies to Text to video and Reference to video (H3).

Store them on the Seed server so Chat, Generate, phone, and desktop share the same choices. Chat inherits the appropriate default; the model does not select or change resolution. Keep existing sizes as the initial defaults.

Use **Admin → Generation** for the two full-width controls. Reuse a full-width Resolution field in the existing Generate/request editor, with a link to change defaults. Generate starts on **Default (current value)**; an explicit choice overrides this request only. A saved Chat proposal shows its concrete size and can be changed manually through the existing editor. Changing a default does not require a confirmation modal.

This provides one place to set ordinary behavior without requiring four workflow preferences, per-chat preferences, another sidebar item, or agent-managed settings. Keep resolution in the existing expanded request details; do not add another badge or block to compact approval cards.

## Candidate sizes and their meaning

| Setting | Initial default | Candidates to qualify |
| --- | --- | --- |
| Images | Approximately 1 MP | Approximately 0.5 MP and 2 MP |
| Video | 768p | 480p |

These candidates are an initial bounded scope, not a claim that the current containers support them. Only qualified choices become available in the released UI. No custom dimensions, upscaling workflow, new aspect ratios, or new video pipeline in this change.

Preserve current behavior exactly:

| Workflow | Current output |
| --- | --- |
| Krea Text to image | 1280 × 720, or 720 × 1280 |
| Qwen Image to image | Source shape, capped near 1024² pixels, aligned to 32 pixels; no deliberate enlargement of small sources |
| H3 video workflows | 1344 × 768, or 768 × 1344 |

The image setting denotes approximate pixel count, not one width/height pair. Krea follows the chosen aspect ratio; Qwen follows the source shape. Generate/review can show the resolved dimensions beneath the control when known. Qwen should say “Up to … MP; keeps the source image’s shape.” A 512 × 512 source remains approximately that size even with a 2 MP maximum.

For Qwen, apply the selected cap to the **source/output only**. Auxiliary references retain their current approximately 1 MP cap. This avoids multiplying reference memory when choosing a larger output and avoids unnecessarily reducing reference detail with a smaller output. Preserve source-first ordering, alpha, orientation handling, and existing alignment.

For H3, 864 × 480 / transpose is a candidate aligned canvas. Freeze its dimensions only after validating the pinned runtime. Lower resolution affects reference conditioning as well as generation, since the current H3 graph uses `ref_image_size: match`. Keep precision, steps, LoRA strengths, attention, audio settings, and export quality unchanged during comparison. Do not label resolution presets as quality modes or promise proportional speedups.

## Rules for when a choice becomes fixed

| Action | Resolution rule |
| --- | --- |
| Ordinary unsent Generate draft using Default | Follows the current image/video preference; shows the effective size |
| Explicit Generate selection | Stays fixed until the user selects Default again |
| Reset workflow | Returns to Default |
| Edit image from a preview | Creates a new edit using Images default; preserves source shape |
| New Chat turn | Snapshots the defaults once when the turn starts |
| Multiple new proposals from that turn | Use that same snapshot |
| Existing pending Chat proposal | Keeps the size already shown, even if defaults change |
| Model feedback/edit | Preserves the proposal’s size |
| Manual request edit | Changes size only when the user selects another value |
| Branch, repeat, retry, revision restore | Preserves the original concrete size, including when requesting new seeds |
| Approval, queued job, worker dispatch, server restart | Uses the saved request and resolved dimensions, never current preferences |
| Another device changes defaults | Default-bound drafts update through normal studio refresh; fixed requests remain fixed |

Submitting Generate captures the concrete size currently shown. A preference change between display and submission must not secretly select a different size. One submission and all its seed variants use the same dimensions.

An explicit “Use current default” selection in a saved request editor resolves immediately and becomes an ordinary user revision. Saved proposals never retain a live link to mutable settings.

## Small implementation structure

### Shared resolution policy

Keep `GenerationRequest.output.size` as the canonical concrete preset. Retain the meanings of existing `1mp` and `768p` values. Add a small shared profile catalog and pure functions for allowed choices, validation, dimension calculation, and display labels. Do not create a second top-level resolution field or a generic configuration framework.

Server, browser, and worker dimension guards must agree. Use a compact declarative catalog that can be packaged with the Python worker, with contract tests checking the packaged policy. Do not duplicate unexplained dimension constants throughout UI, preprocessing, graphs, and export code. Existing Docker builds use the worker directory as their context, so the release/package step must include that catalog deliberately.

### Server preferences

Use a small `generation-defaults.json` in Seed’s existing standard configuration directory. Store schema version, revision, image preset, and video preset. Validate and atomically replace the file. A missing file uses existing defaults; a malformed file or failed write must produce a useful error rather than claiming a successful save.

Use a narrow GET/PATCH API. PATCH accepts changed fields and expected revision so stale device state cannot silently overwrite a newer choice. Expose the current preferences/revision through the existing `/studio` refresh. One hook/context provides the shared value and save operation; no additional polling loop or separate preference caches per page.

Contain preference errors: a malformed preferences file must not fail `/studio` or stop job/pool status updates. Return a preferences-specific error and disable only creation that depends on an unavailable default. Existing fixed requests and running workers must continue normally.

Do not casually append these fields to existing `settings.json`: the CLI currently overwrites that file with host and port during setup. A separate small file avoids changing that unrelated lifecycle. No database migration is needed for these preferences.

### Generate drafts

Allow a draft-only size selection of `default` or a concrete preset. Resolve it in the draft hook before constructing a canonical `GenerationRequest`; the server must never receive `default` as a job setting. Do not maintain `size`, `overrideSize`, and `lastDefault` copies of the same state.

Fresh and reset drafts follow defaults. Branch/import paths explicitly retain their concrete size. Migrate pre-feature ordinary browser drafts to Default because resolution was never selectable, while retaining concrete sizes for branched drafts with `sourceJob`. Unknown newer values must require correction, not silently become a smaller size.

Fix both existing silent-reset points:

- `restoreGenerationDrafts()` currently discards saved `output.size`.
- `patchGeneration()` currently rewrites every Image to image edit to `source + 1mp`.

Pending/failed preference loads must preserve the draft and show loading/retry state; do not submit using a guessed default. A transient refresh failure can retain a previously known concrete choice that remains visible and is submitted explicitly.

### Chat ownership

Capture defaults in the existing Chat run record and pass the snapshot to request creation. An edit uses the saved request instead. Keep resolution in read-only application/request context and remove `size` from the model’s advertised writable tool fields. Update the authoritative rules and prompt version without overwriting locally customized guides.

Handle old tool calls narrowly: the SDK validates before the executor, so merely ignoring `size` inside request creation is insufficient. Accept the known deprecated property internally while omitting it from the outbound tool schema, then discard it before applying model edits. Mixed calls apply legitimate changes and return the actual size; size-only edits return unchanged with a user-controlled-setting notice and create no revision. All other unknown fields still fail validation. This small compatibility path avoids a correction loop in long conversations; it is not a general argument-coercion layer.

If asked in Chat to change resolution, the assistant directs the user to the app control and does not claim it changed output dimensions. Prompt words such as “detailed” must not silently increase resolution.

### Submission, preparation, and results

Resolve width/height once on the server at submission, using source metadata where necessary. Persist the preset, resolved dimensions, and policy revision in the job snapshot. Saved requests continue storing intent; output assets continue storing measured actual dimensions.

Feed the same resolved plan into reference preparation and graph construction. Include actual dimensions/preparation recipe in cache keys so a prior cached input cannot be reused at an incorrect size. Reuse identical prepared inputs where appropriate; do not enlarge auxiliary Qwen references just because output size increased.

Keep direct API behavior simple: explicit concrete `output.size` wins. If omitted on a new submission, materialize the current default. On an idempotent retry, fill an omitted size from the already stored submission before comparison, not from newly changed preferences. Changed explicit settings under the same key remain a conflict.

Source-based creation is an explicit exception: `/jobs/:id/repeat`, branch, and restore inherit omitted size from the source request before entering the ordinary submission path. A new submission identifier does not mean a new default should be applied.

Verify decoded output dimensions against the saved expectation. A mismatch must become an actionable result-validation problem with expected and actual dimensions, preserving the downloaded artifact for diagnosis. Do not silently claim success or automatically regenerate and spend more compute. Existing records without the new dimension snapshot derive their historical dimensions from their legacy workflow/profile, not current preferences.

Classify a dimension mismatch as a permanent artifact-validation error. Do not feed it into the current generic completed-receipt catch, which substitutes storage/reconnection advice and can repeatedly validate the same file. Preserve the durable local artifact and specific error, stop automatic validation retries, and complete the worker receipt/assignment lifecycle using existing cleanup handling. Do not offer “Retry saving” as a remedy for wrong dimensions or leave a healthy worker occupied by that completed generation.

### Worker compatibility and release

Update the bounded native-video export dimension check and Qwen prepared-image pixel limit. Keep `TextEncodeQwenImage21.resolution = 0`, so the prepared source still determines output geometry.

Add a small supported-preset list to worker capabilities and persist it with worker state. Missing capability data means legacy sizes only, subject to existing workflow support checks. Scheduler matching combines workflow, LoRA availability, and requested size. A request waiting on an incompatible old worker gets a clear explanation. Do not automatically lower its size or rent another GPU.

Publish updated image and video containers through the existing release process. Existing workers may finish and serve legacy requests; new sizes require a capable worker. No live container mutation, forced shutdown, GPU purchasing changes, precision changes, or different models are needed.

## Integration inventory

| Area | Main files and required work |
| --- | --- |
| Types and policy | `shared/generation.ts`, new shared resolution policy/catalog, `shared/studio.ts`, job snapshot types |
| Global preferences | Small server store/API; `server/http.ts`, `server/admin.ts`, `web/admin.tsx`, shared settings hook |
| Generate | `web/generation-draft.ts`, `web/hooks/use-generation-drafts.ts`, `web/generate.tsx`, submission and branch hooks |
| Shared editors/details | `web/request-settings.tsx`, request controls/fields, `web/review-request.tsx`, `web/request-details.tsx` |
| Chat | `server/chat/request-tools.ts`, `service.ts`, `prompts.ts`, `provider.ts`, run metadata and workflow guides |
| Validation | `server/workflows.ts`, `server/video.ts`, `server/image-edit.ts` |
| Job execution | `server/jobs.ts`, `server/media.ts`, `server/worker-graphs.ts` |
| Worker matching | `shared/pool.ts`, `server/pool-worker.ts`, `server/pool.ts` |
| Worker runtime | `worker/comfy_seed/image.py`, `video.py`, `jobs.py`, existing container packaging/release |
| Output presentation | Keep actual file dimensions truthful in previews and job details; shared formatter replaces hard-coded request labels |

Library originals, favorites, collections, Gallery selection, thumbnail sizes, Chat vision thumbnails, batch navigation, and Pick Frame do not acquire generation-size settings. They need regression coverage, not parallel resolution implementations. Picking a frame retains the video's actual frame dimensions. Worker hourly pricing/spend remains the cost model; do not restore per-generation estimates.

## Validation and release gates

### Offline correctness

1. Test each candidate profile in supported orientations, including Qwen rotated/alpha/tiny/large/extreme-shape inputs and source replacement. Current defaults must resolve identically to today.
2. Test default save/reload, server restart, invalid values, failed atomic writes, and concurrent device updates. A malformed preferences file must leave studio/job/pool updates working.
3. Exercise Default/explicit drafts, workflow switching, resets, refresh, and legacy/branched draft migration.
4. Exercise Chat creation, multiple proposals, default changes mid-turn, model attempts to change size, prompt-only feedback, manual overrides, approval, restore, repeat, and branch into both destinations.
5. Verify idempotent retries, direct repeat API calls with omitted size, queued/restarted jobs, and batch fanout retain the same saved preset/dimensions.
6. Verify preparation cache separation/reuse, source/reference role changes, H3 first/last guides, mixed reference media, soundtracks, and both H3 execution routes.
7. Test new/old/missing worker capabilities, waiting explanations, invalid oversized/misaligned exports, and actual output-size mismatches. Ensure no silent downgrade or automatic regeneration; a mismatch preserves its specific error and local artifact, stops rechecking, and permits the worker to finish its receipt lifecycle.

### Visual QA

Extend the current request-card and image-edit harnesses. Include Admin Generation, all four Generate workflows, manual Chat review, request history, unavailable-worker explanations, and completed output information. Cover desktop, mobile, 320-pixel width, long/multiple LoRA labels, batch quantities, and two browser contexts changing defaults.

Use representative combinations plus boundary cases; do not take a Cartesian product of equivalent layouts. Review every full-size screenshot individually, flag issues, deduplicate, fix, and then publish numbered desktop/mobile mosaics with scenario captions. Existing approval-card width, zoom/swipe, and browser-back behavior remain regression checks.

### GPU qualification, separately authorized

Offline tests establish propagation and compatibility, not fit, quality, or latency. Qualify candidates before exposing them as supported:

- Image: lowest supported image GPU, Krea and Qwen, including larger output with one source plus nine auxiliary references. Test a Krea LoRA case.
- Video: existing 96 GB worker class, both H3 routes, current versus lower size, reference-heavy inputs, longest supported duration, audio, and a relevant LoRA case.
- Record decoded dimensions, peak VRAM/RAM, inference/export/transfer time, and output bytes with existing telemetry. Review representative output quality separately from dimensions.
- Report OOM and runtime failures clearly. Do not automatically lower resolution, quantize more aggressively, or rerun a paid job.

Release only the presets that pass. A lower resolution does not by itself justify smaller GPUs: model weight requirements remain.

## Implementation order and confidence

1. Shared policy, preferences, and server snapshot rules.
2. Shared UI/draft changes and Chat inheritance with regression coverage.
3. Preprocessing, graphs, worker guards/capabilities, scheduling, and result verification.
4. Offline/browser QA and individual screenshot review; build new images.
5. Authorized GPU qualification, finalize the available preset list, publish the compatible release.

This is a moderate change across existing boundaries, rather than a new subsystem. Planning estimate: roughly two to three focused development/QA days, with GPU qualification and image publishing time separate. Confidence is high in the two-default architecture and integration inventory. New-preset memory use, quality, and latency remain measurements, not assurances from the plan.

## Upstream checks

- [Pinned H3 nodes](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/40c4fcdf513a4523e39d54a9d391908af8df8171/comfy_extras/nodes_minimax_h3.py): width/height inputs use 32-pixel steps; the requested canvas drives output and the current matching reference policy.
- [Pinned Qwen node](https://github.com/Comfy-Org/ComfyUI/blob/b5cc8830279eae909a59de030af1e50761c36751/comfy_extras/nodes_qwen.py): resolution zero preserves independently prepared image sizes; the first image determines the output latent geometry.
- [Official Krea card](https://huggingface.co/krea/Krea-2-Turbo) includes larger-resolution examples. This establishes model capability, not memory or speed qualification for this application's INT8 worker recipe.
