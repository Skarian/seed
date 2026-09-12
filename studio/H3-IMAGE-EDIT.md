# H3 generation: export as images

Agreed direction, implementation pending, 2026-09-12.
Branch: `feat/h3-image-edit`. No GPU rental is authorized by this plan.

## User experience

Add an **Export as images** toggle before generation on Text to Video and
Reference to Video. Default off. When enabled, export selectable PNG frames
instead of an MP4. This is an output choice on the same pipeline, not a new
image-editing model or workflow. The action reads Create images when enabled.

Offer every whole-second duration from **5 through 15** on all H3 workflows,
using a slider with the selected seconds displayed. Default five seconds.
Keep the same prompts, inputs, reference roles, aspect ratios, modes, seeds and
batch count. Batch count means independent generations, not number of frames.
Image export must not change conditioning or silently rewrite prompts.

Reference-to-video retains image/video/audio inputs and current reference versus
first/last-frame roles. Hide output soundtrack controls for image export, while
preserving audio inputs used for conditioning. No separate H3 Image to Image page:
remove its unfinished placeholder when shipping this feature. Keep the identity
LoRA in the manifest as requested.

## Exact output behavior

- At 24 fps, requested output count is duration_seconds * 24: 120–360 frames.
- Native length is 17 * ceil((count - 5) / 17) + 5: 124 for five seconds,
  362 for fifteen. Export only the first requested count in either mode.
- Preserve existing last-frame guidance at requested count minus one, rather
  than in discarded padding. Verify this for newly supported durations.
- Video export retains exact requested duration and existing MP4/audio behavior.
- Image export saves native decoded RGB PNGs at 1344x768 or 768x1344. Do not
  pass through MP4 compression or the existing resize to 720p.
- Prefer built-in image-batch slicing plus SaveImage; verify both against our
  pinned ComfyUI. If slicing is unavailable, add only that small operation.
- Skip audio decoding/export when unnecessary. Joint audio/video sampling still
  occurs; do not promise faster inference or independent image variations.
- Keep existing technical and route-specific content adapters unchanged.

No automatic frame scoring, new weights, community node pack, special prompt
recipe, model switcher, experimental sub-five-second sequences or new service.
Longer sequences give more frames, not necessarily better edits. Measure PNG
storage and transfer overhead; it can substantially exceed MP4 output.

## Frame selection and storage

Retrieve and verify every frame before acknowledging worker cleanup. Selection
is entirely local and does not keep a GPU running. Generation is complete once
all frames are durable, even if the owner has not selected favorites.

Show every retained frame in an ordered thumbnail grid/strip, grouped by job,
with multi-selection and existing fullscreen previews. Lazy-load thumbnails, not
all full-resolution PNGs. Keep selected promotes favorites into Library without
copying files; those images can immediately be reused as references.

Unselected frames remain accessible from job results after reload/restart and
stay outside Library. Explicit Discard unselected requires confirmation and
never removes kept images. No automatic expiry. Reuse asset metadata state
candidate versus ready, plus job ID, frame index, seed and mode. Library already
filters for ready assets. Selection is transactional and repeatable.

## API and code changes

Keep text-to-video and reference-to-video workflow IDs. Add output.format with
video or images, default video when omitted. Accept integer duration_seconds
from 5 through 15. Preserve existing aspect/size fields for compatibility;
capabilities and result metadata describe native PNG versus 720p video sizes.
Advertise supported formats and duration min/max/step through capabilities.
Freeze format, native/requested frame counts, canvas, route and graph per job.
Older workers must report the new options unavailable before submission.

Extend manifests for exactly the frozen number of ordered PNGs, with unique
IDs/paths, job-owned paths, expected MIME, bounded sizes and per-file hashes.
Keep single-output validation for existing MP4 and text-to-image jobs. Resume
partial transfers with existing integrity handling; never acknowledge a partial
set. No archive transport or new database is needed initially.

Proposed authenticated routes, reconciled with the existing router during coding:
- GET /api/jobs/:id/candidates: ordered IDs, indices, dimensions, existing
  thumbnail/media URLs and kept status.
- POST /api/jobs/:id/candidates/keep with asset_ids: promote only this job's
  candidates; repeated requests return current selection without duplicates.
- POST /api/jobs/:id/candidates/discard with asset_ids: remove only this job's
  unkept candidates; repeated deletion is harmless.

## Milestones and review checkpoints

1. Extend server/video.ts, shared types and capabilities for duration and format.
   Keep graph construction in its current module; no new image-edit workflow
   module or abstraction just for output branching. Test all eleven durations,
   both formats, and first/last guides.
2. Add sliced PNG output and update worker/comfy_seed/jobs.py and server/jobs.ts
   for durable frame sets. Validate native slicing/history with synthetic frames
   locally before paid tests. Preserve existing workflows.
3. Add focused server/candidates.ts using existing DB/storage/media helpers.
   Update API-CONTRACT.md and test selection, discard and transfer recovery.
4. Add web/frame-picker.tsx and connect the toggle/slider on existing pages.
   Reuse preview and selection components. Owner reviews desktop/mobile using
   the existing LAN URL and synthetic frame sets before UI acceptance.
5. With fresh spending approval, validate live on one preferred 96 GB GPU:
   Ref export with one/multiple images, T2V image export, an intermediate duration,
   and both configured content modes. Combine cases to reduce paid runs. Check
   intermediate-duration MP4 too. Record counts, dimensions, quality, time, VRAM,
   PNG bytes and transfer time. Run applicable regression/package tests, publish
   and pin the compatible worker, update installed Seed and verify end to end.

Commit coherent tested milestones on this branch. Keep decisions here, work in
TODO.md and measured evidence in VALIDATION.md. Check in for UI judgment and
actual results. Do not merge until accepted. Agree a spending cap before rental;
collect failure logs before cleanup. Leave GPU up for agreed immediate testing,
otherwise terminate after durable receipt before handoff.

## Acceptance and removed scope

Test missing/duplicate/corrupt/wrong-job outputs, interrupted transfers, reload
before selection, repeated Keep, partial Keep then discard, mode filtering and
reuse of favorites. All frames must remain accessible without eager full-size
loading. Safe to terminate must be independent of selection, but not transfer.

Supersedes the earlier separate image-to-image API/page, short-sequence recipe
benchmark, FL-versus-Ref edit experiment, image-only inputs and new H3 graph
abstraction. Also replaces the suggestion to extract frames from finished MP4s.

Source basis: current server/video.ts and worker/comfy_seed/video.py, and
[pinned native H3 nodes](https://github.com/Comfy-Org/ComfyUI/blob/12d5279438bfefc058a269eae805ceab6047777f/comfy_extras/nodes_minimax_h3.py).
Community Image Studio and H3 Edit informed initial research; their specialized
recipes are not part of this implementation.
