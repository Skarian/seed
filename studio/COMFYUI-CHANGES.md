# ComfyUI changes

Revision 6. Text-to-image now has a native graph builder in server/workflows.ts, based on the official Comfy INT8 Turbo template: EmptyLatentImage, ConditioningZeroOut, eight Euler/simple steps at CFG1. SFW uses base weights; NSFW adds the selected model-only content adapter. Portrait/landscape canvases are720×1280/1280×720, approximately1MP. Other adapters below remain planned. Keep editable legacy graphs for rollback; no generic graph DSL or App export generator. Validate every node/input/link against pinned live object_info before promotion. Do not import old deployment scripts with mutation side effects. [M3 source comparison](../research/workflows/krea2-m3.md).

## Image adapters

| Workflow/source | Exact bindings |
|---|---|
| Text to image: `server/workflows.ts` | Preserve loaders1/2/3; prompt4; canvas6; seed/sampling7; content LoRAs after model1 before sampler7; output9 prefix `studio/<job-id>/image` |
| Image to image: historical identity graph (implementation pending) | Source10→VAE11; required identity LoRA12→patch13; target latent6 and sampler7; grounded conditioning4/5. Optional subject gets second LoadImage/VAEEncode wired into `source_image_b`/`source_latent_b` and both encoders' `image_b` |

Preserve Krea create8steps and identity10steps, CFG1. Identity defaults `ref_boost=4`, `ref_boost_a=1`, fit; source scene first, subject second. Content LoRAs, if configured, follow required identity LoRA and precede patch. Validate quantized key coverage and influence before activation. Identity edit is not promised masked inpainting/general editing; mode can be unavailable. Do not expose a negative-prompt control that has no meaningful effect at CFG1.

## H3 adapters

Current graphs: `server/video.ts`. Historical exports remain in Git history and workflow research.

Preserve model1, encoder2, VAEs3/4, route-specific turbo LoRA5 at existing strength0.8, conditioning/latent6, guider7, seed8, sampler9, schedule10, joint sampling11, decode12/13, export14. Content LoRAs go after5 and feed BOTH guider7 and schedule10. Never swap FL2VA and Ref2VA model/turbo assets by filename similarity.

| Inputs | Internal graph |
|---|---|
| Text only | FL2VA |
| First image only | FL2VA first_frame after explicit fit/fill preparation |
| Last image or first+last | FL2VA plus end guide at exported ending index; see endpoint gate below |
| General images/video/audio | Ref2VA |
| Anchors plus general references | Ref2VA plus native AddGuide, retain explicit anchor intent; required integration gate |

Owner-confirmed FL/Ref support: resolve the engine route before selecting any
content LoRA. The selected MiniMax preset must contain separate FL2VA and Ref2VA
bindings. For the owner's supplied version 3266628, file 3150341
(MysticXXX_MMH3-V4.safetensors) is the FL candidate; file 3156453
(MysticXXX_MMH3-V4-ref2va.safetensors) is the Ref candidate. Validate tensor coverage
and runtime behavior for each exact checkpoint before activation. The filename
mapping alone is not compatibility proof. Missing route-specific content weights
make that mode unavailable; never silently use the other file. Public workflows
stay text-to-video/reference-to-video; image roles and additional references select
the internal route without exposing an FL/Ref model picker. Persist the resolved
route and exact preset/file revisions on each job for replay and debugging.

Prompt is a single textarea string with optional native labels, no hidden LLM rewrite. Single-image default role is first_frame; adding references cannot silently turn it into a general image. Required mixed-reference route must pass before complete delivery. Optional time-positioned video/audio guides and audio-lock packs are separate future capabilities.

Dynamic node6 bindings: `ref_images.ref_image_N`, `ref_videos.ref_video_N`, `ref_video_audios.ref_video_audio_N` paired with videoN, `ref_audios.ref_audio_N`. Use installed LoadImage/LoadAudio/VideoHelperSuite schemas, not assumed widget positions. Generate labels in actual serialization order, including paired audio before standalone audio; persist and test mapping. Prepare exactly the validated effective frame/audio ranges described in [assets](ASSET-PREPARATION.md).

## Export and the ending-frame defect

Existing NeilH3Presets uses124/243/362 generated frames for5/10/15s. NeilH3Finish exports120/240/360frames. Native last_frame anchors generated index123/242/361, which ordinary trim can discard. Do not reuse that combination unchanged.

First candidate: use native `MiniMaxH3AddGuide` on the correct latent/conditioning at exported indices119/239/359, without also binding a contradictory native last_frame. Verify actual latent-grid mapping and influence on exported ending and nearby frames. Conditioning is not a guarantee of pixel-identical reproduction. If that fails, test endpoint-preserving temporal resampling to exact output count, keeping audio/video timing coherent. Do not promote a last-frame capability merely because graph execution succeeds.

All routes, including the current raw Ref2VA test export, use one finish function: exact duration,24fps, advertised dimensions, coherent soundtrack. Native768 short-edge versus720p exported canvas are recorded separately. Keep baseline Turbo8 settings; additional native ratios/durations use explicit grid maps and output tests. No upscale stage in MVP.

Audio output: generated, silent (omit track, no reduced-compute promise), or supplied output-length source segment muxed after generation. Retain native audio artifact; supplied soundtrack does not prove lip sync. Trims never loop/stretch/pad automatically.

## I/O, presets and cleanup

Try native private upload/prompt/queue/history/ws/output routes first. Prepared MP4/WAV transfer support and memory use are an early gate; use a narrow authenticated streaming custom-node route only if necessary. All inputs use generated job-specific names. Outputs and terminal manifests go to a network-volume spool. Copy to the PC, acknowledge durable receipt, then clean up. A paired replacement on the same volume can recover pending complete outputs.

Mode resolves an exact preset before submission. Keep required technical LoRAs separate. Resolve exact configured assets; bootstrap downloads missing pinned files from HF or explicit LoRA sources into staging, validates them and activates a complete revision atomically. See [release design](RELEASE-AND-INFRASTRUCTURE.md). Queued jobs freeze graph/preset snapshots; retired assets needed by queued jobs cannot be removed. Owner sync runs in exclusive maintenance, never a competing provisioning loop. No full model hash scan at startup.

Implementation cleanup: verify exact `models/checkpoints/Qwen-Rapid-AIO-NSFW-v19.safetensors` path, idle queue and acquisition record, then delete only that retired checkpoint (~28.4GB). Remove deployed menu entry and redownload hooks. Preserve Krea/H3 Qwen encoders/VAEs and network storage. Planning performs no cleanup.

## Required evidence

Baseline create/edit and text/image video first; then second identity image, first/last/both anchors, multiple images, standalone audio, video with/without paired sound, image+audio+video, anchor+references, maximum legal counts and15s memory envelope. Test labels, effective trims, exact export properties, mode LoRAs and image↔video model switching. Record seed, node/model revisions, settings, peak VRAM, runtime and visual/audio judgments. Successful execution and good reference influence are separate checks. Preserve old runtime until these pass.

## Fresh connections and engine sessions

Extend the existing personal custom-node integration with a process-local session UUID route and session-checked studio mutation handlers, plus small submission/terminal manifest hooks. Exact contract: [API session rules](API-CONTRACT.md). The UUID changes on each actual Comfy process start even when the endpoint remains the same. Test restart between readiness GET and submission/cancel; an old-session request must fail before touching the replacement queue.

Record a submission receipt before accepting studio work and an atomic successful-output manifest only after graph output writers have closed their complete artifacts. Include job/workspace/session IDs, relative output paths, expected sizes/types and terminal status; no startup hash scan. A failed graph never publishes a successful manifest, and leftover partial files do not count as success. Verify terminal hooks against the pinned execution code; a final export node can publish generation artifacts where appropriate, with failure receipts from the integration hook. Local source-soundtrack mux resumes after copying raw generation artifacts.

These hooks keep manual stop/replacement from losing job meaning. They do not make generation resumable or exactly once. Existing authenticated admin UI remains an explicit maintenance surface; studio queue mutation is exclusive during normal use. The [bootstrap](POD-BOOTSTRAP.md) has no duplicate-pod guard or Tailscale component. Spool files survive replacement only if the underlying disk is retained. Destroying Vast disk loses unsaved outputs. No provider credentials or compute lifecycle calls are added to the engine.

### M4 native video implementation notes

Use native MiniMaxH3ImageToVideo for text-only/anchor-only (FL) and MiniMaxH3ReferenceToVideo for general image/video/audio references (Ref). Native first_frame is used for pure FL so the image participates in both tokenization and latent conditioning. Exported last-frame guidance targets seconds*24-1 through AddGuide; mixed Ref anchors also use AddGuide. Keep the original joint latent connected to the sampler because AddGuide returns conditioning only. Last-frame visual influence still requires live acceptance.

Required route-specific eight-step turbo adapters remain in both modes; the optional owner content adapter is added afterward and feeds both guider and scheduler. Native output lengths round up to 124/243/362 frames; SeedVideoSave exports exactly120/240/360 frames and trims audio. SeedLoadVideo reads PC-prepared reference MP4s; SeedVideoSave exports H.264/AAC using FFmpeg. These two narrow file adapters avoid enabling unrelated custom-node packs. Native MiniMax conditioning/sampling remains authoritative.

PC reference video preparation rounds down to the native17k+5 frame grid; the viewer shows its effective used range. Prompt insert buttons use native Picture/Video/Audio tags; paired video soundtracks consume audio-label slots before standalone audio. Larger reference-count combinations and length/VRAM behavior require live proof, not just schema validation.
