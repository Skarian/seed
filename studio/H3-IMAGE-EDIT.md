# H3 generation: export as images

Local implementation ready for owner UI review, 2026-09-12.
Branch: `feat/h3-image-edit`. No GPU rental is authorized by this plan.

## Implementation checkpoint

Completed duration/format branching, native ImageFromBatch + SaveImage graph,
ordered manifest capture, durable sequence grouping (SQLite migration 3), preview
cache, original PNG inspection, shared confirmation modal, recoverable pruning
and individual frame selection from the Library reference picker. No new runtime
dependency. Native ImageFromBatch schema was verified against the pinned ComfyUI
source; real H3 inference/export remains untested on this branch.

Review app: http://192.168.1.212:4312/library with two synthetic 120-frame sets,
isolated under .local/frame-review. Owner media and installed app were not migrated.
Next: owner desktop/mobile feedback, then authorized live validation and worker
publication/pinning. The current published worker remains the prior version and
does not advertise these export capabilities. Do not claim the feature deployed
to rented GPUs yet.

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

## Library frame sequences and storage

Retrieve and verify every frame before acknowledging worker cleanup. Selection
is entirely local and does not keep a GPU running. Generation is complete once
all frames are durable. Automatically save the entire sequence to Library.

Show one Library card per generation, visually similar to a video card, with a
small frame-count badge. Do not flood Library with individual frame cards. Batch
generations produce separate sequence cards. Use the first retained frame as
the cover. Preserve the same sequence identity after pruning, even to one frame.

Clicking the Library card opens the existing media overlay with a large image,
a discrete frame slider and current frame position/count. A checkmark control
toggles selection of the displayed frame; selections persist while scrubbing.
Show selection markers/count and a floating **Keep only** action, positioned
outside the image's inspection area with mobile safe-area clearance. No extra
Select mode or Play/Pause control is needed. Keyboard arrows, touch scrubbing
and an accessible checkmark toggle must work.

Image quality is central to selection. Cached previews support card thumbnails
and responsive scrubbing, but after scrubbing settles load and display the
original PNG, fitted to the viewport. Provide original-resolution inspection
through zoom/pan; do not upscale or sharpen a preview and present it as the
original. Buffer 24-frame preview sheets with a 96 MiB decoded-image budget. Load originals after a 100 ms pause; render through a persistent native-resolution canvas. Show a subtle
loading indicator until the requested original is decoded. Never let a stale
image stand in for the current slider position: bind selection to the displayed
frame and disable its checkmark while only a temporary preview is available.

Keep only is enabled for a nonempty selection. Confirm with concrete counts, for example
"Keep 6 frames and delete the other 114?" Canceling selection changes nothing.
The confirmation is mandatory before any destructive request. Include that
deleted frames are permanently removed from the PC and the action cannot be
undone. Canceling the dialog preserves the selection and all frames.
Replace the current window.confirm image deletion prompt with a shared styled
confirmation component in web/confirm-dialog.tsx. Use it for existing media
deletion (Library and generation results), sequence deletion and Keep only.
Owner explicitly chose a centered floating dialog over a dimmed page backdrop.
Use native HTML dialog/showModal underneath, consistent with existing app
overlays, rather than installing a dialog framework.

The component takes a title, explanation, destructive action label and handlers.
Show Cancel and a red Delete or Keep only button. Keep-only copy gives exact
retained/deleted counts and permanence; deletion copy names the media kind.
Focus Cancel initially, trap focus while open, support Escape to cancel and
restore focus to the triggering control. Backdrop clicks never confirm deletion.
Support opening above the frame viewer without closing it or losing selection.
Size responsively on mobile. During a request prevent duplicate submission;
show failure in the dialog and allow retry without claiming success. No native
browser confirmation remains on these paths.
Confirming retains those frames in their original order and updates the card
count/cover. This is destructive pruning, not promotion into Library. All frames
remain saved unless explicitly pruned or the sequence is deleted. No expiry.

Keep original frame index and timestamp metadata after pruning; the scrubber
steps through retained frames without pretending they form a continuous video.
Provide existing download/reference reuse actions for the currently viewed
frame. A sequence is not a video reference; choosing a frame supplies an image.
The Library reference picker must let the user drill into a sequence to pick
individual frames, respecting the target workflow's asset limit.

Represent a sequence as a Library grouping over existing image asset records,
not a fabricated video file. Add only the grouping metadata/schema required;
do not use candidate-versus-ready promotion. Store job, seed, mode and original
frame indices; group-level filtering/deletion follows existing Library rules.
Pruning must be repeatable and recover safely if file deletion is interrupted.
Do not remove files still needed by queued jobs or other saved references:
follow existing input ownership rules and verify those rules during implementation.

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

Proposed authenticated routes, using the existing /api/v1 prefix:
- GET /api/v1/sequences/:id: current revision, ordered frame asset IDs, original
  indices/timestamps, dimensions and existing thumbnail/media URLs.
- POST /api/v1/sequences/:id/keep-only with asset_ids and revision: retain exactly
  a nonempty subset belonging to this sequence. Reject stale edits; an identical
  retry of an already-applied selection is harmless. Return updated sequence.
- Reuse Library deletion for the whole sequence, with confirmation. Add sequence
  summaries to the existing Library response, not a separate candidate inventory.

## Milestones and review checkpoints

1. Extend server/video.ts, shared types and capabilities for duration and format.
   Keep graph construction in its current module; no new image-edit workflow
   module or abstraction just for output branching. Test all eleven durations,
   both formats, and first/last guides.
   Update worker/comfy_seed/video.py too: its exporter currently rejects durations
   other than 5/10/15 even though its node widget permits the wider range.
2. Add sliced PNG output and update worker/comfy_seed/jobs.py and server/jobs.ts
   for durable frame sets. Validate native slicing/history with synthetic frames
   locally before paid tests. Preserve existing workflows.
3. Add focused server/sequences.ts using existing DB/storage/media helpers and
   minimal grouping migration. Update API-CONTRACT.md; test grouped listing,
   keep-only, deletion, reference ownership and transfer recovery.
4. Add web/frame-viewer.tsx, Library sequence cards and the generation toggle/
   duration slider. Reuse the media overlay. Owner reviews scrubbing, selection,
   keep-only and reference picking on desktop/mobile over the existing LAN URL
   with synthetic frame sets before UI acceptance.
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

### Implementation readiness review, 2026-09-12

Ready to start local implementation; paid validation and UI acceptance remain
checkpoints, not claims of completed proof. Resolve these technical details in
the owning modules rather than adding services:

- Current Library has no thumbnail endpoint; it loads original media. Add a small
  on-demand, disk-cached image preview path using existing media tooling. Reuse
  it for covers and transient scrubbing; cache is disposable and deleted with
  frames. Settled inspection, download and references use the original PNG.
  Bound preview work and prioritize the current sheet without canceling every scrub request. Validate
  fine detail and color against the original, plus correct frame/selection
  identity under rapid scrubbing and slow requests. No 24 fps playback goal.
- LibraryAsset currently represents real image/video/audio files. Introduce a
  Library item union with a sequence summary, leaving frame assets as images.
  Hide member frames from top-level pagination; order/paginate groups and normal
  assets together without duplicates. Do not overload video MIME or content URLs.
- Existing deletion rejects frames referenced by unfinished jobs or outputs
  still awaiting worker cleanup. Apply those checks to the entire prune set
  before deleting anything, within the existing job serialization boundary.
  Return the existing busy error if blocked. Persist prune intent before file
  removal so restart can resume cleanup without dangling visible members.
  SQLite and filesystem deletion are not one atomic transaction. Reconcile
  original job output lists so polling cannot resurrect removed frames.
- Use a small bounded transfer pool for frame files if measurement shows serial
  per-file latency is material; keep current hash/resume/acknowledgement rules.
  No archive format or bulk transport system in the initial implementation.
- Old data migration, grouped pagination, NSFW filtering, generation results
  and Library reference picking need tests alongside the new viewer. They are
  part of this feature, not a general Library rewrite.

Owner settled the viewer interaction: slider, per-frame checkmark and floating
Keep only action inside the opened Library item. No pending playback question.
Owner emphasized original image quality for selection; cached previews are only
an intermediate display, not the final basis for choosing a frame.

Test missing/duplicate/corrupt/wrong-job outputs, interrupted transfers, reload
before selection, repeated/stale Keep only, interrupted pruning, one-frame
sequences, whole-sequence deletion, mode filtering and reference reuse. All frames
must remain accessible without eager full-size
loading. Safe to terminate must be independent of selection, but not transfer.

Supersedes the earlier separate image-to-image API/page, short-sequence recipe
benchmark, FL-versus-Ref edit experiment, image-only inputs and new H3 graph
abstraction. Also replaces post-MP4 extraction and the candidate inbox/promotion
flow: all images are saved automatically as a grouped Library sequence.

Source basis: current server/video.ts and worker/comfy_seed/video.py, and
[pinned native H3 nodes](https://github.com/Comfy-Org/ComfyUI/blob/12d5279438bfefc058a269eae805ceab6047777f/comfy_extras/nodes_minimax_h3.py).
Community Image Studio and H3 Edit informed initial research; their specialized
recipes are not part of this implementation.


## Scrubbing refinement (2026-09-12)

Owner reported unsmooth scrubbing. Reproduced under 60 ms simulated network
latency: the three-image cache and remounted image elements caused cancellation
churn and blank frames. Replaced that path with a persistent 2D canvas and
24-frame cached preview sheets (six columns, 320px longest cell edge, WebP92).
Only two sheet requests run concurrently; decoded bitmaps have a 96 MiB budget
and are released on close. Originals load after a 100 ms pause and render at
native dimensions; selection stays disabled until the exact original is drawn.
No WebGL/3D library or new dependency was necessary.

First opening may need a short Preparing previews period. Original files remain
unchanged. Sheets are revision-specific and invalidated by pruning; the server
rejects stale sheet revisions. The renderer retains its last pixels while a
requested frame loads, rather than flashing blank. Source frame identity remains
explicit and selection cannot act on the previous frame.
# Scrubbing feedback refinement (2026-09-12)

Keep the checkmark and 100% controls visually steady while an original arrives. They still wait for the exact original before acting; a reference-count limit retains its normal disabled appearance. Show “Loading original” only after the frame has remained unresolved for 500 ms, resetting the delay when the user moves to another frame. Fast scrubbing and normal short fetches should not flash loading text.
