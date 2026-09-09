# Asset preparation

Revision 6. Browser selection/preview review slice implemented; durable uploads, automatic preparation and model preflight remain planned. The experience is select media, preview, generate. Do not add arbitrary byte/megapixel limits or expose internal sizing presets.

## Selection before transfer

1. Obtain capability revision. Inspect selected files locally using browser image/video/audio APIs and a lazy metadata probe where necessary. Read metadata/slices rather than loading a long video wholly into memory.
2. Validate decodable/supported media type, dimensions, streams and durations; then validate the entire workflow's roles/counts/budgets. Large usable image dimensions alone do not fail. Unsupported formats get a precise local error; offer a known local conversion path only where implemented.
3. Show previews, framing and clip ranges. Overlong source files are accepted as sources: choose a valid range inline before transfer. For known model-grid constraints display the effective conditioning range, separately from output duration. No hidden truncation.
4. Only then start resumable tus transfer. Upload originals so later edits/policies can reuse them. Changes to selection after upload still run preflight before job submission. Referencing an already uploaded Library asset uses its verified metadata.

Native browser metadata can miss late corruption, and browser playback may reject a codec the backend can prepare. Use a tested codec/preparation matrix plus a local metadata probe to admit supported convertible files. This does not promise every browser decodes every format, nor that client inspection replaces server integrity checks. Test iOS HEIC/JPEG, Android JPEG/WebP, PNG, common MP4/MOV and WAV/MP3/AAC, rotated media and variable frame rate. Add only the concrete local decoder needed by fixtures; no general WASM video transcoder.

## Automatic preparation

Preserve originals and EXIF-correct orientation. Sharp prepares images; FFmpeg normalizes admitted video/audio, timestamps and exact selected segments. Image references preserve aspect and use a pinned automatic `match` policy corresponding to output pixel area and the native32-pixel grid. `max` is a research comparison, not a Detailed setting. Test extreme aspect ratios and large images without arbitrary rejection; if a library default pixel limit blocks valid media, select a bounded-memory preparation path rather than silently reinstating a product cap.

Anchor fit preserves all image content with padding; fill crops to canvas and shows the crop preview. Do preparation once before native nodes that would otherwise resize/stretch again. Keep requested framing, prepared dimensions and recipe on the job. No silent fallback to lower detail after OOM.

Clip trims are time-based, decoded/resampled to24fps without speeding up action. Normalize conditioning audio to the expected32kHz stereo. Output-only supplied soundtrack uses its exact output-length segment in final mux; it does not imply model lip synchronization. Keep source and generated soundtrack artifacts available for inspection.

## Reference timing and budgets

Official envelope:≤9 images,≤3 videos,≤3 standalone audio clips,≤12 conditioning files combined; each selected video/audio clip2–15s; selected video duration total≤15s and standalone audio total≤15s. Paired video tracks are not additional input files or standalone clip slots, but their time is counted in the actual audio conditioning budget. Initially require **paired plus standalone audio≤15s**, and verify installed encoder accounting before enabling maximum mixtures. No unverified relaxation.

Native Ref2VA clips each video to generated frame count, then rounds down to17k+5. Shared helpers derive `generated_frames = 17*ceil((ceil(seconds*24)-5)/17)+5`; for references, `effective_frames = 17*floor((min(selected_frames,generated_frames)-5)/17)+5`. Test boundary floating-point/timestamp behavior. The official 2 s minimum applies to the selected source; do not invent a separate 2 s minimum after native grid rounding. A 2 s selection (48 frames) becomes 39 frames (~1.625s), which must be shown and tested on the pinned runtime. Show effective range before upload, align paired audio to it, and bind exactly those prepared frames so native code does not unexpectedly shorten it again. Official selection budgets and effective conditioning durations are both recorded.

Examples:5 s output generates 124 frames and exports 120; a 5 s reference rounds to 107 frames (~4.46s), while a sufficiently long selected reference caps at124 (~5.17s). The UI explains the used span in the trim preview; changing output duration recalculates before submission. Test actual pinned node semantics, including its off-by-one conventions, rather than claiming metadata arithmetic proves correspondence.

## Storage and I/O

Tus streams to local PC disk and resumes after disconnect. Reserve against actual free space, including partial uploads and temporary preparation headroom; insufficient storage is an operational message, not a model upload rule. One CPU preparation at a time. Keep partial-upload cleanup separate from permanent assets.

Only prepared derivatives needed for the job are transferred to ComfyUI. First test native `/upload/image` with prepared MP4/WAV despite the route name. Upstream buffers that upload, so measure the bounded derivative memory cost. Stream results back. A narrow private streaming route is a fallback only if this test fails, not another default service.

Generated outputs and terminal manifests live in a temporary per-job network-volume spool. Transfer closed files to the PC; commit durable files and database records before acknowledging receipt. Worker copies remain until acknowledgment. Replacement on the same volume can resume pending transfers; volume loss can lose untransferred output. Never regenerate to repair a copy. Cleanup failures after saving remain distinct. Local Library supports authenticated Range playback; external remote hosting is owner-managed; test generic proxy compatibility without requiring a specific tunnel. Backup requires a consistent database snapshot and media files; persistence is not backup.

## Current upload UI review slice

Image editing accepts a source scene plus an optional subject image. Reference
video offers image/audio/video selection, previews, image roles, removal and
replacement. Selections survive workflow/Library navigation within the tab;
Reset clears only the active workflow. Reloading clears file selections. Blob
URLs are released on removal/reset/unmount; no media is written to localStorage
or sent to the server. This is explicitly labelled preview-only in the UI.

Browser metadata checks reject unreadable files locally. Planned model file-count
limits and 2�15 second clip ranges are represented for interaction review, with
no arbitrary byte/dimension cap. Long sources remain selectable, showing an
editable range. Playback currently plays the source, not a trimmed derivative.
Native grid alignment, paired-video audio budget, codec conversion, first/last
frame influence and server capability binding remain integration gates. A browser
preview is not proof of model acceptance. No actual GPU submissions are enabled.

Browser tests cover replacement, role preservation, per-workflow isolation,
local file rejection, mobile layout, generated audio/video playback and clip-range
feedback. Owner phone review is the next product checkpoint.
