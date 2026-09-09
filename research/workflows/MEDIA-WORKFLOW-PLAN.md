# Workflow evidence and decisions

Revision 2, 9 September 2026. Research/planning only. Product and contracts: [MVP](../../STUDIO-MVP.md), [graphs](../../studio/COMFYUI-CHANGES.md), [media preparation](../../studio/ASSET-PREPARATION.md). Implementation documents define behavior; upstream maxima are not runtime acceptance evidence.

## H3 native envelope

[MiniMax H3](https://github.com/MiniMax-AI/MiniMax-H3) documents FL2VA (text/first/last frames) and Ref2VA (up to 9 images, 3 videos, 3 audio clips;≤12 files total). Selected clips 2–15 s, aggregate video≤15s and audio≤15s. Native output 4–15 s, 24 fps, 32 kHz stereo,768shortedge; ratios21:9,16:9,4:3,1:1,3:4,9:16. Regenerate-2K is a separate stage, not our MVP export.

Saved `deployment/object_info.json` has MiniMaxH3ImageToVideo, ReferenceToVideo and AddGuide. The reference node has9image,3video,3paired-video-audio and3standalone-audio sockets. This establishes schema availability, not maximum-combination runtime quality. Re-fetch live schemas after access; the local snapshot is ignored by Git.

[Native ComfyUI H3 source](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py) shows:

- `match` scales down toward output pixel area; `max` downscales references above2048shortedge; both round to32grid. These are real implementation settings, not established Balanced/Detailed quality tiers. Use automatic versioned match first, preserve originals, compare fidelity.
- Ref2VA caps reference video frames to generated length, then rounds down to17k+5. Selected, effective conditioning and exported durations differ. The client preview and paired soundtrack must use the same effective range.
- FL2VA last_frame is at generated index−1. Our existing124→120,243→240,362→360 export trimming can discard it. Required fix and test are in the graph spec; do not label native last-frame plus ordinary trim correct.
- Native AddGuide offers frame/audio/clip guidance; its existence does not prove exact ending reproduction, audio lock or lip sync. Test native combinations first.

Keep limits explicit without arbitrary upload limits. Count paired tracks in actual audio conditioning budget and numbering. A conservative paired+standalone≤15s limit is provisional until installed encoder accounting is verified. Maximum legal inputs/15s output need96GB memory and quality tests. If a required combination cannot be delivered, revise the requirement with the user rather than silently shrinking it.

## Existing graph baseline

| Saved source | Evidence/decision |
|---|---|
| `deployment/krea2-t2i-api.json` | Krea Turbo INT8, FP8encoder, QwenVAE,8steps CFG1; retain initially |
| `deployment/krea2-edit-api.json` | Required identity LoRA+patch, grounded conditioning; optional second image sockets;10steps CFG1 |
| `deployment/minimax-text-api.json`, `minimax-image-api.json` | Working app baseline, FL2VA Turbo8 strength0.8, portrait/landscape5/10/15s |
| `deployment/test-ref2va-api.json` | One-image reference test, not mixed-media verification; needs same finishing path |
| `deployment/minimax_app_nodes.py` | Explicit native/export frame counts and trim behavior; ending anchor issue above |

Identity is the initial image-to-image engine, not a promise of general inpainting. [Identity node maintainer](https://github.com/lbouaraba/comfyui-krea2edit), [Krea ComfyUI guide](https://docs.comfy.org/tutorials/image/krea/krea-2), [existing Krea research](../krea2/RECOMMENDATION.md). Remove standalone Qwen Rapid checkpoint during implementation only; preserve unrelated Qwen encoder/VAEs. No dependency on an unreleased image editor.

## Community software choices

| Source | Use |
|---|---|
| [Hearmeman template](https://github.com/Hearmeman24/comfyui-minimax) | Existing pinned runtime foundation |
| [MiniMaxRefPack](https://github.com/Hearmeman24/ComfyUI-MiniMaxRefPack) | Reference ordering/audio binding ideas; no hidden prompt-provider calls |
| [ChrisJohnson89 H3](https://github.com/ChrisJohnson89/minimax-h3-comfyui) | Compact graph and separate LoRA slot reference; do not inherit untested sampling changes |
| [T8 Audio](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/main/README_EN.md) | Future narrow audio-lock/hybrid candidate only if native behavior insufficient |
| [Spectrum H3](https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3) | Defer acceleration experiments until native baseline accepted |

Do not install a giant community workflow merely to expose inputs the native engine already has. Pin only dependencies demonstrated necessary; preserve rollback. Soundtrack replacement by mux is exact supplied audio, not synchronized model generation. Native reference audio influences generation but does not promise sound preservation.

## Presets and quality

Local owner manifest specifies exact Civitai file/version IDs, compatible base/route and content LoRA strengths/triggers. Popularity does not establish compatibility. Required turbo/identity assets remain separate. A complete validated revision activates atomically; queued jobs retain snapshots. SFW names configured behavior, not a guaranteed classifier. The requested poop comparison can be one fixed-seed probe, but base models may also render it; use ordinary prompts to detect general degradation.

Record functional completion separately from perceptual quality: reference identity, motion, framing, final-frame influence, audio alignment, exact duration/dimensions and mode comparison. Required cases include all four workflows; source+subject edit; first/last/both; multi-image; standaloneaudio; video with/without sound; image+video+audio; anchors+references; maximum counts/15s stress; image↔video switching. Recovery and browser gates are in [execution](../../studio/EXECUTION-PLAN.md).
