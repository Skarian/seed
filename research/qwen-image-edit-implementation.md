# Qwen Image to image — implementation and validation

Date: 2026-09-23. This report records the implementation pass, which ended before paid GPU qualification. The subsequently authorized real run is complete: see [GPU qualification, costs and verified cleanup](qwen-image-edit-gpu-qualification-2026-09-23.md) and the [real output gallery](http://192.168.1.212:4312/qwen-gpu/index.html).

## Delivered

Image to image is available in Generate and Chat on the existing Image worker class. Krea and Qwen share one ComfyUI process and its memory manager. H3 remains on Video workers.

- One explicit source image, up to nine additional image references, Quantity 1–16, and random or fixed Seed. The input limit is an enforced software boundary, not a measured ten-image RTX 5090 memory guarantee.
- Source-shaped output up to about 1 MP, with EXIF orientation normalization and preserved input alpha. PNG outputs retain source/input lineage and resolved runtime settings.
- Independent persisted workflow drafts, image-only input selection, stable source/reference mentions, and an **Edit image** action in the shared preview. Applying an existing image protects an occupied draft and does not ask for asset notes again.
- Shared request controls, Chat proposal/review/approval, server validation, durable output jobs, cancellation, existing recovery and worker shutdown controls. No per-generation pricing was introduced.
- Additive workflow capabilities prevent older Image workers from receiving Qwen requests. Queued edits explain that they need a compatible Image worker. Loading and editing activity come from the worker; model loading does not masquerade as a reconnect.
- No Qwen LoRA selector, masking, strength slider, arbitrary size controls, or separate Qwen text-to-image workflow in this release.

The real app was rebuilt, restarted and checked at [Seed on the LAN](http://192.168.1.212:4310). Chrome confirmed the new workflow and **No workers running**. Existing user credentials were not changed.

## Published Image release

| Item | Value |
| --- | --- |
| Tag | `ghcr.io/skarian/seed-worker-image:v0.1.0-qwen.1-19fb0d16dbf3` |
| Manifest digest | `sha256:1477fc24167c9662b7a9907bf61052da13fa16f4e688a01b86aeb992d8d7433b` |
| ComfyUI revision | `b5cc8830279eae909a59de030af1e50761c36751` |
| Model repository | `Comfy-Org/Qwen-Image-2.1` |
| Model revision | `9a44dbdb47cefd046be9c0a13476192f34c8db8e` |
| Template revision | `fc427f00097817d3f7d8099c5259837fa51e1267` |
| Serving profile | INT8 ConvRot diffusion and Qwen3-VL encoder, BF16 VAE, Euler/simple, 25 steps, CFG 1, native Qwen cache defaults |
| Qwen assets | Three pinned files, 17,283,091,112 bytes total |
| Compressed container | 24,497,383,073 bytes across 50 layers |

The model builder downloads directly from the model host and verifies pinned sizes and SHA-256 hashes. These Qwen serving assets replace the unused BF16 Diffusers assets and are baked into the Image container. The Seed app does not relay these weights. Existing worker acquisition and direct model/LoRA download behavior remains in place for the other assets.

The published manifest, configuration and layer availability were verified anonymously. Thirty packaged source files matched the workspace; all three baked Qwen files passed size/hash verification inside the final container with networking disabled. The Video release digest is unchanged.

Tracked evidence: [build evidence](../worker/build-evidence.json), [publication evidence](../worker/publication-evidence.json), [release selection](../worker/releases.json), [model manifest](../worker/qwen-model.json).

## Validation performed

| Check | Result | Scope |
| --- | --- | --- |
| Typecheck and production build | Passed | Application compilation and packaging |
| Application tests | 280 passed, 33 files | Contracts, media preparation, routing, Chat, jobs, pool and existing behavior |
| Linux worker tests | 87 passed | Admission, receipts, activity, cancellation and worker behavior |
| Container transport checks | 12 passed | Real SSH/private HTTP transport with synthetic inference, both worker roles |
| Image-editing browser matrix | 34 passed | 17 scenarios on desktop and mobile; isolated real app with fake providers/inference |
| Existing browser regressions | 15 passed | Generate feedback/drafts, inline composer, input mentions, Library, Krea/H3 forms and adapters |
| Native Comfy CPU validation | Passed | Qwen node registration, real graph validation and RGBA input loading |
| Paid GPU inference | Not run | Deliberately deferred |

New checks include source-first ordering, invalid/hidden assets, extreme input dimensions, EXIF/alpha, settings rejection, old-worker exclusion, seeded Quantity 4 scheduling, Krea → Qwen → Krea graph isolation, finishing a preparing worker, duplicate admission, cancellation winning over late completion, and restart receipt reconciliation without resubmission.

The container transport harness verified Qwen capability discovery, actual prepared-source upload, profile admission, duplicate receipt handling, PNG download integrity and acknowledgment cleanup. Inference in this harness is synthetic; it does not establish edit quality, CUDA compatibility, GPU residency or latency. The native CPU graph check likewise does not execute a diffusion pass.

Raw local logs and captures are in `.local/qwen-upstream/`, `.local/tests/container-transport-dZQARH/` and `.local/image-edit-atlas/`. These are generated artifacts, not source-controlled test fixtures.

## Visual QA

[Numbered desktop/mobile gallery and mosaics](http://192.168.1.212:4312/qwen-edit/index.html). Refer to a capture by number and device, such as **110 mobile**. All 34 primary screenshots and the two additional Chat settings captures were inspected individually at full resolution before producing the mosaics. The gallery uses synthetic images and workers, not GPU-generated examples.

Reviewed states: empty editing form; source and fixed seed; source plus references; changing source; no compatible worker; older Image worker; model loading; editing/cancellation; failure/retry; completed preview; persistent isolated drafts; replacement confirmation; Chat approval; review inputs/settings; approved Chat output; invalid source; saved-image handoff.

Corrections from review were deduplicated before recapture:

- Source badges now have readable backgrounds; output sizing help uses muted styling.
- Queued job details show the compatible-worker explanation; row actions have consistent spacing.
- The Edit image action shares the existing text-button treatment instead of squeezing text into a circular icon button.
- Generic failures are no longer labeled as lost connections merely because an error suggests reconnecting.
- Draft replacement uses shared dialog actions; applying a saved image clears the old instruction and requires a new prompt.
- Mobile notifications sit behind open overlays so preview actions and modal headers remain accessible.
- Invalid edit uploads suggest image formats only.
- Browser input identifiers work over HTTP LAN access where `crypto.randomUUID` is unavailable.
- Capture sequencing now waits for the intended terminal state and avoids recording restored input focus as a displaced fixed header.

The review ledger is [qwen-image-edit-visual-review.json](qwen-image-edit-visual-review.json). Manual Chrome checks also confirmed the real app's workflow and the isolated fixture's draft/disabled-button behavior. The Chrome extension's file-URL permission prevented its manual file-chooser upload; actual upload journeys passed through Playwright. A later Chrome screenshot command timed out, while the real app's accessibility state remained readable. Neither limitation was treated as a successful manual upload or screenshot.

## Original handoff: paid RTX 5090 qualification

This was the implementation pass's explicit stopping point. The user later authorized a $5 test budget; the completed follow-up is linked above.

The next bounded run should measure a first edit, a warm edit, Quantity 4, source-plus-reference editing, and Krea → Qwen → Krea on one RTX 5090 32 GB. Record model loading/offloading, conditioning, denoising, decoding, transfers, peak VRAM/host RAM and billed worker time. Check image preservation and instruction following, cancellation during model loading/execution, and provider release. The exact reference limit, latency, quality and physical model-switching behavior remain unqualified until that run.
