# H3 image editing implementation plan

Status: proposed, 2026-09-12. Branch: `feat/h3-image-edit`.
No implementation or GPU rental is authorized by this planning change.

## Outcome

Use the existing H3 image-conditioned generation pipeline to produce a short
sequence. Show every decoded frame and let the user keep their favorites as
images. This is an experimental image-editing use of a video model; better edit
quality than identity edit is a test objective, not an established result.

Keep the existing Image to Image page, upload/Library picker, mode switch,
aspect ratio, batch count and seed controls. Do not add a model switcher,
timeline editor, community node pack, new service or provider behavior.
Keep the identity-edit LoRA in the manifest while evaluating this replacement.

## Research and reuse

Our pinned native ComfyUI nodes accept lengths on the 5, 22, 39... frame grid.
The documented training range is approximately 124–362 frames. Short lengths
are accepted by code but their edit quality needs live validation.

Community image workflows add short temporal shapes, edit-oriented prompting,
conditioning choices and heuristic frame selection. Their 9/13-frame shapes
are not the same as our native length grid. We will not copy those shapes or
their sharpness/exposure-based automatic selection in the first implementation.

Reuse our FL and Ref weights, encoder, VAEs, eight-step technical adapters,
reference preparation, sampler, job queue, transfer protocol and telemetry.
Retain the technical adapter in both modes; NSFW adds the configured content
adapter for the selected route. Missing content adapters disable that mode.

Sources inspected:
- [Pinned native H3 implementation](https://github.com/Comfy-Org/ComfyUI/blob/12d5279438bfefc058a269eae805ceab6047777f/comfy_extras/nodes_minimax_h3.py)
- [H3 Image Studio](https://github.com/astropuzzo/ComfyUI-MiniMax-H3-Image-Studio)
- [H3 Edit](https://github.com/ethanfel/ComfyUI-MiniMax-H3-Edit)

## First checkpoint: establish a useful recipe

Before building the frame-selection feature, use a small development graph
derived from our current graph and native SaveImage output. No new weights.
After fresh spending approval, use one preferred 96 GB GPU and collect logs
and existing job measurements throughout.

1. Use one owner-approved image and a concrete appearance/background edit.
   Compare FL first-frame anchoring and Ref conditioning at 22 and 39 frames:
   four runs, same prompt, seed, canvas and existing eight-step settings.
2. Take the better route and compare 5 frames and a 124-frame baseline: two
   more runs. Inspect all frames, including whether early ones just copy input.
3. Show contact sheets and full-resolution candidates to the owner. Compare
   edit adherence, preservation, artifacts, useful-frame count, time and peak
   VRAM. Agree on the default frame length and conditioning behavior.
4. If promising, verify a second image/edit and a multi-image Ref case. Check
   both configured modes before declaring either supported. Stop and discuss
   if short sequences fail; do not automatically add adapters or node packs.

These are sequential tests, not a giant combination matrix. Establish a total
spending cap before rental. Do not reuse the earlier infrastructure-test budget.
Keep the GPU for an agreed immediate owner test; otherwise confirm durable
receipt, collect logs and terminate it before handoff.

## Proposed user experience

- Input Images accepts existing uploads and Library selections. Provisional
  limit: nine images on Ref, matching native capacity; prove multi-image binding
  and obtain a useful recipe before advertising the full envelope as validated.
- One image can use either route in the experiment. Production uses the agreed
  default; multiple images use Ref. Do not expose FL/Ref jargon or silently use
  two different recipes until that behavior is reviewed at the first checkpoint.
- Prompt describes the finished image. No required timestamps, shots or audio
  fields. Preserve the user's text; any conditioning instruction must be recorded
  in the frozen effective prompt and reviewed, not silently rewritten.
- Existing aspect choices remain 16:9 and 9:16. Initial native canvases remain
  1344x768 and 768x1344. No invented quality presets or edit-strength slider.
- Create Image runs one short sequence per seed. Batch count still means
  independent seeds, not number of frames. No duration control initially.
- Each completed run shows its own ordered thumbnail strip/grid and frame count.
  Every frame is accessible, with lazy thumbnails and the reusable full-screen
  preview. Select one or more and press Keep selected. No automatic best-frame
  selection. Adjacent frames are correlated, not independent variations.
- Selected images appear in Library and can be reused as inputs. Unselected
  frames stay available in job results until explicitly discarded. Discard
  unselected requires confirmation and never deletes already kept images.

## Output and storage contract

Save the native decoded IMAGE batch as lossless RGB PNGs using built-in
SaveImage. Do not send it through SeedVideoSave: that currently resizes to720p
and encodes lossy H.264. Avoid audio decoding/export for still results; joint
audio/video sampling remains, so this is not a claim of audio-free inference.

Keep all candidate frames durably on the PC before acknowledging worker cleanup.
User selection is local and never keeps a GPU running. A completed job means
generation and transfer are complete, even when no favorites have been picked.
Unselected candidates must survive app restart and remain reachable from job
history. They are not temporary browser state and have no automatic expiry.

Extend the existing manifest to permit an ordered PNG set for this workflow.
Freeze expected frame count, output kind and recipe revision in the job snapshot;
validate count against observed native decoding in checkpoint one. Require unique
IDs/paths, job-owned paths, expected MIME, bounded sizes and hashes for every file.
Keep one-output validation for existing image/video workflows. Retry partial
transfers using existing integrity handling; do not acknowledge a partial set.

Use existing asset records with metadata state `candidate` versus `ready`.
Library already filters for ready assets. Add job/frame index and mode metadata;
keeping a frame promotes the same asset instead of copying it. Persist selection
transactionally and make repeated Keep requests harmless. Explicit discard can
use existing asset deletion machinery after checking job ownership.

## API shape (extend existing job APIs)

Submission uses `workflow: image-to-image`, existing prompt/mode/seed/count,
capabilities revision and image references. Output carries aspect and
`size: native`; reject video/audio references and video-only fields. Frame count
and route are resolved from the reviewed recipe and frozen on submission, not
arbitrary client graph parameters. Existing video requests remain unchanged.

Expose `image_edit` availability through current capabilities, including image
limit, supported aspects/modes and recipe revision. An incompatible worker must
report unavailable before submission; publish and pin a compatible worker image.

Proposed additions under the current jobs resource:
- `GET /api/jobs/:id/candidates`: ordered asset ID, frame index, dimensions,
  existing thumbnail/full-media URLs and kept status; no new media transport.
- `POST /api/jobs/:id/candidates/keep` with `{asset_ids: [...]}`: idempotently
  promote selected candidates belonging to that job; return updated selection.
- `POST /api/jobs/:id/candidates/discard` with `{asset_ids: [...]}`: explicitly
  remove only unkept candidates of that job. Repeated deletion is harmless.

Use existing authentication, errors and request limits. These route names are
proposed; reconcile with the current router when updating API-CONTRACT.md.

## Code ownership and milestones

1. **Recipe proof:** small test graphs and evidence in VALIDATION.md. Owner
   reviews actual frames and chooses acceptable behavior before feature work.
2. **Graph and durable output:** extract only shared H3 graph construction from
   `server/video.ts` into `server/h3.ts`; add focused `server/image-edit.ts`
   request/recipe code. Update `server/workflows.ts`, shared types/capabilities,
   `worker/comfy_seed/jobs.py` and `server/jobs.ts` for the explicit output set.
   Use built-in SaveImage, not a new exporter. Keep existing workflows unchanged.
3. **Local selection API:** put candidate operations in a small
   `server/candidates.ts`, reusing DB/storage/media functions. Update API contract
   and metadata types. No new database or generalized workflow plugin framework.
4. **Frame chooser:** add `web/frame-picker.tsx`, reuse previews, loading and
   selection patterns; connect the existing Image to Image page. Review desktop
   and mobile on the owner's LAN URL before polish is considered complete.
5. **Release:** run applicable app/worker/browser/package checks, publish the
   worker, pin its digest, update the installed app, and run one final end-to-end
   edit/selection/reuse test with authorized compute. Record results and costs.

Commit coherent tested milestones on this branch. First commit is this plan.
Do not merge to main until the feature passes the quality and UI checkpoints.
Update this document with settled decisions; TODO.md tracks remaining work and
VALIDATION.md holds measured results. Historical research remains separate.

## Required acceptance checks

- Correct route, adapters, dimensions, seed and frame count in frozen graphs;
  no regressions in existing text-to-image or video graphs.
- Actual multi-output Comfy history and manifest capture; reject missing,
  duplicate, wrong-job and corrupt outputs. Resume an interrupted transfer.
- Reload/restart before selection, duplicate Keep, partial Keep then discard,
  deleted candidate, and mode filtering; kept images remain intact and reusable.
- All frames are accessible on mobile and desktop without loading every
  full-resolution PNG at once. Multiple seeds remain visibly grouped.
- Safe to terminate after durable transfer, independent of frame selection;
  pending transfer still blocks safety. No GPU required to browse or keep frames.
- Record actual quality and runtime limits. Do not claim universal edit quality,
  maximum-reference capacity or that shorter frame counts scale time linearly.
